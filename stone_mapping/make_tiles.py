"""Cut the drone aerial into the tile pyramid that the cemetery map draws.

The map (`frontend/src/CemeteryMap.jsx`) uses Leaflet's CRS.Simple, where one
map unit is one pixel of the aerial, the same pixels the grave outlines are
traced in. Leaflet asks for one 256 × 256 tile at a time, by level, column and
row. The top level is the aerial at full size, each level below halves it, and
level 0 fits the whole aerial into a single tile (Project Design › OCR and DB
Ingestion › Aerial map tiles).

Edge tiles are padded to the full tile size with the map's background colour,
since Leaflet stretches every tile image to the full size.

The tiles are written to `frontend/public/tiles/<level>/<column>/<row>.jpg`.
Vite copies that folder into the built site, so the tiles deploy with the
Render static site and are served under `/tiles`. Running the script again
replaces them.

    .conda/bin/python make_tiles.py                  # from stone_mapping/
"""
import argparse
import math
import shutil
from pathlib import Path

from PIL import Image

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
MAPPING_DIR  = Path(__file__).resolve().parent
AERIAL       = MAPPING_DIR / "high_quality_aerial.JPG"                     # 4096 × 3072
TILES_DIR    = MAPPING_DIR.parent / "frontend" / "public" / "tiles"        # served at /tiles
TILE         = 256                       # pixels per tile side; Leaflet's default tile size
QUALITY      = 82                        # JPEG quality: sharp stones at about a third the size
BACKGROUND   = (236, 229, 214)           # the map canvas's colour (#ece5d6), for edge padding


def level_count(width: int, height: int, tile: int = TILE) -> int:
    """Return how many levels the pyramid has: enough halvings to fit one tile.

    Args:
        width: the aerial's width in pixels.
        height: the aerial's height in pixels.
        tile: the side of a tile in pixels.

    Returns:
        The number of levels; for 4096 × 3072 with 256-pixel tiles, 5 (0 to 4).
        The frontend works out the same number from the image size the API
        gives (`tileLevels` in `mapLayout.js`), so the two must agree.
    """
    return max(0, math.ceil(math.log2(max(width, height) / tile))) + 1


def cut_level(aerial: Image.Image, level: int, top_level: int, out_dir: Path) -> int:
    """Resize the aerial for one level and save its tiles.

    Args:
        aerial: the full-size aerial.
        level: the level to cut, from 0 (smallest) to `top_level` (full size).
        top_level: the full-size level.
        out_dir: the folder holding every level's tiles.

    Returns:
        The number of tiles written.
    """
    scale = 2 ** (level - top_level)
    width = max(1, round(aerial.width * scale))
    height = max(1, round(aerial.height * scale))
    image = aerial if scale == 1 else aerial.resize((width, height), Image.Resampling.LANCZOS)

    count = 0
    for column in range(math.ceil(width / TILE)):
        for row in range(math.ceil(height / TILE)):
            box = (column * TILE, row * TILE,
                   min((column + 1) * TILE, width), min((row + 1) * TILE, height))
            tile = Image.new("RGB", (TILE, TILE), BACKGROUND)
            tile.paste(image.crop(box), (0, 0))
            path = out_dir / str(level) / str(column) / f"{row}.jpg"
            path.parent.mkdir(parents=True, exist_ok=True)
            tile.save(path, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            count += 1
    return count


def make_tiles(aerial_path: Path, out_dir: Path) -> None:
    """Cut every level of the pyramid, replacing any tiles already in `out_dir`.

    Args:
        aerial_path: the aerial image to cut.
        out_dir: where the levels go.
    """
    with Image.open(aerial_path) as opened:
        aerial = opened.convert("RGB")
    levels = level_count(aerial.width, aerial.height)
    if out_dir.exists():
        shutil.rmtree(out_dir)
    for level in range(levels):
        written = cut_level(aerial, level, levels - 1, out_dir)
        print(f"  level {level}: {written:4d} tiles")
    print(f"{aerial.width} × {aerial.height} aerial cut into {levels} levels in {out_dir}")


def main() -> None:
    """Read the command line and cut the tiles."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n", maxsplit=1)[0])
    parser.add_argument("--aerial", type=Path, default=AERIAL, help="the image to cut")
    parser.add_argument("--out", type=Path, default=TILES_DIR, help="the folder to write")
    arguments = parser.parse_args()
    make_tiles(arguments.aerial, arguments.out)


if __name__ == "__main__":
    main()
