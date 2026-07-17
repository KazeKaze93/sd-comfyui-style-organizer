"""Paths and CSV discovery for Style Grid (ComfyUI). Packs live in data/."""

import logging
import os

logger = logging.getLogger("StyleGrid")

# stylegrid/ package dir -> repo root -> data/
PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(PACKAGE_DIR)
DATA_DIR = os.path.join(EXT_DIR, "data")

os.makedirs(DATA_DIR, exist_ok=True)


def get_all_styles_file_paths():
    """Return absolute paths of every .csv in data/, sorted. Empty list if none."""
    if not os.path.isdir(DATA_DIR):
        return []
    return [
        os.path.join(DATA_DIR, fname)
        for fname in sorted(os.listdir(DATA_DIR))
        if fname.lower().endswith(".csv")
    ]
