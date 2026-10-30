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
