"""Draw placements.json on the drone aerial, so that the placements can be checked by eye.

Each grave's outline is drawn in its section's colour (women red, children
blue, the shared miscellaneous area magenta), with its stone number inside it
and the row label at stone 1, so that the numbering direction of every row
shows at a glance. It draws on the aerial in this folder unless `--aerial`
names another copy.

    .conda/bin/python draw_placements.py high_quality_aerial_placements.jpg --scale 1
    .conda/bin/python draw_placements.py women.png --crop 2100 700 3750 1400 --scale 1
"""
import argparse
import json
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont

from place_stones import GRAVES_FILE, MAPPING_DIR, OUTPUT_FILE

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
AERIAL     = MAPPING_DIR / "high_quality_aerial.JPG"                # the drone aerial, 4096 × 3072
COLOURS    = {"women": (230, 40, 40), "children": (30, 150, 255)}   # outline colour by section
MISC_COLOR = (255, 0, 255)                                         # the shared misc area
TEXT_FILL  = (255, 255, 255)                                       # stone numbers
TEXT_EDGE  = (0, 0, 0)                                             # outline around the text


@dataclass
class Canvas:
    """A scaled crop of the aerial being drawn on, with its fonts."""
    image: Image.Image
    crop: tuple[int, int, int, int]     # (x0, y0, x1, y1) of the aerial, in its pixels
    scale: float                        # enlargement of the crop

    def __post_init__(self) -> None:
        """Set up the pen and the two text sizes for this scale."""
        self.pen = ImageDraw.Draw(self.image)
        self.small = ImageFont.load_default(size=max(8, round(13 * self.scale)))
        self.large = ImageFont.load_default(size=max(10, round(22 * self.scale)))

    def at(self, point: list[float]) -> tuple[float, float]:
        """Return a point of the aerial in pixels of this canvas."""
        return (point[0] - self.crop[0]) * self.scale, (point[1] - self.crop[1]) * self.scale

    def draw_place(self, places: list[dict], is_misc: bool) -> None:
        """Draw one outline and label it with the stones placed on it.

        Args:
            places: the entries of placements.json that share this outline:
                usually one, two for a grave photographed twice.
            is_misc: whether the outline is the miscellaneous area, which is
                labelled "misc" since many stones share it.
        """
        first = places[0]
        colour = MISC_COLOR if is_misc else COLOURS[first["section"]]
        corners = [self.at(point) for point in first["outline"]]
        self.pen.polygon(corners, outline=colour, width=max(1, round(2 * self.scale)))
        if is_misc:
            label, font = "misc", self.large
        elif len(places) > 1:                    # one grave, several stones: name each
            label = " / ".join(f"{place['row']}:{place['stone']}" for place in places)
            font = self.small
        elif first["stone"] == 1:                # the row label marks where stone 1 is
            label, font = f"{first['row']}:1", self.large
        else:
            label, font = str(first["stone"]), self.small
        self.pen.text(self.at(first["centroid"]), label, fill=TEXT_FILL, font=font,
                      anchor="mm", stroke_width=2, stroke_fill=TEXT_EDGE)


def draw(aerial_path: str, out_path: str, crop: tuple[int, int, int, int], scale: float) -> int:
    """Draw every placement inside `crop` and save the picture.

    Args:
        aerial_path: the drone aerial the placements are measured on.
        out_path: where to save the picture (PNG or JPEG).
        crop: (x0, y0, x1, y1), the part of the aerial to draw, in its pixels.
        scale: how much to enlarge (> 1) or shrink (< 1) the crop.

    Returns:
        How many outlines were drawn: an outline shared by several stones
        (the misc area, or one grave photographed twice) counts once.
    """
    places = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))["graves"]
    misc_area = json.loads(GRAVES_FILE.read_text(encoding="utf-8"))["areas"]["misc"]
    image = Image.open(aerial_path).convert("RGB").crop(crop)
    image = image.resize((round(image.width * scale), round(image.height * scale)))
    canvas = Canvas(image, crop, scale)
    by_outline: dict[tuple, list[dict]] = {}   # stones grouped by the outline they share
    for place in places:
        by_outline.setdefault(tuple(map(tuple, place["outline"])), []).append(place)
    for sharing in by_outline.values():
        canvas.draw_place(sharing, sharing[0]["outline"] == misc_area)
    image.save(out_path, quality=92)               # JPEG quality; PNG ignores it
    return len(by_outline)


def main() -> None:
    """Read the arguments, draw the placements and say where the picture went."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("out", help="the picture to write (PNG or JPEG)")
    parser.add_argument("--aerial", default=str(AERIAL),
                        help="the drone aerial (default: high_quality_aerial.JPG in this folder)")
    parser.add_argument("--crop", type=int, nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                        help="draw only this part of the aerial (default: all of it)")
    parser.add_argument("--scale", type=float, default=0.5, help="enlargement (default 0.5)")
    args = parser.parse_args()
    with Image.open(args.aerial) as aerial:
        crop = tuple(args.crop) if args.crop else (0, 0, aerial.width, aerial.height)
    count = draw(args.aerial, args.out, crop, args.scale)
    print(f"{count} outlines drawn to {args.out}")


if __name__ == "__main__":
    main()
