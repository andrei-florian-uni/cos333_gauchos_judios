"""Database access for the Gauchos Judíos archive.

Every part of the backend that talks to PostgreSQL goes through this module:
`connect()` opens a psycopg 3 connection to the database named by
`DATABASE_URL`, and the read functions return plain rows for the API to pass
to the search index or send as they are. It also holds what the loader and
the API must agree on: how row labels are written, how a grave is referred to
(`W-12-4`: women's section, row 12, stone 4), and the cemetery order in which
graves and people are listed.

    with connect() as conn:
        persons = fetch_search_rows(conn)
        vectors = fetch_name_vectors(conn)
        graves = fetch_map_graves(conn)
"""
import os
import re
from pathlib import Path

import numpy as np
import psycopg
from dotenv import load_dotenv
from psycopg.conninfo import conninfo_to_dict
from psycopg.rows import dict_row

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
BACKEND_DIR     = Path(__file__).resolve().parent
ENV_FILE        = BACKEND_DIR / ".env"          # DATABASE_URL=postgresql://…; never committed
SECTION_LETTERS = {"women": "W", "children": "C", "men": "M"}   # letters; also cemetery order
ROW_PARTS       = re.compile(r"([0-9]+(?:\.[0-9]+)?)?([A-Z]*)([0-9]*)")  # "5.5C" → 5.5, "C", ""

# A person's names and years, as the results list and the map show them. A
# derived date's latest year is in the _upper column (see schema.sql).
PERSON_SUMMARY = """person.id, person.name_es, person.surname_es, person.name_he, person.surname_he,
           person.birth_year, person.birth_year_upper, person.death_year, person.death_year_upper"""
MAIN_PHOTO = """(SELECT photo.cloudinary_public_id
              FROM photo
             WHERE photo.grave_id = grave.id
             ORDER BY photo.kind = 'main' DESC, photo.sort_order, photo.cloudinary_public_id
             LIMIT 1) AS photo"""
SEARCH_ROWS_SQL = f"""
    SELECT {PERSON_SUMMARY},
           grave.section, grave.row_label, grave.stone_number,
           {MAIN_PHOTO}
      FROM person
      JOIN grave ON grave.id = person.grave_id
"""
MAP_GRAVES_SQL = f"""
    SELECT grave.id, grave.section, grave.row_label, grave.stone_number,
           grave.centroid_x, grave.centroid_y, grave.outline_px::text AS outline,
           (SELECT count(*) FROM photo WHERE photo.grave_id = grave.id) AS photo_count,
           {MAIN_PHOTO}
      FROM grave
"""
MAP_PERSONS_SQL = f"SELECT {PERSON_SUMMARY}, person.grave_id FROM person"
NAME_VECTORS_SQL = "SELECT spelling, embedding::real[] AS vector FROM name_vectors"
GRAVE_SQL = """
    SELECT id, section, row_label, stone_number
      FROM grave
     WHERE section = %s AND row_label = %s AND stone_number = %s
"""
GRAVE_PERSONS_SQL = "SELECT * FROM person WHERE grave_id = %s"
GRAVE_PHOTOS_SQL = """
    SELECT kind, cloudinary_public_id, width, height, sort_order
      FROM photo
     WHERE grave_id = %s
     ORDER BY kind = 'main' DESC, sort_order, cloudinary_public_id
"""


# ═════════════════════════════════════════════════════════════════════════════
# CONNECTING
# ═════════════════════════════════════════════════════════════════════════════
def load_environment() -> None:
    """Read `backend/.env` into the environment; a variable already set in the shell wins."""
    load_dotenv(ENV_FILE)


def database_url() -> str:
    """Return the address of the database, from the environment or `backend/.env`.

    Raises:
        RuntimeError: DATABASE_URL is set in neither place.
    """
    load_environment()
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set: add it to backend/.env or the environment")
    return url


def describe_database(url: str) -> str:
    """Return a database's name and host, without its password: "neondb on ep-….neon.tech"."""
    try:
        parts = conninfo_to_dict(url)
    except psycopg.ProgrammingError:
        return "an unreadable DATABASE_URL"
    return f"{parts.get('dbname', '?')} on {parts.get('host', 'localhost')}"


def connect(url: str | None = None) -> psycopg.Connection:
    """Open a connection to the archive database whose rows come back as dictionaries.

    Args:
        url: the database to connect to; DATABASE_URL when None.

    Returns:
        An open psycopg connection. Use it in a `with` block, which commits
        on success, rolls back on an error and closes it either way.

    Raises:
        RuntimeError: the address is malformed. psycopg's own message would
            repeat the whole address, password included, so it is not shown.
    """
    url = (url or database_url()).strip()
    try:
        return psycopg.connect(url, row_factory=dict_row)
    except psycopg.ProgrammingError:
        raise RuntimeError("DATABASE_URL is not a valid PostgreSQL address") from None


# ═════════════════════════════════════════════════════════════════════════════
# GRAVE KEYS  —  shared by the loader and the API
# ═════════════════════════════════════════════════════════════════════════════
def normalise_row_label(label: str) -> str:
    """Return a row label as the archive stores it: "Misc row 2" → "MISC2", "7c" → "7C".

    The word "row" and all spaces are dropped and letters are upper-cased, so
    that the loader, the filters and references all write a row one way.
    """
    return "".join(re.sub(r"(?i)\brow\b", " ", label).split()).upper()


def grave_ref(section: str, row_label: str, stone_number: int) -> str:
    """Return a grave's reference: ("women", "12", 4) → "W-12-4".

    Row labels hold only letters, digits and dots (the loader makes sure of
    it), so the hyphens always separate the three parts.
    """
    return f"{SECTION_LETTERS[section]}-{row_label}-{stone_number}"


# ═════════════════════════════════════════════════════════════════════════════
# CEMETERY ORDER  —  sections, then rows in natural order, then stones
# ═════════════════════════════════════════════════════════════════════════════
def row_sort_key(row_label: str) -> tuple:
    """Return a key that puts row labels in natural order.

    PostgreSQL sorts row labels as text (1, 10, 2); this key reads the number
    at the start of a label, so that the rows run 0, 1, 2, 2B, 3, 3B … 5C,
    5.5C, 6 … 49, and the labels with no number (MISC, MISC2) come last.

    Args:
        row_label: a row label as the archive stores it (see normalise_row_label).
    """
    match = ROW_PARTS.fullmatch(row_label)
    if match is None:
        return (2, 0.0, row_label, 0)                    # any other shape (A.5, say): last of all
    number, letters, digits = match.groups()
    if number is None:
        return (1, 0.0, letters, int(digits or 0))       # MISC, MISC2: after every numbered row
    return (0, float(number), letters, int(digits or 0))


def grave_sort_key(section: str, row_label: str, stone_number: int) -> tuple:
    """Return a key for cemetery order: women, children, men; rows in natural order; stones."""
    return list(SECTION_LETTERS).index(section), row_sort_key(row_label), stone_number


def person_sort_key(person: dict) -> tuple:
    """Return a key that orders the people of one shared stone by name, as the list shows it."""
    latin = " ".join(part for part in (person["name_es"], person["surname_es"]) if part)
    hebrew = " ".join(part for part in (person["name_he"], person["surname_he"]) if part)
    return latin.casefold(), hebrew, str(person["id"])


# ═════════════════════════════════════════════════════════════════════════════
# READING
# ═════════════════════════════════════════════════════════════════════════════
def person_summary(row: dict) -> dict:
    """Return a person's id (a string), four name columns and years of birth and death.

    `birth_year_upper` and `death_year_upper` are None for a carved date and
    the latest year of a derived one.
    """
    return {"person_id": str(row["id"]),
            "name_es": row["name_es"], "surname_es": row["surname_es"],
            "name_he": row["name_he"], "surname_he": row["surname_he"],
            "birth_year": row["birth_year"], "birth_year_upper": row["birth_year_upper"],
            "death_year": row["death_year"], "death_year_upper": row["death_year_upper"]}


def fetch_search_rows(conn: psycopg.Connection) -> list[dict]:
    """Return one row per person, in cemetery order, with what a search shows and filters on.

    Args:
        conn: an open connection from `connect()`.

    Returns:
        A list of dictionaries, one per person, with the person's summary
        (see person_summary), the grave's reference, section, row and stone,
        and the Cloudinary public ID of the grave's main photo (None until
        photos are loaded).
    """
    rows = conn.execute(SEARCH_ROWS_SQL).fetchall()
    rows.sort(key=lambda row: (grave_sort_key(row["section"], row["row_label"],
                                              row["stone_number"]), person_sort_key(row)))
    return [person_summary(row)
            | {"ref": grave_ref(row["section"], row["row_label"], row["stone_number"]),
               "section": row["section"], "row": row["row_label"], "stone": row["stone_number"],
               "photo": row["photo"]}
            for row in rows]


def polygon_points(text: str | None) -> list[list[float]] | None:
    """Return a polygon's points from PostgreSQL's text form: "((1,2),(3,4))" → [[1, 2], [3, 4]]."""
    if text is None:
        return None
    return [[float(x), float(y)] for x, y in re.findall(r"\(([^(),]+),([^(),]+)\)", text)]


def map_state(has_people: bool, photo_count: int) -> str:
    """Return a grave's state on the map (Project Design › Application Data Structure › grave).

    A person row means documented, photos alone an incomplete record, and
    neither a missing record.
    """
    if has_people:
        return "documented"
    return "incomplete" if photo_count else "missing"


def fetch_map_graves(conn: psycopg.Connection) -> list[dict]:
    """Return every grave in cemetery order, with what the map and the full results list show.

    Args:
        conn: an open connection from `connect()`.

    Returns:
        A list of dictionaries, one per grave, with its reference, section,
        row and stone, its map state (see map_state), its centroid ([x, y])
        and outline ([[x, y], …]) in pixels of the aerial image (None until
        it is placed), the Cloudinary public ID of its main photo (None until
        photos are loaded) and `persons`: the summary of each person on the
        stone, ordered by name (see person_summary).
    """
    persons_by_grave = {}
    for row in conn.execute(MAP_PERSONS_SQL):
        persons_by_grave.setdefault(row["grave_id"], []).append(row)
    graves = conn.execute(MAP_GRAVES_SQL).fetchall()
    graves.sort(key=lambda row: grave_sort_key(row["section"], row["row_label"],
                                               row["stone_number"]))
    result = []
    for grave in graves:
        persons = sorted(persons_by_grave.get(grave["id"], []), key=person_sort_key)
        centroid = None
        if grave["centroid_x"] is not None:
            centroid = [grave["centroid_x"], grave["centroid_y"]]
        key = (grave["section"], grave["row_label"], grave["stone_number"])
        result.append({"ref": grave_ref(*key),
                       "section": key[0], "row": key[1], "stone": key[2],
                       "state": map_state(bool(persons), grave["photo_count"]),
                       "centroid": centroid, "outline": polygon_points(grave["outline"]),
                       "photo": grave["photo"],
                       "persons": [person_summary(person) for person in persons]})
    return result


def fetch_name_vectors(conn: psycopg.Connection) -> dict[str, np.ndarray]:
    """Return the E1 vector of every spelling in `name_vectors`, keyed by spelling.

    Args:
        conn: an open connection from `connect()`.
    """
    return {row["spelling"]: np.asarray(row["vector"], dtype=np.float32)
            for row in conn.execute(NAME_VECTORS_SQL)}


def fetch_grave_record(conn: psycopg.Connection, ref: str) -> dict | None:
    """Return one grave with its people and photos, found by its reference.

    Args:
        conn: an open connection from `connect()`.
        ref: the grave's reference, as `grave_ref` writes it (e.g. "W-12-4").

    Returns:
        A dictionary with the reference, section, row, stone, `persons` (every
        column of each person on the stone, ordered by name; empty for a
        photo-only stone) and `photos` (main photo first, then in display
        order), or None when the reference is malformed or names no grave.
    """
    # Row labels hold no hyphens, so a valid reference has exactly three parts.
    parts = ref.split("-")
    if len(parts) != 3:
        return None
    letter, row_label, stone_text = parts
    sections = {code: section for section, code in SECTION_LETTERS.items()}
    if letter not in sections or not (stone_text.isascii() and stone_text.isdigit()):
        return None

    grave = conn.execute(GRAVE_SQL, (sections[letter], row_label, int(stone_text))).fetchone()
    if grave is None:
        return None
    persons = sorted(conn.execute(GRAVE_PERSONS_SQL, (grave["id"],)), key=person_sort_key)
    photos = conn.execute(GRAVE_PHOTOS_SQL, (grave["id"],)).fetchall()
    return {"ref": ref, "section": grave["section"], "row": grave["row_label"],
            "stone": grave["stone_number"],
            "persons": [dict(person) for person in persons],
            "photos": [dict(photo) for photo in photos]}
