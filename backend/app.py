"""The Gauchos Judíos API: a Flask service that searches the archive by name.

At start-up each worker reads the archive from PostgreSQL through `db.py` and
builds the search index once; `/api/search` then answers from memory, matching
names in Python (Project Design › Application Architecture). If the index
cannot be built, the worker stops instead of serving errors.

Run it locally from `backend/` with `python app.py` (port 5001), or as Render
does with `gunicorn app:app`. Settings come from the environment, or from
`backend/.env` for a variable the environment does not set:

    DATABASE_URL   the PostgreSQL database
    CORS_ORIGINS   comma-separated web origins allowed to call the API;
                   defaults to Vite's development server, http://localhost:5173
"""
import logging
import os
import re
from collections.abc import Callable

from flask import Flask, current_app, jsonify, request
from flask_cors import CORS

import db
from search import SearchIndex, load_encoder, read_dictionary

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
DEFAULT_ORIGINS  = "http://localhost:5173"      # Vite's development server
MAX_QUERY_LENGTH = 100                          # characters: scoring time grows with words²
YEAR_FILTERS     = ("birth_from", "birth_to", "death_from", "death_to")
YEAR             = re.compile(r"[0-9]{1,4}", re.ASCII)
HEBREW_TO_CIVIL  = (3761, 3760)                 # a Hebrew year spans the end of one civil year
                                                # and the start of the next: 5680 is 1919–1920

logger = logging.getLogger(__name__)


class InvalidParameter(ValueError):
    """A request whose parameters cannot be used; answered with status 400."""


def build_search_index() -> SearchIndex:
    """Read every person and name vector from the database and build the search index.

    Returns:
        The index the routes answer from.
    """
    with db.connect() as conn:
        persons = db.fetch_search_rows(conn)
        vectors = db.fetch_name_vectors(conn)
    index = SearchIndex(persons, read_dictionary(), load_encoder(), vectors)
    logger.info("Search index built: %d persons, %d spellings",
                len(persons), len(index.spellings.displays))
    return index


# ═════════════════════════════════════════════════════════════════════════════
# FILTERS  —  from the query string to a test of person rows
# ═════════════════════════════════════════════════════════════════════════════
def year_parameter(name: str) -> int | None:
    """Return the query-string parameter `name` as a year, or None when it is absent.

    Raises:
        InvalidParameter: the parameter is present but is not a year of up to four digits.
    """
    value = request.args.get(name, "").strip()
    if not value:
        return None
    if not YEAR.fullmatch(value):
        raise InvalidParameter(f"{name} must be a year, not {value!r}")
    return int(value)


def death_years(person: dict) -> list[int]:
    """Return the civil years in which a person may have died.

    The civil year when it is known; otherwise the two civil years the Hebrew
    year of death overlaps; otherwise none.
    """
    if person["death_year"] is not None:
        return [person["death_year"]]
    if person["death_year_he"] is not None:
        return [person["death_year_he"] - offset for offset in HEBREW_TO_CIVIL]
    return []


def within(years: list[int], low: int | None, high: int | None) -> bool:
    """True if any of `years` lies within [low, high]; a missing bound is open.

    A person with no known year passes only when neither bound is set.
    """
    if low is None and high is None:
        return True
    return any((low is None or year >= low) and (high is None or year <= high) for year in years)


def read_filters() -> Callable[[dict], bool] | None:
    """Turn the request's filters into a test of person rows.

    The filters are `birth_from`, `birth_to`, `death_from` and `death_to`
    (years, inclusive), `section` (women, children or men) and `row` (a row
    label such as 12, 2b or "Misc row 2", written any way the loader accepts).

    Returns:
        A function that is True for each person row passing every filter, or
        None when the request sets no filter.

    Raises:
        InvalidParameter: a year or the section cannot be used.
    """
    years = {name: year_parameter(name) for name in YEAR_FILTERS}
    section = request.args.get("section", "").strip().lower() or None
    row = db.normalise_row_label(request.args.get("row", "")) or None
    if section is not None and section not in db.SECTION_LETTERS:
        raise InvalidParameter(f"section must be one of {', '.join(db.SECTION_LETTERS)}")
    if section is None and row is None and all(year is None for year in years.values()):
        return None

    def keep(person: dict) -> bool:
        """True if the person row passes every filter of the request."""
        birth = [person["birth_year"]] if person["birth_year"] is not None else []
        return (within(birth, years["birth_from"], years["birth_to"])
                and within(death_years(person), years["death_from"], years["death_to"])
                and (section is None or person["section"] == section)
                and (row is None or person["row"] == row))
    return keep


# ═════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═════════════════════════════════════════════════════════════════════════════
def search_route():
    """GET /api/search?q=Eva+Bendersky: the people whose names best match, best first.

    Returns:
        {"results": [...]}, each result holding person_id, ref, section, row,
        stone, the four name columns, birth_year, death_year, death_year_he,
        photo and score. An empty query returns no results.

    Raises:
        InvalidParameter: the query is too long, or a filter cannot be used.
    """
    query = request.args.get("q", "").strip()
    if len(query) > MAX_QUERY_LENGTH:
        raise InvalidParameter(f"q must be at most {MAX_QUERY_LENGTH} characters")
    keep = read_filters()
    if not query:
        return jsonify({"results": []})
    return jsonify({"results": current_app.config["SEARCH_INDEX"].search(query, keep=keep)})


def health_route():
    """GET /health: whether the service is up, and how many people it can search."""
    return jsonify({"status": "ok",
                    "persons": len(current_app.config["SEARCH_INDEX"].persons)})


def bad_request(error: InvalidParameter):
    """Answer an InvalidParameter with status 400 and its message as JSON."""
    return jsonify({"error": str(error)}), 400


def server_error(_error: Exception):
    """Answer an unexpected failure with a JSON 500; the server log keeps the details."""
    return jsonify({"error": "The server could not complete the request."}), 500


def create_app(search_index: SearchIndex | None = None) -> Flask:
    """Create the Flask application.

    Args:
        search_index: the index to answer from; built from the database when None.

    Returns:
        The application, with CORS open only to the origins in CORS_ORIGINS.
    """
    db.load_environment()
    application = Flask(__name__)
    origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", DEFAULT_ORIGINS)
               .split(",") if origin.strip()]
    CORS(application, origins=origins)
    application.config["SEARCH_INDEX"] = (build_search_index() if search_index is None
                                          else search_index)
    application.add_url_rule("/api/search", view_func=search_route, methods=["GET"])
    application.add_url_rule("/health", view_func=health_route, methods=["GET"])
    application.register_error_handler(InvalidParameter, bad_request)
    application.register_error_handler(500, server_error)
    return application


logging.basicConfig(level=logging.INFO)    # so the start-up line reaches the server's log
app = create_app()

if __name__ == "__main__":
    app.run(port=5001)
