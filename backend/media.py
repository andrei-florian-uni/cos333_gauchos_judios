"""Prepare and upload gravestone photographs to Cloudinary.

This script traverses the local fieldwork photo directories, resizes each image
to a maximum dimension of 2048 pixels to respect Cloudinary's limits, uploads
them, and generates a CSV manifest for the database loader (import.py).

Run it locally from `backend/` with `python media.py`.
"""

import argparse
import csv
import io
import os
import re
from pathlib import Path

import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv
from PIL import Image, ImageOps

# ═════════════════════════════════════════════════════════════════════════════
# SETTINGS
# ═════════════════════════════════════════════════════════════════════════════
BACKEND_DIR = Path(__file__).resolve().parent
ENV_FILE = BACKEND_DIR / ".env"
DEFAULT_DATA_DIR = BACKEND_DIR.parent / "ocr_pipeline" / "data"
OUTPUT_CSV = BACKEND_DIR / "photos_manifest.csv"

MAX_DIMENSION = 2048
CSV_COLUMNS = [
    "section", "row", "stone", "kind", "public_id", 
    "width", "height", "sort_order"
]
MIME_TYPES = {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}

# ═════════════════════════════════════════════════════════════════════════════
# CLOUDINARY UPLOAD & IMAGE PROCESSING
# ═════════════════════════════════════════════════════════════════════════════
def configure_cloudinary() -> None:
    """Load credentials from .env and configure the Cloudinary SDK."""
    load_dotenv(ENV_FILE)
    cloudinary.config(
        cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
        api_key=os.environ.get("CLOUDINARY_API_KEY"),
        api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
        secure=True
    )


def process_image(image_path: Path) -> io.BytesIO:
    """Resize an image to MAX_DIMENSION while keeping its aspect ratio.

    The image is transposed first to respect EXIF rotation data, then saved
    into an in-memory buffer to avoid writing temporary files to the disk.
    """
    with Image.open(image_path) as img:
        img = ImageOps.exif_transpose(img)
        
        if max(img.size) > MAX_DIMENSION:
            img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.Resampling.LANCZOS)
        
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85)
        buffer.seek(0)
        return buffer


def upload_to_cloudinary(image_path: Path, public_id: str) -> dict:
    """Process and upload a single image to Cloudinary.

    Args:
        image_path: The local path to the photograph.
        public_id: The deterministic ID Cloudinary will use to store the image.

    Returns:
        The Cloudinary API response dictionary containing width and height.
    """
    image_buffer = process_image(image_path)
    return cloudinary.uploader.upload(
        image_buffer,
        public_id=public_id,
        folder="gauchos_judios",
        overwrite=True
    )


# ═════════════════════════════════════════════════════════════════════════════
# FOLDER TRAVERSAL & MANIFEST GENERATION
# ═════════════════════════════════════════════════════════════════════════════
def extract_location(section_name: str, row_name: str, stone_name: str) -> dict:
    """Clean the folder names into the strings import.py expects."""
    return {
        "section": section_name.lower(),
        "row": row_name.replace("Row", "").strip(),
        "stone": re.sub(r"[^\d]", "", stone_name)
    }


def natural_sort_key(name: str) -> list:
    """Sort filenames naturally (e.g., stone 2 before stone 10)."""
    return [int(part) if part.isdigit() else part.lower() 
            for part in re.split(r"(\d+)", name)]


def process_graves(data_dir: Path) -> list[dict]:
    """Traverse the data directory, upload photos, and build the CSV rows."""
    manifest_rows = []
    
    # Iterate Sections (Women, Children)
    for section_dir in sorted([d for d in data_dir.iterdir() if d.is_dir() and d.name != "raw"]):
        
        # Iterate Rows
        for row_dir in sorted([d for d in section_dir.iterdir() if d.is_dir()], key=lambda x: natural_sort_key(x.name)):
            
            # Iterate Stones
            for stone_dir in sorted([d for d in row_dir.iterdir() if d.is_dir()], key=lambda x: natural_sort_key(x.name)):
                
                photos = sorted([f for f in stone_dir.iterdir() if f.is_file() and f.suffix.lower() in MIME_TYPES])
                location = extract_location(section_dir.name, row_dir.name, stone_dir.name)
                
                for sort_order, photo_path in enumerate(photos):
                    # The first photo (or explicitly named 'front') is the main photo
                    kind = "main" if sort_order == 0 or "front" in photo_path.name.lower() else "other"
                    
                    # Create a clean, deterministic Cloudinary ID
                    safe_filename = photo_path.stem.replace(" ", "_")
                    public_id = f"{location['section']}_{location['row']}_{location['stone']}_{safe_filename}"
                    
                    print(f"Uploading {photo_path.name} to {public_id}...")
                    response = upload_to_cloudinary(photo_path, public_id)
                    
                    manifest_rows.append({
                        **location,
                        "kind": kind,
                        "public_id": response["public_id"],
                        "width": response["width"],
                        "height": response["height"],
                        "sort_order": sort_order
                    })
                    
    return manifest_rows


def main() -> None:
    """Parse arguments, upload all photos, and write the CSV manifest."""
    parser = argparse.ArgumentParser(description="Upload gravestone photos to Cloudinary.")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, 
                        help="Path to the root data directory containing section folders.")
    args = parser.parse_args()

    configure_cloudinary()
    
    print(f"Starting upload process from {args.data_dir}...")
    manifest_rows = process_graves(args.data_dir)
    
    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(manifest_rows)
        
    print(f"\nUpload complete! Manifest saved to {OUTPUT_CSV}.")
    print("You can now run the importer: python import.py --photos photos_manifest.csv")


if __name__ == "__main__":
    main()
