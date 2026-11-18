import filecmp
import shutil
from pathlib import Path

# Set up paths
DATA_DIR = Path("data")
RAW_DIR = DATA_DIR / "raw"
OUTPUT_DIR = DATA_DIR

IGNORED_FILE_NAMES = {".DS_Store", "Thumbs.db", "desktop.ini"}

def is_ignored(path: Path) -> bool:
    return path.name in IGNORED_FILE_NAMES or path.name.startswith(".")

def list_photos(folder: Path) -> list[Path]:
    return sorted(path.relative_to(folder) for path in folder.rglob("*")
                  if path.is_file() and not is_ignored(path))

def copy_photo(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)

def merge_batches(raw_dir: Path, output_dir: Path) -> None:
    batches = sorted(path for path in raw_dir.iterdir() if path.is_dir())
    
    copied = 0
    already_present = 0
    conflicts = 0

    print(f"Merging {len(batches)} batches from {raw_dir} into {output_dir}...")
    
    for batch_dir in batches:
        for relative_path in list_photos(batch_dir):
            source = batch_dir / relative_path
            destination = output_dir / relative_path
            
            if not destination.exists():
                copy_photo(source, destination)
                copied += 1
            elif filecmp.cmp(source, destination, shallow=False):
                already_present += 1
            else:
                conflicts += 1
                print(f"Conflict: {relative_path} (kept first batch's version)")

    print("-" * 40)
    print("Merge Report:")
    print(f"  Copied:          {copied}")
    print(f"  Already present: {already_present}")
    print(f"  Conflicts:       {conflicts}")
    print("-" * 40)

if __name__ == "__main__":
    if RAW_DIR.exists():
        merge_batches(RAW_DIR, OUTPUT_DIR)
    else:
        print(f"Error: Could not find {RAW_DIR}. Ensure your batches are in ocr_pipeline/data/raw/")
