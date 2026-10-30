"""Load the checked transcription into PostgreSQL: the archive's single loader.

This script is the only way data enters the archive (Project Design › OCR and
DB Ingestion). It runs offline, never from the API, and does all its work in
one transaction, so a run that fails leaves the database as it was:

1. checks every input file first, and stops with a list of problems if a
   column is missing, a grave's section, row or stone cannot be read, or a
   value lies outside its range;
2. creates the five tables from `schema.sql` where they are missing;
3. upserts one `grave` per stone, keyed on its section, row label and stone
   number, and one `person` per named person (a stone with no name gets no
   person row: it is a photo-only record), splitting each Hebrew date of death
   into day, month and year;
4. loads photos and placements when their files are given (`--photos`,
   `--placements`), and removes rows the inputs no longer hold. A load that
   would delete more than 2% of the people, graves or photos stops unless
   `--allow-deletions` is given;
5. encodes with E1 every name spelling that `name_vectors` does not yet hold.

Running it twice changes nothing. A database still holding the earlier schema
needs `--rebuild` once, which drops the four old archive tables (`name_vectors`
is kept); on a current database `--rebuild` does nothing.

    python backend/import.py --dry-run             # try it, then roll everything back
    python backend/import.py --rebuild             # first run on the earlier schema
    python backend/import.py                       # every later run

Input formats, for the files `media.py` and the placement tool will write:
    --photos      CSV with columns section, row, stone, kind (main or other),
                  public_id, width, height, sort_order
    --placements  JSON: {"image": {"width": …, "height": …, "tiles_path": …},
                  "graves": [{"section": …, "row": …, "stone": …,
                              "centroid": [x, y], "outline": [[x, y], …]}, …]}
"""
import argparse
import csv
import json
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import psycopg

import db
from hebrew_dates import parse_hebrew_date
from search import collect_names, load_encoder, read_dictionary

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
BACKEND_DIR       = Path(__file__).resolve().parent
TRANSCRIPTION     = BACKEND_DIR.parent / "ocr_pipeline" / "extracted_text.csv"   # the transcription
SCHEMA            = BACKEND_DIR / "schema.sql"
ID_NAMESPACE      = uuid.UUID("2e245085-fdc3-42bf-b9db-5f7dde504499")   # fixed: same row, same id
LOCK_KEY          = 5_310_047         # advisory lock: one load at a time on a database
MAX_DELETED_SHARE = 0.02              # a load deleting more of a table needs --allow-deletions

CEMETERY = {"name": "Cementerio Israelita, Colonia N.º 1",
            "town": "Basavilbaso", "province": "Entre Ríos"}

TEXT_COLUMNS = {"given_name_es": "name_es", "surname_es": "surname_es",
                "given_name_he": "name_he", "surname_he": "surname_he",
                "maiden_name_es": "maiden_name_es", "maiden_name_he": "maiden_name_he",
                "father_name_es": "father_name_es", "father_name_he": "father_name_he",
                "husband_name_es": "husband_name_es", "husband_name_he": "husband_name_he",
                "epitaph": "epitaph"}                       # CSV column → person column
NUMBER_COLUMNS = {"birth_day": (1, 31), "birth_month": (1, 12), "birth_year": (1800, 2100),
                  "death_day": (1, 31), "death_month": (1, 12), "death_year": (1850, 2100),
                  "age_of_death": (0, 130), "confidence": (0, 100)}   # column → allowed range
CSV_COLUMNS = {"section", "row", "stone", "death_date_he", *TEXT_COLUMNS, *NUMBER_COLUMNS}
PHOTO_COLUMNS = {"section", "row", "stone", "kind", "public_id", "width", "height", "sort_order"}
NAME_FIELDS = ("name_es", "surname_es", "name_he", "surname_he")    # a person needs one of these
PERSON_COLUMNS = ("id", "grave_id", *TEXT_COLUMNS.values(), *NUMBER_COLUMNS,
                  "death_day_he", "death_month_he", "death_year_he", "notes")
PERSON_UPSERT = (f"INSERT INTO person ({', '.join(PERSON_COLUMNS)}) "
                 f"VALUES ({', '.join(['%s'] * len(PERSON_COLUMNS))}) "
                 "ON CONFLICT (id) DO UPDATE SET "
                 + ", ".join(f"{column} = EXCLUDED.{column}" for column in PERSON_COLUMNS[1:]))
ROW_LABEL = re.compile(r"[0-9A-Z.]+")   # what a row label may hold once normalised
WHOLE_NUMBER = re.compile(r"-?[0-9]+")

# The earlier schema's four archive tables, and the type of its legibility
# column, which the design no longer has. No CASCADE: if anything else
# depends on these tables, the drop fails and nothing is lost.
LEGACY_DROP = """
    DROP TABLE IF EXISTS photo, person, grave, cemetery;
    DROP TYPE IF EXISTS photo_kind, legibility_status;
"""


@dataclass
class Stone:
    """One grave as the inputs describe it, with the people commemorated on it."""
    section: str
    row_label: str
    stone_number: int
    persons: list[dict] = field(default_factory=list)


@dataclass
class Archive:
    """Everything read from the CSV: the stones by key, and what was wrong with it.

    An error stops the load before anything is written; a warning is printed
    with the report.
    """
    stones: dict[tuple, Stone] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    partial_hebrew_dates: int = 0


# ═════════════════════════════════════════════════════════════════════════════
# READING  —  from the input files to stones and persons, checking every value
# ═════════════════════════════════════════════════════════════════════════════
def read_csv_rows(path: Path, required: set[str], errors: list[str]) -> list[dict]:
    """Read a CSV file into a list of dictionaries, one per row.

    Args:
        path: the file; a byte-order mark at its start is ignored.
        required: the columns the file must have.
        errors: the list a missing column is reported to.
    """
    with path.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        missing = required - set(reader.fieldnames or [])
        if missing:
            errors.append(f"{path.name} lacks the columns {', '.join(sorted(missing))}")
            return []
        return list(reader)


def text_or_none(value: str | None) -> str | None:
    """Return `value` without surrounding spaces, or None if nothing is left."""
    value = (value or "").strip()
    return value or None


def read_key(row: dict, where: str, errors: list[str]) -> tuple | None:
    """Return the (section, row label, stone number) of a row, or None.

    Args:
        row: a row with `section`, `row` and `stone` columns.
        where: where the row comes from, for messages ("CSV line 12").
        errors: the list each problem is added to.
    """
    section = (row.get("section") or "").strip().lower()
    row_label = db.normalise_row_label(str(row.get("row") or ""))
    stone = str(row.get("stone") or "").strip()
    problems = []
    if section not in db.SECTION_LETTERS:
        problems.append(f"unknown section {section!r}")
    if not ROW_LABEL.fullmatch(row_label):
        problems.append(f"unreadable row label {row.get('row')!r}")
    if not re.fullmatch(r"[0-9]+", stone) or int(stone) < 1:
        problems.append(f"unreadable stone number {stone!r}")
    if problems:
        errors.append(f"{where}: {'; '.join(problems)}")
        return None
    return section, row_label, int(stone)


def read_number(value: str | None, low: int, high: int, what: str,
                errors: list[str]) -> int | None:
    """Return a whole number between `low` and `high`, None for an empty value.

    Args:
        value: the text to read.
        low, high: the range the number must lie in.
        what: what the value is, for messages ("CSV line 12: death_month").
        errors: the list a problem is added to.
    """
    value = text_or_none(value)
    if value is None:
        return None
    if not WHOLE_NUMBER.fullmatch(value) or not low <= int(value) <= high:
        errors.append(f"{what} {value!r} is not a whole number from {low} to {high}")
        return None
    return int(value)


def read_person(row: dict, where: str, archive: Archive) -> dict | None:
    """Return the person a CSV row describes, or None if the row names no one.

    The Hebrew date of death is split into day, month and year, and its
    carved text is kept in `notes`, so that a misread can be found and fixed.
    """
    person = {column: text_or_none(row.get(source)) for source, column in TEXT_COLUMNS.items()}
    if not any(person[name] for name in NAME_FIELDS):
        return None                            # no legible name: a photo-only record
    for column, (low, high) in NUMBER_COLUMNS.items():
        person[column] = read_number(row.get(column), low, high, f"{where}: {column}",
                                     archive.errors)
    carved = text_or_none(row.get("death_date_he"))
    date = parse_hebrew_date(carved)
    person["death_day_he"], person["death_month_he"] = date.day, date.month
    person["death_year_he"] = date.year
    person["notes"] = f"Hebrew date of death as carved: {carved}" if carved else None
    if carved and not date.complete:
        archive.partial_hebrew_dates += 1
    return person


def read_archive(rows: list[dict], errors: list[str] | None = None) -> Archive:
    """Group the CSV's rows into stones, checking each one; see Archive.

    Args:
        rows: the CSV's rows, as read_csv_rows returns them.
        errors: problems already found (a missing column, say), carried over.
    """
    archive = Archive(errors=list(errors or []))
    for line, row in enumerate(rows, start=2):                 # line 1 holds the header
        where = f"CSV line {line}"
        key = read_key(row, where, archive.errors)
        if key is None:
            continue
        stone = archive.stones.setdefault(key, Stone(*key))
        person = read_person(row, where, archive)
        if person is not None:
            stone.persons.append(person)
    if not archive.stones and not archive.errors:
        archive.errors.append("the CSV holds no stones")
    return archive


def read_point(point, what: str, errors: list[str]) -> tuple[float, float] | None:
    """Return an [x, y] pair of numbers as a tuple, or None after reporting a problem."""
    if (not isinstance(point, list) or len(point) != 2
            or not all(isinstance(value, (int, float)) for value in point)):
        errors.append(f"{what} must be a pair of numbers [x, y], not {point!r}")
        return None
    return float(point[0]), float(point[1])


def read_placements(path: Path, errors: list[str]) -> tuple[dict, dict[tuple, dict]]:
    """Read placements.json: the aerial image's details, and each grave's centroid and outline.

    Returns:
        The image details (width, height, tiles_path, each optional) and the
        placements by grave key. Problems are added to `errors`.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    graves = data.get("graves") if isinstance(data, dict) else None
    if not isinstance(graves, list) or not graves:
        errors.append(f"{path.name} needs a non-empty \"graves\" list")
        return {}, {}
    image = data.get("image") or {}
    for side in ("width", "height"):
        if side in image:
            read_number(str(image[side]), 1, 10**6, f"{path.name}: image {side}", errors)
    placements = {}
    for number, grave in enumerate(graves, start=1):
        where = f"placement {number}"
        key = read_key(grave, where, errors)
        centroid = read_point(grave.get("centroid"), f"{where}: centroid", errors)
        outline = grave.get("outline")
        if not isinstance(outline, list) or len(outline) < 3:
            errors.append(f"{where}: needs an outline of 3 or more points")
            continue
        points = [read_point(point, f"{where}: outline point", errors) for point in outline]
        if key is not None and centroid is not None and None not in points:
            placements[key] = {"centroid": centroid, "outline": points}
    return image, placements


def read_photos(path: Path, known: set[tuple], errors: list[str]) -> list[dict]:
    """Read the photo manifest; every photo must belong to a stone the CSV holds."""
    rows = read_csv_rows(path, PHOTO_COLUMNS, errors)
    if not rows and not errors:
        errors.append(f"{path.name} lists no photos")
    photos, seen = [], set()
    for line, row in enumerate(rows, start=2):
        where, problems = f"{path.name} line {line}", len(errors)
        key = read_key(row, where, errors)
        public_id = text_or_none(row.get("public_id"))
        sizes = [read_number(row.get(side), 1, 10**5, f"{where}: {side}", errors)
                 for side in ("width", "height")]
        sort_order = read_number(row.get("sort_order"), 0, 10**4, f"{where}: sort_order", errors)
        if key is not None and key not in known:
            errors.append(f"{where}: no stone {db.grave_ref(*key)} in the CSV")
        elif row.get("kind") not in ("main", "other"):
            errors.append(f"{where}: kind must be main or other, not {row.get('kind')!r}")
        elif public_id is None or public_id in seen:
            errors.append(f"{where}: public_id is empty or repeated")
        elif None in sizes and len(errors) == problems:
            errors.append(f"{where}: width and height are required")
        elif len(errors) == problems:                     # every value of the row read
            seen.add(public_id)
            photos.append({"key": key, "kind": row["kind"], "public_id": public_id,
                           "width": sizes[0], "height": sizes[1], "sort_order": sort_order or 0})
    return photos


# ═════════════════════════════════════════════════════════════════════════════
# WRITING  —  one transaction; ids derive from keys, so a re-run changes nothing
# ═════════════════════════════════════════════════════════════════════════════
def stable_id(*parts) -> uuid.UUID:
    """Return the same UUID for the same parts on every run (a version-5 UUID)."""
    return uuid.uuid5(ID_NAMESPACE, "/".join(str(part) for part in parts))


def prepare_tables(conn: psycopg.Connection, rebuild: bool) -> bool:
    """Make sure the five tables exist in their current form.

    Args:
        conn: an open connection, inside the load's transaction.
        rebuild: drop the earlier schema's tables if the database holds them.

    Returns:
        True if the earlier schema's tables were dropped.

    Raises:
        SystemExit: the database holds the earlier schema and `rebuild` is off.
    """
    old_schema = conn.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'grave' "
        "AND NOT EXISTS (SELECT 1 FROM information_schema.columns "
        "                WHERE table_name = 'grave' AND column_name = 'section')").fetchone()
    if old_schema and not rebuild:
        raise SystemExit("The database holds the earlier schema (grave has no section). "
                         "Run again with --rebuild to replace the four archive tables.")
    if old_schema:
        conn.execute(LEGACY_DROP)
    conn.execute(SCHEMA.read_text(encoding="utf-8"))
    return bool(old_schema)


def write_cemetery(conn: psycopg.Connection, image: dict) -> uuid.UUID:
    """Insert or update the cemetery row; return its id.

    Args:
        conn: an open connection, inside the load's transaction.
        image: the aerial image's width, height and tiles_path; a missing
            entry keeps the value already stored.
    """
    cemetery_id = stable_id("cemetery", CEMETERY["name"])
    conn.execute(
        """INSERT INTO cemetery (id, name, town, province, aerial_width_px, aerial_height_px,
                                 tiles_path)
           VALUES (%s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (id) DO UPDATE SET
               name = EXCLUDED.name, town = EXCLUDED.town, province = EXCLUDED.province,
               aerial_width_px = COALESCE(EXCLUDED.aerial_width_px, cemetery.aerial_width_px),
               aerial_height_px = COALESCE(EXCLUDED.aerial_height_px, cemetery.aerial_height_px),
               tiles_path = COALESCE(EXCLUDED.tiles_path, cemetery.tiles_path)""",
        (cemetery_id, CEMETERY["name"], CEMETERY["town"], CEMETERY["province"],
         image.get("width"), image.get("height"), image.get("tiles_path")))
    return cemetery_id


def write_graves(conn: psycopg.Connection, cemetery_id: uuid.UUID,
                 keys: set[tuple]) -> dict[tuple, uuid.UUID]:
    """Insert every grave not yet stored; return the id of each grave, by key.

    Graves are matched on their key (section, row label, stone), not their
    id, so a grave created another way keeps the id it has.
    """
    with conn.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO grave (id, cemetery_id, section, row_label, stone_number)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (cemetery_id, section, row_label, stone_number) DO NOTHING""",
            [(stable_id("grave", cemetery_id, *key), cemetery_id, *key) for key in sorted(keys)])
    rows = conn.execute("SELECT id, section, row_label, stone_number FROM grave "
                        "WHERE cemetery_id = %s", (cemetery_id,))
    return {(row["section"], row["row_label"], row["stone_number"]): row["id"] for row in rows}


def names_of(person: dict) -> tuple:
    """Return a person's four name fields, which tell people on one stone apart."""
    return tuple(person[name] for name in NAME_FIELDS)


def stored_people(conn: psycopg.Connection, cemetery_id: uuid.UUID) -> dict[tuple, dict]:
    """Return the people already stored for this cemetery: by grave key, their names by id."""
    rows = conn.execute(
        """SELECT person.id, person.name_es, person.surname_es, person.name_he, person.surname_he,
                  grave.section, grave.row_label, grave.stone_number
             FROM person JOIN grave ON grave.id = person.grave_id
            WHERE grave.cemetery_id = %s""", (cemetery_id,))
    people = {}
    for row in rows:
        key = (row["section"], row["row_label"], row["stone_number"])
        people.setdefault(key, {})[row["id"]] = names_of(row)
    return people


def warn_if_stone_changed(key: tuple, stone_ids: list[uuid.UUID], stone: Stone,
                          before: dict[tuple, dict], archive: Archive) -> None:
    """Warn when the people on a shared stone differ from those stored for it.

    A person's id comes from the stone's key and the person's place among the
    stone's names in the CSV, so a reload that corrects a name updates the same
    row. On a stone with several people, adding, removing or reordering one
    moves the ids of the others, and links to them would then point at someone
    else; the warning asks for a check.
    """
    now = {person_id: names_of(person) for person_id, person in zip(stone_ids, stone.persons)}
    then = before.get(key, {})
    if then and then != now and max(len(then), len(now)) > 1:
        archive.warnings.append(f"{db.grave_ref(*key)}: the people on this shared stone "
                                "changed; check that links to them still fit")


def write_persons(conn: psycopg.Connection, archive: Archive, grave_ids: dict[tuple, uuid.UUID],
                  before: dict[tuple, dict]) -> list[uuid.UUID]:
    """Upsert every person; return their ids (see warn_if_stone_changed for how ids arise)."""
    values, ids = [], []
    for key, stone in archive.stones.items():
        stone_ids = [stable_id("person", *key, place) for place in range(1, len(stone.persons) + 1)]
        warn_if_stone_changed(key, stone_ids, stone, before, archive)
        for person_id, person in zip(stone_ids, stone.persons):
            ids.append(person_id)
            row = person | {"id": person_id, "grave_id": grave_ids[key]}
            values.append(tuple(row[column] for column in PERSON_COLUMNS))
    with conn.cursor() as cursor:
        cursor.executemany(PERSON_UPSERT, values)
    return ids


def polygon_literal(points: Sequence[tuple[float, float]]) -> str:
    """Return points in PostgreSQL's polygon text form, "((x1,y1),(x2,y2),…)"."""
    return "(" + ",".join(f"({x},{y})" for x, y in points) + ")"


def write_placements(conn: psycopg.Connection, cemetery_id: uuid.UUID,
                     grave_ids: dict[tuple, uuid.UUID], placements: dict[tuple, dict]) -> None:
    """Store each placed grave's centroid and outline, and clear those the file no longer places."""
    placed = [grave_ids[key] for key in placements]
    conn.execute("UPDATE grave SET centroid_x = NULL, centroid_y = NULL, outline_px = NULL "
                 "WHERE cemetery_id = %s AND NOT (id = ANY(%s))", (cemetery_id, placed))
    with conn.cursor() as cursor:
        cursor.executemany(
            "UPDATE grave SET centroid_x = %s, centroid_y = %s, outline_px = %s::polygon "
            "WHERE id = %s",
            [(place["centroid"][0], place["centroid"][1], polygon_literal(place["outline"]),
              grave_ids[key]) for key, place in placements.items()])


def write_photos(conn: psycopg.Connection, grave_ids: dict[tuple, uuid.UUID],
                 photos: list[dict]) -> list[uuid.UUID]:
    """Upsert every photo in the manifest; return their ids."""
    values = [(stable_id("photo", photo["public_id"]), grave_ids[photo["key"]], photo["kind"],
               photo["public_id"], photo["width"], photo["height"], photo["sort_order"])
              for photo in photos]
    with conn.cursor() as cursor:
        cursor.executemany(
            """INSERT INTO photo (id, grave_id, kind, cloudinary_public_id, width, height,
                                  sort_order)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (id) DO UPDATE SET grave_id = EXCLUDED.grave_id,
                   kind = EXCLUDED.kind, width = EXCLUDED.width,
                   height = EXCLUDED.height, sort_order = EXCLUDED.sort_order""", values)
    return [value[0] for value in values]


def count_rows(conn: psycopg.Connection, cemetery_id: uuid.UUID) -> dict[str, int]:
    """Return how many graves, people and photos this cemetery holds."""
    return conn.execute(
        """SELECT (SELECT count(*) FROM grave WHERE cemetery_id = %(c)s) AS grave,
                  (SELECT count(*) FROM person JOIN grave ON grave.id = person.grave_id
                    WHERE cemetery_id = %(c)s) AS person,
                  (SELECT count(*) FROM photo JOIN grave ON grave.id = photo.grave_id
                    WHERE cemetery_id = %(c)s) AS photo""", {"c": cemetery_id}).fetchone()


@dataclass
class Kept:
    """What this load wrote, so that everything else of the cemetery's is stale.

    `grave_keys` are the stones in the CSV and the plots in the placements
    file; `photo_ids` is None when no manifest was given, which keeps every
    stored photo; without a placements file (`placements_given` False),
    graves placed on an earlier run are kept even if the CSV lacks them.
    """
    grave_keys: set[tuple]
    person_ids: list[uuid.UUID]
    photo_ids: list[uuid.UUID] | None
    placements_given: bool


def stale_rows(conn: psycopg.Connection, cemetery_id: uuid.UUID,
               kept: Kept) -> dict[str, list[uuid.UUID]]:
    """Return the ids of this cemetery's rows that the inputs no longer hold, by table.

    A stale grave takes its people and photos with it, so they are listed too.
    """
    keys = sorted(kept.grave_keys)
    keep_placed = "" if kept.placements_given else "AND centroid_x IS NULL"
    graves = [row["id"] for row in conn.execute(
        f"""SELECT id FROM grave WHERE cemetery_id = %s {keep_placed}
            AND (section, row_label, stone_number) NOT IN
                (SELECT * FROM unnest(%s::text[], %s::text[], %s::int[]))""",
        (cemetery_id, [k[0] for k in keys], [k[1] for k in keys], [k[2] for k in keys]))]
    people = [row["id"] for row in conn.execute(
        """SELECT person.id FROM person JOIN grave ON grave.id = person.grave_id
            WHERE grave.cemetery_id = %s AND (NOT (person.id = ANY(%s)) OR grave.id = ANY(%s))""",
        (cemetery_id, kept.person_ids, graves))]
    photos = [row["id"] for row in conn.execute(
        """SELECT photo.id FROM photo JOIN grave ON grave.id = photo.grave_id
            WHERE grave.cemetery_id = %s
              AND (grave.id = ANY(%s) OR (%s AND NOT (photo.id = ANY(%s))))""",
        (cemetery_id, graves, kept.photo_ids is not None, kept.photo_ids or []))]
    return {"grave": graves, "person": people, "photo": photos}


def delete_stale_rows(conn: psycopg.Connection, stale: dict[str, list[uuid.UUID]],
                      stored: dict[str, int], allow_deletions: bool) -> None:
    """Delete the stale rows, unless that removes too much of a table.

    Args:
        stale: the ids to delete by table, from stale_rows.
        stored: how many rows each table held for this cemetery before the load.
        allow_deletions: delete however many rows that is.

    Raises:
        SystemExit: more than MAX_DELETED_SHARE of a table would go, which
            usually means a wrong or partial input file. The transaction then
            rolls back and nothing changes.
    """
    too_many = [f"{len(stale[table])} of {stored[table]} {table} rows" for table in stale
                if stored[table] and len(stale[table]) > MAX_DELETED_SHARE * stored[table]]
    if too_many and not allow_deletions:
        raise SystemExit(f"This load would delete {', '.join(too_many)}. Check the input files; "
                         "if the deletions are intended, run again with --allow-deletions. "
                         "Nothing was changed.")
    for table in ("photo", "person", "grave"):           # children before their graves
        conn.execute(f"DELETE FROM {table} WHERE id = ANY(%s)", (stale[table],))


def vector_literal(vector: Sequence[float]) -> str:
    """Return an E1 vector in pgvector's text form, "[0.12,-0.5,…]"."""
    return "[" + ",".join(f"{value:.9g}" for value in vector) + "]"


def add_name_vectors(conn: psycopg.Connection, stones: dict[tuple, Stone]) -> int:
    """Encode with E1 every spelling `name_vectors` lacks; return how many were added.

    The spellings are those the search index reads: every first name and
    surname in the archive and every spelling in the name dictionary, as
    `search.collect_names` displays them.
    """
    persons = [person for stone in stones.values() for person in stone.persons]
    _, displays, _ = collect_names(persons, read_dictionary())
    stored = {row["spelling"] for row in conn.execute("SELECT spelling FROM name_vectors")}
    missing = sorted(set(displays.values()) - stored)
    if missing:
        vectors = load_encoder().encode(missing)
        with conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO name_vectors (spelling, embedding) VALUES (%s, %s::vector)",
                [(spelling, vector_literal(vector)) for spelling, vector in zip(missing, vectors)])
    return len(missing)


# ═════════════════════════════════════════════════════════════════════════════
# RUN
# ═════════════════════════════════════════════════════════════════════════════
@dataclass
class Inputs:
    """What one load writes. `placements` and `photos` are None when their file
    was not given: the stored placements or photos are then kept as they are."""
    archive: Archive
    image: dict
    placements: dict[tuple, dict] | None
    photos: list[dict] | None


def load(conn: psycopg.Connection, inputs: Inputs, allow_deletions: bool = False) -> dict:
    """Write the inputs into an open transaction; return what changed, for the report."""
    conn.execute("SELECT pg_advisory_xact_lock(%s)", (LOCK_KEY,))   # one load at a time
    cemetery_id = write_cemetery(conn, inputs.image)
    stored = count_rows(conn, cemetery_id)
    before = stored_people(conn, cemetery_id)
    keys = set(inputs.archive.stones) | set(inputs.placements or {})
    grave_ids = write_graves(conn, cemetery_id, keys)
    person_ids = write_persons(conn, inputs.archive, grave_ids, before)
    if inputs.placements is not None:
        write_placements(conn, cemetery_id, grave_ids, inputs.placements)
    photo_ids = None
    if inputs.photos is not None:
        photo_ids = write_photos(conn, grave_ids, inputs.photos)
    stale = stale_rows(conn, cemetery_id,
                       Kept(keys, person_ids, photo_ids, inputs.placements is not None))
    delete_stale_rows(conn, stale, stored, allow_deletions)
    spellings_added = add_name_vectors(conn, inputs.archive.stones)
    after = count_rows(conn, cemetery_id)
    return {**{f"{table}s": f"{after[table]} (were {stored[table]}; {len(stale[table])} deleted)"
               for table in ("grave", "person", "photo")},
            "photo-only stones": sum(1 for stone in inputs.archive.stones.values()
                                     if not stone.persons),
            "spellings added": spellings_added}


def print_report(archive: Archive, counts: dict, dry_run: bool) -> None:
    """Print what the load did, with any warnings, in plain text."""
    print("─" * 72)
    print("  Archive load" + ("  (dry run: rolled back)" if dry_run else ""))
    print("─" * 72)
    counts = counts | {"Hebrew dates not fully read": archive.partial_hebrew_dates}
    for label, value in counts.items():
        print(f"  {label:<30}{value}")
    for warning in archive.warnings:
        print(f"  [WARN] {warning}")
    print("─" * 72)


def read_inputs(args: argparse.Namespace) -> Inputs:
    """Read and check every input file named on the command line.

    Raises:
        SystemExit: an input has problems; they are all listed, and nothing
            has been written.
    """
    errors = []
    rows = read_csv_rows(args.csv, CSV_COLUMNS, errors)
    archive = read_archive(rows, errors)
    image, placements, photos = {}, None, None
    if args.placements:
        image, placements = read_placements(args.placements, archive.errors)
    if args.photos:
        photos = read_photos(args.photos, set(archive.stones), archive.errors)
    if archive.errors:
        raise SystemExit("Nothing was loaded; fix these first:\n  "
                         + "\n  ".join(archive.errors))
    return Inputs(archive, image, placements, photos)


def main() -> None:
    """Read the inputs, check them, and load them in one transaction."""
    parser = argparse.ArgumentParser(description="Load the checked CSV into PostgreSQL.")
    parser.add_argument("--csv", type=Path, default=TRANSCRIPTION, help="the checked CSV")
    parser.add_argument("--photos", type=Path, help="the photo manifest from media.py")
    parser.add_argument("--placements", type=Path, help="placements.json")
    parser.add_argument("--rebuild", action="store_true",
                        help="replace the earlier schema's tables, if the database holds them")
    parser.add_argument("--allow-deletions", action="store_true",
                        help="delete rows even when a table would lose more than "
                             f"{MAX_DELETED_SHARE * 100:.0f}%% of them")
    parser.add_argument("--dry-run", action="store_true", help="roll everything back at the end")
    args = parser.parse_args()

    inputs = read_inputs(args)
    url = db.database_url()
    print(f"Loading into {db.describe_database(url)}"
          + (" (dry run)" if args.dry_run else ""))
    with db.connect(url) as conn:
        if prepare_tables(conn, args.rebuild):
            print("  The earlier schema's tables were dropped (--rebuild).")
        counts = load(conn, inputs, args.allow_deletions)
        if args.dry_run:
            conn.rollback()
    print_report(inputs.archive, counts, args.dry_run)


if __name__ == "__main__":
    main()
