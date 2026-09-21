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


def thumbnail_hash_key(name: str, source: str) -> str:
    """Canonical thumbnail identity hash for (name, source)."""
    if not source:
        raise ValueError("thumbnail_hash_key requires a non-empty source")
    return _thumbnail_stem(name, source)


def legacy_thumbnail_stem(style_name: str) -> str:
    """Pre-source-aware stem: md5(style name only)."""
    return _thumbnail_stem(style_name, "")


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


def _find_legacy_thumbnail_path(style_name: str):
    """Return path of a name-only legacy thumbnail if present."""
    stem = legacy_thumbnail_stem(style_name)
    for ext in _THUMB_EXTS:
        path = os.path.join(THUMBNAILS_DIR, stem + ext)
        if os.path.isfile(path):
            return path
    return None


def migrate_legacy_thumbnails(styles=None):
    """Move name-only thumbnail files to (name, source) keys when unambiguous.

    If a style name maps to exactly one known source_file, rename the legacy
    file to the source-aware path (keeping extension). If the same name appears
    in multiple packs, leave the legacy file unmapped (needs regeneration).

    Returns counts: migrated / ambiguous / skipped_existing.
    """
    if not os.path.isdir(THUMBNAILS_DIR):
        return {"migrated": 0, "ambiguous": 0, "skipped_existing": 0}

    if styles is None:
        styles = get_cached_styles()

    by_name = {}
    for s in styles:
        name = s.get("name") or ""
        source = s.get("source_file") or ""
        if not name or not source:
            continue
        by_name.setdefault(name, []).append(source)

    migrated = 0
    ambiguous = 0
    skipped_existing = 0
    for name, sources in by_name.items():
        uniq_sources = list(dict.fromkeys(sources))
        legacy_path = _find_legacy_thumbnail_path(name)
        if not legacy_path:
            continue
        if len(uniq_sources) != 1:
            ambiguous += 1
            continue
        ext = os.path.splitext(legacy_path)[1].lower() or ".webp"
        new_path = get_thumbnail_path(name, uniq_sources[0], ext=ext)
        if os.path.isfile(new_path):
            skipped_existing += 1
            try:
                os.remove(legacy_path)
            except OSError:
                pass
            continue
        try:
            os.rename(legacy_path, new_path)
            migrated += 1
        except OSError:
            pass
    return {
        "migrated": migrated,
        "ambiguous": ambiguous,
        "skipped_existing": skipped_existing,
    }


def list_thumbnails():
    """Return [{name, source_file}, ...] for styles with a source-aware thumbnail."""
    migrate_legacy_thumbnails()
    if not os.path.isdir(THUMBNAILS_DIR):
        return []
    on_disk = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if os.path.splitext(f)[1].lower() in _THUMB_EXTS
    }
    result = []
    for s in get_cached_styles():
        source = s.get("source_file") or ""
        if not source:
            continue
        if _thumbnail_stem(s["name"], source) in on_disk:
            result.append({"name": s["name"], "source_file": source})
    return result


def valid_thumbnail_hashes():
    """Source-aware stems for every style currently in the catalog."""
    return {
        _thumbnail_stem(s["name"], s.get("source_file") or "")
        for s in get_cached_styles()
        if s.get("source_file")
    }


def cleanup_orphan_thumbnails():
    """Migrate unique legacy thumbs, then remove orphans.

    Returns ``{"removed": int, "migrated": int, "ambiguous": int, "skipped_existing": int}``.
    """
    migration = migrate_legacy_thumbnails()
    if not os.path.isdir(THUMBNAILS_DIR):
        return {"removed": 0, **migration}
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
    return {"removed": removed, **migration}
