"""Write placements.json to the archive database: grave outlines, centroids and the aerial's size.

`place_stones.py` writes placements.json; this script stores it, in one
transaction, in the database named by DATABASE_URL (from the environment, or
else `backend/.env`):

1. checks that every placement names a grave of the cemetery, and stops with
   the list of those that do not;
2. sets `outline_px`, `centroid_x` and `centroid_y` of every grave placed, and
   clears them on any grave the file does not place, as `import.py` does, so
   that the database matches the file;
3. sets the cemetery's `aerial_width_px` and `aerial_height_px` to the size of
   the aerial the outlines are measured on.

Running it twice changes nothing. A later `import.py` run keeps these columns
unless it is given a placements file of its own.

    .conda/bin/python update_database.py --dry-run   # try it, then roll back
    .conda/bin/python update_database.py
"""
import argparse
import json
from pathlib import Path

import psycopg

from place_stones import CEMETERY, OUTPUT_FILE, RULE, database_url, describe_database

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
UPDATE_GRAVE = """UPDATE grave SET centroid_x = %s, centroid_y = %s, outline_px = %s::polygon
                   WHERE id = %s"""
CLEAR_GRAVES = """UPDATE grave SET centroid_x = NULL, centroid_y = NULL, outline_px = NULL
                   WHERE cemetery_id = %s AND NOT (id = ANY(%s))
                     AND (centroid_x IS NOT NULL OR outline_px IS NOT NULL)"""
UPDATE_SIZE  = "UPDATE cemetery SET aerial_width_px = %s, aerial_height_px = %s WHERE id = %s"


def polygon_literal(points: list[list[float]]) -> str:
    """Return points in PostgreSQL's polygon text form: [[1, 2], [3, 4], …] → "((1,2),(3,4),…)"."""
    return "(" + ",".join(f"({x},{y})" for x, y in points) + ")"


def read_placements(path: Path) -> tuple[dict, dict[tuple, dict]]:
    """Read placements.json.

    Returns:
        The aerial's size ({"width": …, "height": …}) and each placement by
        its grave's key (section, row label, stone number).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    placements = {(place["section"], place["row"], place["stone"]): place
                  for place in data["graves"]}
    return data["image"], placements


def fetch_graves(conn: psycopg.Connection) -> tuple[object, dict[tuple, object]]:
    """Return the cemetery's id and its graves' ids by (section, row label, stone number).

    Raises:
        RuntimeError: the database holds no such cemetery.
    """
    found = conn.execute("SELECT id FROM cemetery WHERE name = %s", (CEMETERY,)).fetchone()
    if found is None:
        raise RuntimeError(f"no cemetery named {CEMETERY!r} in the database")
    graves = {(section, row_label, stone): grave_id for grave_id, section, row_label, stone
              in conn.execute("""SELECT id, section, row_label, stone_number
                                   FROM grave WHERE cemetery_id = %s""", (found[0],))}
    return found[0], graves


def write_placements(conn: psycopg.Connection, image: dict,
                     placements: dict[tuple, dict]) -> dict[str, int]:
    """Store the placements and the aerial's size; return how many graves were placed and cleared.

    Raises:
        RuntimeError: a placement names a grave the database does not hold;
            nothing is written.
    """
    cemetery_id, graves = fetch_graves(conn)
    unknown = sorted(set(placements) - set(graves))
    if unknown:
        raise RuntimeError(f"{len(unknown)} placement(s) name no grave in the database: "
                           f"{unknown[:10]}")
    with conn.cursor() as cursor:
        cursor.executemany(UPDATE_GRAVE, [
            (place["centroid"][0], place["centroid"][1], polygon_literal(place["outline"]),
             graves[key]) for key, place in placements.items()])
        placed = [graves[key] for key in placements]
        cleared = cursor.execute(CLEAR_GRAVES, (cemetery_id, placed)).rowcount
        cursor.execute(UPDATE_SIZE, (image["width"], image["height"], cemetery_id))
    return {"placed": len(placements), "graves": len(graves), "cleared": cleared}


def main() -> None:
    """Write placements.json to the database, or try it and roll back with --dry-run."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--dry-run", action="store_true", help="roll everything back at the end")
    args = parser.parse_args()
    image, placements = read_placements(OUTPUT_FILE)
    url = database_url()
    with psycopg.connect(url) as conn:
        counts = write_placements(conn, image, placements)
        if args.dry_run:
            conn.rollback()
    print(f"{RULE}\nGrave outlines  ({describe_database(url)})\n{RULE}")
    print(f"   graves placed     {counts['placed']} of {counts['graves']}")
    print(f"   outlines cleared  {counts['cleared']}  (graves the file does not place)")
    print(f"   aerial size       {image['width']} × {image['height']} px")
    print(RULE)
    print("dry run: rolled back, nothing changed" if args.dry_run else "committed")


if __name__ == "__main__":
    main()
