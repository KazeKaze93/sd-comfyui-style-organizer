"""Thumbnail file paths and listing (filesystem only, no generation)."""

import hashlib
import os

from .cache import get_cached_styles
from .config import THUMBNAILS_DIR, get_styles_dirs


def _thumbnail_hash_input(style_name, csv_path=""):
    """Stable string for thumbnail filename hash; empty csv_path keeps legacy name-only hash."""
    if not csv_path:
        return style_name
    ap = os.path.normpath(os.path.abspath(csv_path))
    rel = None
    for base in get_styles_dirs():
        try:
            b = os.path.normpath(os.path.abspath(base))
            r = os.path.relpath(ap, b)
            if not r.startswith(".."):
                rel = r.replace("\\", "/")
                break
        except ValueError:
            continue
    if rel is None:
        rel = os.path.basename(ap).replace("\\", "/")
    return f"{style_name}::{rel}"


def get_thumbnail_path(style_name, csv_path=""):
    """Return deterministic thumbnail file path using md5(name + source path) hash naming."""
    safe = hashlib.md5(_thumbnail_hash_input(style_name, csv_path).encode("utf-8")).hexdigest()
    return os.path.join(THUMBNAILS_DIR, safe + ".webp")


def list_thumbnails():
    if not os.path.isdir(THUMBNAILS_DIR):
        return set()
    hashes = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if f.endswith(".webp")
    }
    result = set()
    for s in get_cached_styles():
        h = hashlib.md5(
            _thumbnail_hash_input(s["name"], s.get("source_file") or "").encode("utf-8")
        ).hexdigest()
        if h in hashes:
            result.add(s["name"])
    return result
