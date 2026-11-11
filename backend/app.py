"""The Gauchos Judíos API: a Flask service that searches and lists the archive.

At start-up each worker reads the archive from PostgreSQL through `db.py`,
builds the search index once and keeps the list of graves; `/api/search` and
`/api/map/graves` then answer from memory, matching names in Python (Project
Design › Application Architecture). If the archive cannot be read, the worker
stops instead of serving errors. A load into the database therefore reaches
the API when it restarts.

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
from search import DEFAULT_LIMIT, SearchIndex, load_encoder, read_dictionary

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
DEFAULT_ORIGINS  = "http://localhost:5173"      # Vite's development server
MAX_QUERY_LENGTH = 100                          # characters: scoring time grows with words²
MAX_LIMIT        = 1000                         # results a search may ask for: more than the
                                                # archive's people, so every match fits
YEAR_FILTERS     = ("birth_from", "birth_to", "death_from", "death_to")
YEAR             = re.compile(r"[0-9]{1,4}", re.ASCII)
WHOLE_NUMBER     = re.compile(r"[0-9]{1,6}", re.ASCII)

logger = logging.getLogger(__name__)


class InvalidParameter(ValueError):
    """A request whose parameters cannot be used; answered with status 400."""


def load_archive() -> tuple[SearchIndex, list[dict]]:
    """Read the archive from the database: build the search index and list the graves.

    Returns:
        The search index, and every grave in cemetery order as
        `/api/map/graves` returns them (see db.fetch_map_graves).
    """
    with db.connect() as conn:
        persons = db.fetch_search_rows(conn)
        vectors = db.fetch_name_vectors(conn)
        graves = db.fetch_map_graves(conn)
    index = SearchIndex(persons, read_dictionary(), load_encoder(), vectors)
    logger.info("Archive read: %d persons, %d spellings, %d graves",
                len(persons), len(index.spellings.displays), len(graves))
    return index, graves


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


def limit_parameter() -> int:
    """Return how many results the request asks for: `limit`, or DEFAULT_LIMIT when absent.

    Raises:
        InvalidParameter: `limit` is not a whole number from 1 to MAX_LIMIT.
    """
    value = request.args.get("limit", "").strip()
    if not value:
        return DEFAULT_LIMIT
    if not WHOLE_NUMBER.fullmatch(value) or not 1 <= int(value) <= MAX_LIMIT:
        raise InvalidParameter(f"limit must be a whole number from 1 to {MAX_LIMIT}")
    return int(value)


def year_span(person: dict, kind: str) -> tuple[int, int] | None:
    """Return the first and last civil year of a person's `kind` date ("birth" or "death").

    A carved year is a span of one year; a derived date runs from its year to
    its upper year (schema.sql). None when the year is not on record.
    """
    year = person[f"{kind}_year"]
    if year is None:
        return None
    upper = person[f"{kind}_year_upper"]
    return year, upper if upper is not None else year


def overlaps(span: tuple[int, int] | None, low: int | None, high: int | None) -> bool:
    """True if any year of `span` lies within [low, high]; a missing bound is open.

    A derived date therefore passes when its range touches the years chosen
    (decided 11 November 2026). A person with no year passes only when
    neither bound is set. The explore page applies the same rule to the full
    list (frontend/src/searchFilters.js › passesFilters).
    """
    if low is None and high is None:
        return True
    if span is None:
        return False
    first, last = span
    return (low is None or last >= low) and (high is None or first <= high)


def read_filters() -> Callable[[dict], bool] | None:
    """Turn the request's filters into a test of person rows.

    The filters are `birth_from`, `birth_to`, `death_from` and `death_to`
    (years, inclusive; see overlaps), `section` (women, children or men) and
    `row` (a row label such as 12, 2b or "Misc row 2", written any way the
    loader accepts).

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
        return (overlaps(year_span(person, "birth"), years["birth_from"], years["birth_to"])
                and overlaps(year_span(person, "death"), years["death_from"], years["death_to"])
                and (section is None or person["section"] == section)
                and (row is None or person["row"] == row))
    return keep


# ═════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═════════════════════════════════════════════════════════════════════════════
def search_route():
    """GET /api/search?q=Eva+Bendersky: the people whose names best match, best first.

    `limit` (optional, 1 to MAX_LIMIT) sets how many results come back; the
    filters apply before it.

    Returns:
        {"results": [...]}, each result holding person_id, ref, section, row,
        stone, the four name columns, birth_year, birth_year_upper,
        death_year, death_year_upper, photo and score. An empty query returns
        no results.

    Raises:
        InvalidParameter: the query is too long, or the limit or a filter cannot be used.
    """
    query = request.args.get("q", "").strip()
    if len(query) > MAX_QUERY_LENGTH:
        raise InvalidParameter(f"q must be at most {MAX_QUERY_LENGTH} characters")
    limit = limit_parameter()
    keep = read_filters()
    if not query:
        return jsonify({"results": []})
    return jsonify({"results": current_app.config["SEARCH_INDEX"].search(query, limit, keep)})


def map_graves_route():
    """GET /api/map/graves: every grave in cemetery order, with its people.

    One request serves the map (outlines, states, hover names) and the
    explore page's full list of people, which reads the people of each grave
    in turn. See db.fetch_map_graves for the fields.

    Returns:
        {"graves": [...]}.
    """
    return jsonify({"graves": current_app.config["MAP_GRAVES"]})


def grave_route(ref):
    """GET /api/graves/<ref>: the full grave record including people and photos."""
    with db.connect() as conn:
        record = db.fetch_grave_record(conn, ref)
    if not record:
        return jsonify({"error": "Grave not found"}), 404
    return jsonify(record)


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


def create_app(search_index: SearchIndex | None = None,
               map_graves: list[dict] | None = None) -> Flask:
    """Create the Flask application.

    Args:
        search_index: the index to answer from.
        map_graves: the graves `/api/map/graves` returns. When either is
            None, both are read from the database.

    Returns:
        The application, with CORS open only to the origins in CORS_ORIGINS.
    """
    db.load_environment()
    application = Flask(__name__)
    origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", DEFAULT_ORIGINS)
               .split(",") if origin.strip()]
    CORS(application, origins=origins)
    if search_index is None or map_graves is None:
        search_index, map_graves = load_archive()
    application.config["SEARCH_INDEX"] = search_index
    application.config["MAP_GRAVES"] = map_graves
    application.add_url_rule("/api/search", view_func=search_route, methods=["GET"])
    application.add_url_rule("/api/map/graves", view_func=map_graves_route, methods=["GET"])
    application.add_url_rule("/api/graves/<ref>", view_func=grave_route, methods=["GET"])
    application.add_url_rule("/health", view_func=health_route, methods=["GET"])
    application.register_error_handler(InvalidParameter, bad_request)
    application.register_error_handler(500, server_error)
    return application


logging.basicConfig(level=logging.INFO)    # so the start-up line reaches the server's log
app = create_app()

if __name__ == "__main__":
    app.run(port=5001)
