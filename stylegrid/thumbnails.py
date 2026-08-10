"""Thumbnail file paths and listing (filesystem only, no generation)."""

import hashlib
import os

from .cache import get_cached_styles
from .config import THUMBNAILS_DIR, get_styles_dirs

# Hash is the stem; extension matches on-disk bytes (honest naming, no re-encode).
_THUMB_EXTS = (".webp", ".png", ".jpg", ".jpeg", ".gif")


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


def _thumbnail_stem(style_name, csv_path=""):
    return hashlib.md5(_thumbnail_hash_input(style_name, csv_path).encode("utf-8")).hexdigest()


def detect_image_ext(raw):
    """Return file extension for image magic bytes, or None if not allowed."""
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a"):
        return ".gif"
    if raw.startswith(b"RIFF") and len(raw) >= 12 and raw[8:12] == b"WEBP":
        return ".webp"
    return None


def get_thumbnail_path(style_name, csv_path="", ext=".webp"):
    """Return thumbnail path for hash stem + extension (default .webp for legacy)."""
    if not ext.startswith("."):
        ext = "." + ext
    return os.path.join(THUMBNAILS_DIR, _thumbnail_stem(style_name, csv_path) + ext.lower())


def find_thumbnail_path(style_name, csv_path=""):
    """Return path of an existing thumbnail for this style, any allowed extension."""
    stem = _thumbnail_stem(style_name, csv_path)
    for ext in _THUMB_EXTS:
        path = os.path.join(THUMBNAILS_DIR, stem + ext)
        if os.path.isfile(path):
            return path
    return None


def clear_thumbnail_files(style_name, csv_path=""):
    """Remove every on-disk variant for this style hash (all extensions)."""
    stem = _thumbnail_stem(style_name, csv_path)
    for ext in _THUMB_EXTS:
        path = os.path.join(THUMBNAILS_DIR, stem + ext)
        if os.path.isfile(path):
            try:
                os.remove(path)
            except OSError:
                pass


def list_thumbnails():
    if not os.path.isdir(THUMBNAILS_DIR):
        return set()
    on_disk = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if os.path.splitext(f)[1].lower() in _THUMB_EXTS
    }
    return {
        s["name"]
        for s in get_cached_styles()
        if _thumbnail_stem(s["name"], s.get("source_file") or "") in on_disk
    }


def valid_thumbnail_hashes():
    """Source-aware stems for every style currently in the catalog."""
    return {
        _thumbnail_stem(s["name"], s.get("source_file") or "")
        for s in get_cached_styles()
    }


def cleanup_orphan_thumbnails():
    """Remove on-disk thumbs whose stem is not in valid_thumbnail_hashes(). Returns count removed."""
    if not os.path.isdir(THUMBNAILS_DIR):
        return 0
    valid = valid_thumbnail_hashes()
    removed = 0
    for fname in os.listdir(THUMBNAILS_DIR):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in _THUMB_EXTS:
            continue
        h = os.path.splitext(fname)[0]
        if h in valid:
            continue
        try:
            os.remove(os.path.join(THUMBNAILS_DIR, fname))
            removed += 1
        except OSError:
            pass
    return removed
