"""Place every grave of the archive on the drone aerial and write placements.json.

The stone mapping works from two registers in this folder:

1. `rows.json` says where each row of each section lies on the aerial, how
   it is placed (`placement`), and at which end its stone 1 was photographed
   (`stone_1_at`, read from the field spreadsheet);
2. `graves.json` holds the graves traced on the aerial for each row, as boxes
   listed from the row's middle-path end (or, for a row placed stone by
   stone, as boxes keyed by stone number), and the miscellaneous area.

This script reads every grave of the archive from the database (read only),
gives each stone an outline and its centroid, and writes `placements.json` in
the format `backend/import.py --placements` reads. How a stone is placed
depends on its row:

- "row": stones are counted along the row's graves from the end where stone 1
  is. A row with more graves than stones leaves its last graves empty, and a
  stone past the row's last grave is left unplaced; both are reported. Stones
  listed together under `same_grave` were photographed twice and share a grave.
- "single": the row's one stone takes the row's one grave.
- "by_stone": a row that was not photographed in order (the scattered graves
  on the outskirts). Each stone takes the box listed under its own number, and
  a stone with no box shares the miscellaneous area. Stones left on the area,
  and boxes listed for stones the archive does not hold, are reported.
- "misc": every stone of the row shares the miscellaneous area.

    .conda/bin/python place_stones.py            # write placements.json
    .conda/bin/python place_stones.py --check    # report only, write nothing
"""
import argparse
import json
import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.conninfo import conninfo_to_dict

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
MAPPING_DIR = Path(__file__).resolve().parent
ROWS_FILE   = MAPPING_DIR / "rows.json"         # row register (where, which end first)
GRAVES_FILE = MAPPING_DIR / "graves.json"       # traced graves and the misc area
OUTPUT_FILE = MAPPING_DIR / "placements.json"   # what import.py and update_database.py read
ENV_FILE    = MAPPING_DIR.parent / "backend" / ".env"   # DATABASE_URL=postgresql://…
CEMETERY    = "Cementerio Israelita, Colonia N.º 1"     # the cemetery the aerial shows
RULE        = "─" * 72                                  # frames the printed report


# ═════════════════════════════════════════════════════════════════════════════
# GEOMETRY
# ═════════════════════════════════════════════════════════════════════════════
def box_outline(box: list[float]) -> list[list[float]]:
    """Return a box's corners as an outline.

    Args:
        box: [x0, y0, x1, y1] in pixels of the aerial.

    Returns:
        The four corners, clockwise from the top left: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].
    """
    x0, y0, x1, y1 = box
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def polygon_centroid(points: list[list[float]]) -> list[float]:
    """Return the centroid of a simple polygon (the centre of its area).

    Args:
        points: the polygon's corners in order, without repeating the first.

    Returns:
        [x, y], rounded to a tenth of a pixel.
    """
    # The shoelace formula: each edge adds the signed area of the triangle it
    # makes with the origin, and that triangle's centroid weighted by its area.
    area = centre_x = centre_y = 0.0
    for (x0, y0), (x1, y1) in zip(points, points[1:] + points[:1]):
        cross = x0 * y1 - x1 * y0
        area += cross
        centre_x += (x0 + x1) * cross
        centre_y += (y0 + y1) * cross
    area /= 2
    return [round(centre_x / (6 * area), 1), round(centre_y / (6 * area), 1)]


# ═════════════════════════════════════════════════════════════════════════════
# PLACING STONES
# ═════════════════════════════════════════════════════════════════════════════
def group_stones(numbers: list[int], same_grave: list[list[int]]) -> list[list[int]]:
    """Group a row's stone numbers into graves, in numbering order.

    Args:
        numbers: the row's stone numbers, as the archive holds them.
        same_grave: lists of stone numbers that are one grave photographed twice.

    Returns:
        One list of stone numbers per grave, ordered by their lowest number:
        [1, 2, 3, 11, 12] with same_grave [[11, 12]] → [[1], [2], [3], [11, 12]].
    """
    together = {number: group for group in same_grave for number in group}
    graves, seen = [], set()
    for number in sorted(numbers):
        if number in seen:
            continue
        group = [n for n in together.get(number, [number]) if n in numbers]
        seen.update(group)
        graves.append(group)
    return graves


def place_row(row: dict, boxes: list[list[float]], numbers: list[int]) -> tuple[dict, str | None]:
    """Count a row's stones along its graves from the end where stone 1 is.

    Args:
        row: the row's entry in rows.json (`stone_1_at`, optional `same_grave`).
        boxes: the row's graves from graves.json, listed from the middle-path end.
        numbers: the row's stone numbers in the archive.

    Returns:
        The outline of each stone placed, by stone number, and a note on any
        mismatch between stones and graves (None when every grave has a stone).
    """
    if row["stone_1_at"] == "wall":
        boxes = boxes[::-1]                     # stone 1 is at the wall end
    graves = group_stones(numbers, row.get("same_grave", []))
    outlines = {}
    for box, group in zip(boxes, graves):
        for number in group:
            outlines[number] = box_outline(box)
    note = None
    if len(graves) < len(boxes):
        note = f"{len(boxes) - len(graves)} grave(s) left empty at the far end"
    elif len(graves) > len(boxes):
        unplaced = [n for group in graves[len(boxes):] for n in group]
        note = f"stone(s) {unplaced} past the last grave, unplaced"
    return outlines, note


def place_by_stone(boxes: dict[str, list[float]], numbers: list[int],
                   misc_area: list[list[float]]) -> tuple[dict, str | None]:
    """Give each stone of a scattered row the box listed under its number.

    Args:
        boxes: the row's graves from graves.json, by stone number ("1": [x0, y0, x1, y1]).
            Two stones may list the same box: one grave with two stones.
        numbers: the row's stone numbers in the archive.
        misc_area: the miscellaneous area, for stones with no box of their own.

    Returns:
        The outline of each stone, by stone number, and a note listing the
        stones left on the miscellaneous area and any box listed for a stone
        the archive does not hold (None when neither happens).
    """
    outlines = {number: box_outline(boxes[str(number)]) if str(number) in boxes else misc_area
                for number in numbers}
    on_misc = [number for number in sorted(numbers) if str(number) not in boxes]
    unused = sorted(int(key) for key in boxes if int(key) not in numbers)
    notes = []
    if on_misc:
        notes.append(f"stone(s) {on_misc} on the misc area")
    if unused:
        notes.append(f"box(es) for stone(s) {unused} not in the archive, unused")
    return outlines, "; ".join(notes) or None


def place_one_row(row: dict, boxes: list | dict | None, numbers: list[int],
                  misc_area: list[list[float]]) -> tuple[dict, str | None]:
    """Place one row's stones the way its `placement` in rows.json says.

    Args:
        row: the row's entry in rows.json.
        boxes: the row's graves from graves.json: a list from the middle-path
            end for "row" and "single", a dictionary by stone number for
            "by_stone", and None for "misc".
        numbers: the row's stone numbers in the archive.
        misc_area: the miscellaneous area.

    Returns:
        The outline of each stone placed, by stone number, and a note on
        anything that does not fit (None when everything does).

    Raises:
        ValueError: the row's graves in graves.json are missing, or are not
            the kind its placement needs.
    """
    if row["placement"] == "misc":
        return {number: misc_area for number in numbers}, None
    wanted = dict if row["placement"] == "by_stone" else list
    if not isinstance(boxes, wanted):
        raise ValueError(f"{row['section']} {row['row']}: placement {row['placement']!r} needs its "
                         f"graves in graves.json as a {wanted.__name__}")
    if row["placement"] == "by_stone":
        return place_by_stone(boxes, numbers, misc_area)
    return place_row(row, boxes, numbers)          # "row" and "single"


def place_all(rows: list[dict], graves: dict, stones: dict[tuple, list[int]]) -> tuple[list, list]:
    """Place every stone of the archive.

    Args:
        rows: the `rows` list of rows.json.
        graves: graves.json (its `rows` and `areas`).
        stones: the archive's stone numbers by (section, row label).

    Returns:
        The placements, in the format of placements.json's `graves` list, and
        report lines on every row that does not fit exactly.
    """
    boxes_by_row = {(entry["section"], entry["row"]): entry["graves"] for entry in graves["rows"]}
    rows_by_key = {(row["section"], row["row"]): row for row in rows}
    placements, report = [], []
    for key, numbers in sorted(stones.items()):
        row = rows_by_key.get(key)
        if row is None:
            report.append(f"!! {key[0]} {key[1]}: not in rows.json, "
                          f"{len(numbers)} stone(s) unplaced")
            continue
        outlines, note = place_one_row(row, boxes_by_row.get(key), numbers,
                                       graves["areas"]["misc"])
        if note:
            report.append(f"   {key[0]} {key[1]}: {len(numbers)} stones, "
                          f"{len(boxes_by_row.get(key, []))} graves; {note}")
        for number in sorted(outlines):
            outline = outlines[number]
            placements.append({"section": key[0], "row": key[1], "stone": number,
                               "centroid": polygon_centroid(outline), "outline": outline})
    return placements, report


# ═════════════════════════════════════════════════════════════════════════════
# FILES AND DATABASE
# ═════════════════════════════════════════════════════════════════════════════
def read_json(path: Path) -> dict:
    """Return the contents of a JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


def database_url() -> str:
    """Return DATABASE_URL, from the environment or else backend/.env.

    Raises:
        RuntimeError: it is set in neither place.
    """
    load_dotenv(ENV_FILE)                        # a variable set in the shell wins
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is not set: add it to backend/.env or the environment")
    return url


def describe_database(url: str) -> str:
    """Return a database's name and host, without its password."""
    parts = conninfo_to_dict(url)
    return f"{parts.get('dbname', '?')} on {parts.get('host', 'localhost')}"


def fetch_stones(conn: psycopg.Connection) -> dict[tuple, list[int]]:
    """Return the cemetery's stone numbers by (section, row label), as the database holds them."""
    stones: dict[tuple, list[int]] = {}
    for section, row_label, stone in conn.execute(
            """SELECT grave.section, grave.row_label, grave.stone_number
                 FROM grave JOIN cemetery ON cemetery.id = grave.cemetery_id
                WHERE cemetery.name = %s""", (CEMETERY,)):
        stones.setdefault((section, row_label), []).append(stone)
    return stones


def write_placements(path: Path, image: dict, placements: list[dict]) -> None:
    """Write placements.json, one grave per line so that a change shows as a short diff."""
    lines = [json.dumps(place, ensure_ascii=False) for place in placements]
    path.write_text('{"image": ' + json.dumps(image) + ',\n "graves": [\n  '
                    + ",\n  ".join(lines) + "\n ]}\n", encoding="utf-8")


def main() -> None:
    """Read the registers and the archive's graves, place every stone and write placements.json."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("--check", action="store_true", help="report only, write nothing")
    args = parser.parse_args()
    rows, graves = read_json(ROWS_FILE)["rows"], read_json(GRAVES_FILE)
    url = database_url()
    with psycopg.connect(url) as conn:
        stones = fetch_stones(conn)
    placements, report = place_all(rows, graves, stones)
    total = sum(len(numbers) for numbers in stones.values())
    print(f"{RULE}\nStone placements  ({describe_database(url)})\n{RULE}")
    print("\n".join(report) if report else "   every row fits its graves exactly")
    print(RULE)
    print(f"{len(placements)} of {total} graves placed")
    if not args.check:
        image = {"width": graves["image"]["width"], "height": graves["image"]["height"]}
        write_placements(OUTPUT_FILE, image, placements)
        print(f"written to {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()
