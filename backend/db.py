"""Database access for the Gauchos Judíos archive.

Every part of the backend that talks to PostgreSQL goes through this module:
`connect()` opens a psycopg 3 connection to the database named by
`DATABASE_URL`, and the read functions return plain rows for the API to pass
to the search index. It also holds what the loader and the API must agree on:
how row labels are written and how a grave is referred to (`W-12-4`: women's
section, row 12, stone 4).

    with connect() as conn:
        persons = fetch_search_rows(conn)
        vectors = fetch_name_vectors(conn)
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
SECTION_LETTERS = {"women": "W", "children": "C", "men": "M"}   # section → letter in a reference

SEARCH_ROWS_SQL = """
    SELECT person.id, person.name_es, person.surname_es, person.name_he, person.surname_he,
           person.birth_year, person.death_year, person.death_year_he,
           grave.section, grave.row_label, grave.stone_number,
           (SELECT photo.cloudinary_public_id
              FROM photo
             WHERE photo.grave_id = grave.id
             ORDER BY photo.kind = 'main' DESC, photo.sort_order, photo.cloudinary_public_id
             LIMIT 1) AS photo
      FROM person
      JOIN grave ON grave.id = person.grave_id
     ORDER BY grave.section, grave.row_label, grave.stone_number, person.id
"""
NAME_VECTORS_SQL = "SELECT spelling, embedding::real[] AS vector FROM name_vectors"
GRAVE_SQL = """
    SELECT id, section, row_label, stone_number
      FROM grave
     WHERE section = %s AND row_label = %s AND stone_number = %s
"""
GRAVE_PERSONS_SQL = "SELECT * FROM person WHERE grave_id = %s ORDER BY id"
GRAVE_PHOTOS_SQL = """
    SELECT kind, cloudinary_public_id, width, height, sort_order
      FROM photo
     WHERE grave_id = %s
     ORDER BY kind = 'main' DESC, sort_order, cloudinary_public_id
"""
CEMETERY_SQL = """
    SELECT name, aerial_width_px, aerial_height_px, tiles_path
      FROM cemetery
     ORDER BY name
     LIMIT 1
"""
# Every grave with what the map draws: its outline, whether it has photos, and
# the names of its people (as a JSON list, so one query serves every grave).
MAP_GRAVES_SQL = """
    SELECT grave.section, grave.row_label, grave.stone_number,
           grave.centroid_x, grave.centroid_y, grave.outline_px::text AS outline,
           EXISTS (SELECT 1 FROM photo WHERE photo.grave_id = grave.id) AS has_photos,
           COALESCE((SELECT json_agg(json_build_object(
                                'id', person.id::text,
                                'name_es', person.name_es, 'surname_es', person.surname_es,
                                'name_he', person.name_he, 'surname_he', person.surname_he)
                            ORDER BY person.id)
                       FROM person
                      WHERE person.grave_id = grave.id), '[]'::json) AS persons
      FROM grave
     ORDER BY grave.section, grave.row_label, grave.stone_number
"""
NUMBER = re.compile(r"-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?")   # one coordinate in a polygon


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
# READING
# ═════════════════════════════════════════════════════════════════════════════
def fetch_search_rows(conn: psycopg.Connection) -> list[dict]:
    """Return one row per person, holding what a search result shows and filters on.

    Args:
        conn: an open connection from `connect()`.

    Returns:
        A list of dictionaries, one per person, with the person's id (a
        string), the grave's reference, section, row and stone, the four name
        columns, the years of birth and death (the death year also in the
        Hebrew calendar), and the Cloudinary public ID of the grave's main
        photo (None until photos are loaded).
    """
    rows = conn.execute(SEARCH_ROWS_SQL).fetchall()
    return [{"person_id": str(row["id"]),
             "ref": grave_ref(row["section"], row["row_label"], row["stone_number"]),
             "section": row["section"], "row": row["row_label"], "stone": row["stone_number"],
             "name_es": row["name_es"], "surname_es": row["surname_es"],
             "name_he": row["name_he"], "surname_he": row["surname_he"],
             "birth_year": row["birth_year"], "death_year": row["death_year"],
             "death_year_he": row["death_year_he"], "photo": row["photo"]}
            for row in rows]


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
        column of each person on the stone; empty for a photo-only stone) and
        `photos` (main photo first, then in display order), or None when the
        reference is malformed or names no grave.
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
    persons = conn.execute(GRAVE_PERSONS_SQL, (grave["id"],)).fetchall()
    photos = conn.execute(GRAVE_PHOTOS_SQL, (grave["id"],)).fetchall()
    return {"ref": ref, "section": grave["section"], "row": grave["row_label"],
            "stone": grave["stone_number"],
            "persons": [dict(person) for person in persons],
            "photos": [dict(photo) for photo in photos]}


# ═════════════════════════════════════════════════════════════════════════════
# THE MAP
# ═════════════════════════════════════════════════════════════════════════════
def parse_polygon(text: str | None) -> list[list[float]] | None:
    """Turn a polygon in PostgreSQL's text form into a list of points.

    Args:
        text: e.g. "((10,20),(30,20),(30,50))", as `outline_px::text` writes it,
            or None for a grave that has not been placed.

    Returns:
        The points as [x, y] pairs in pixels of the aerial image, e.g.
        [[10.0, 20.0], [30.0, 20.0], [30.0, 50.0]], or None when `text` is None.
    """
    if text is None:
        return None
    numbers = [float(number) for number in NUMBER.findall(text)]
    # The numbers alternate x, y, x, y, …, so they pair up two at a time.
    return [[numbers[i], numbers[i + 1]] for i in range(0, len(numbers) - 1, 2)]


def map_state(persons: list, has_photos: bool) -> str:
    """Return a grave's state on the map, derived as the design describes.

    Args:
        persons: the people on the grave.
        has_photos: whether the grave has any photo.

    Returns:
        "documented" when someone is named on it, "incomplete" when it has
        photos but no one could be read, and "missing" when it has neither.
    """
    if persons:
        return "documented"
    if has_photos:
        return "incomplete"
    return "missing"


def map_grave(row: dict) -> dict:
    """Turn one row of MAP_GRAVES_SQL into what /api/map/graves returns for a grave.

    Args:
        row: a row with section, row_label, stone_number, centroid_x,
            centroid_y, outline (polygon text or None), has_photos and persons.

    Returns:
        The grave's ref, section, row, stone, state, centroid ([x, y] or None),
        outline (a list of [x, y] or None) and persons (id and the four name
        columns of each).
    """
    centroid = None
    if row["centroid_x"] is not None and row["centroid_y"] is not None:
        centroid = [row["centroid_x"], row["centroid_y"]]
    return {"ref": grave_ref(row["section"], row["row_label"], row["stone_number"]),
            "section": row["section"], "row": row["row_label"], "stone": row["stone_number"],
            "state": map_state(row["persons"], row["has_photos"]),
            "centroid": centroid, "outline": parse_polygon(row["outline"]),
            "persons": row["persons"]}


def fetch_map(conn: psycopg.Connection) -> dict:
    """Return everything the cemetery map draws, in one answer.

    Args:
        conn: an open connection from `connect()`.

    Returns:
        {"image": …, "graves": […]}. `image` holds the aerial image's width,
        height and tiles_path (None when no cemetery row exists yet), and
        `graves` holds one entry per grave, as `map_grave` describes it. A
        grave not yet placed has no centroid and no outline.
    """
    cemetery = conn.execute(CEMETERY_SQL).fetchone()
    image = None
    if cemetery is not None:
        image = {"width": cemetery["aerial_width_px"], "height": cemetery["aerial_height_px"],
                 "tiles_path": cemetery["tiles_path"]}
    graves = [map_grave(row) for row in conn.execute(MAP_GRAVES_SQL)]
    return {"image": image, "graves": graves}
