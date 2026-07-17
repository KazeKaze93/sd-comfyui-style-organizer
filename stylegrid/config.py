"""Paths and CSV discovery for Style Grid (ComfyUI). Packs live in data/."""

import logging
import os

logger = logging.getLogger("StyleGrid")

# stylegrid/ package dir -> repo root -> data/
PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(PACKAGE_DIR)
DATA_DIR = os.path.join(EXT_DIR, "data")
SAMPLES_DIR = os.path.join(EXT_DIR, "samples")

os.makedirs(DATA_DIR, exist_ok=True)


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
