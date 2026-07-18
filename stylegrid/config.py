"""Paths and CSV discovery for Style Grid (ComfyUI). Packs live in data/."""

import logging
import os

logger = logging.getLogger("StyleGrid")

# stylegrid/ package dir -> repo root -> data/
PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(PACKAGE_DIR)
DATA_DIR = os.path.join(EXT_DIR, "data")
SAMPLES_DIR = os.path.join(EXT_DIR, "samples")
PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
USAGE_FILE = os.path.join(DATA_DIR, "usage.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
os.makedirs(THUMBNAILS_DIR, exist_ok=True)


def _csvs_in(dirpath):
    if not os.path.isdir(dirpath):
        return []
    return [
        os.path.join(dirpath, fname)
        for fname in sorted(os.listdir(dirpath))
        if fname.lower().endswith(".csv")
    ]


def get_all_styles_file_paths():
    """Abs paths of every .csv in data/ then samples/, sorted within each dir."""
    return _csvs_in(DATA_DIR) + _csvs_in(SAMPLES_DIR)


def get_styles_dirs():
    """Directories searched for style CSVs, used to compute thumbnail-hash relpaths."""
    return [DATA_DIR, SAMPLES_DIR]
