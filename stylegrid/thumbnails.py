"""Thumbnail file paths and listing (filesystem only, no generation)."""

import csv
import hashlib
import os
import shutil

from .cache import get_cached_styles
from .config import DATA_DIR, EXT_DIR, THUMBNAILS_DIR, get_styles_dirs
from .source_ids import coerce_source_ref, to_source_id

# Hash is the stem; extension matches on-disk bytes (honest naming, no re-encode).
_THUMB_EXTS = (".webp", ".png", ".jpg", ".jpeg", ".gif")
_RENAME_MAP_BASENAME = "RELEASE_NOTES_RENAMES.csv"


def _legacy_rel_suffix(csv_path):
    """Rel-path part of a pre-source-id hash key (after ``::``)."""
    resolved = coerce_source_ref(csv_path)
    if resolved:
        csv_path = resolved
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
    return rel


def _source_suffix(csv_path):
    """Source-id (or legacy rel) part of a thumbnail hash key (after ``::``)."""
    resolved = coerce_source_ref(csv_path)
    if resolved is not None:
        sid = to_source_id(resolved)
    else:
        sid = to_source_id(os.path.normpath(os.path.abspath(csv_path)))
    if sid:
        return sid
    return _legacy_rel_suffix(csv_path)


def _legacy_rel_hash_input(style_name, csv_path):
    """Pre-source-id hash input: name + path relative to a styles dir."""
    return f"{style_name}::{_legacy_rel_suffix(csv_path)}"


def _thumbnail_hash_input(style_name, csv_path=""):
    """Stable string for thumbnail filename hash; empty csv_path keeps legacy name-only hash."""
    if not csv_path:
        return style_name
    return f"{style_name}::{_source_suffix(csv_path)}"


class _SuffixMemo:
    """Per-call cache of source suffixes; one instance per batch operation."""

    def __init__(self):
        self._new = {}
        self._legacy = {}

    def new(self, source):
        if source not in self._new:
            self._new[source] = _source_suffix(source)
        return self._new[source]

    def legacy(self, source):
        if source not in self._legacy:
            self._legacy[source] = _legacy_rel_suffix(source)
        return self._legacy[source]


def _thumbnail_stem(style_name, csv_path=""):
    return hashlib.md5(_thumbnail_hash_input(style_name, csv_path).encode("utf-8")).hexdigest()


def _legacy_rel_stem(name, source):
    return hashlib.md5(_legacy_rel_hash_input(name, source).encode("utf-8")).hexdigest()

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


def load_renamed_old_names(path):
    """Return the set of old_name values from a RELEASE_NOTES_RENAMES.csv file."""
    names = set()
    if not path or not os.path.isfile(path):
        return names
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            old = (row.get("old_name") or "").strip()
            if old:
                names.add(old)
    return names


def discover_renamed_old_names():
    """Load rename old_names from data/ or extension root when the map file is present."""
    for base in (DATA_DIR, EXT_DIR):
        path = os.path.join(base, _RENAME_MAP_BASENAME)
        if os.path.isfile(path):
            return load_renamed_old_names(path)
    return set()


def _prompt_negative_pair(style):
    return (style.get("prompt") or "", style.get("negative_prompt") or "")


def _content_identical_across_sources(entries):
    """True when every source_file shares the same prompt+negative_prompt bytes."""
    per_source = {}
    for s in entries:
        source = s.get("source_file") or ""
        if not source:
            continue
        pair = _prompt_negative_pair(s)
        prev = per_source.get(source)
        if prev is None:
            per_source[source] = pair
        elif prev != pair:
            return False
    if len(per_source) <= 1:
        return True
    return len(set(per_source.values())) == 1


def migrate_legacy_thumbnails(styles=None, renamed_old_names=None, legacy_names=None):
    """Copy name-only thumbnail files to (name, source) keys when safe.

    Non-destructive: legacy files are copied (extension preserved), never
    renamed or deleted.

    Auto-migrate when the name maps to one source, or to multiple sources whose
    prompt and negative_prompt are byte-identical. Need regeneration when content
    diverges across files, or when the name appears as old_name in a rename map.
    Orphaned: a legacy name with no matching style in the catalog.

    Returns migrated / need_regeneration / orphaned / skipped_existing.
    ``ambiguous`` is kept as an alias of need_regeneration for older callers.
    """
    empty = {
        "migrated": 0,
        "need_regeneration": 0,
        "orphaned": 0,
        "skipped_existing": 0,
        "ambiguous": 0,
    }
    if not os.path.isdir(THUMBNAILS_DIR):
        return empty

    if styles is None:
        styles = get_cached_styles()
    if renamed_old_names is None:
        renamed_old_names = discover_renamed_old_names()
    renamed_old_names = set(renamed_old_names)

    by_name = {}
    for s in styles:
        name = s.get("name") or ""
        source = s.get("source_file") or ""
        if not name or not source:
            continue
        by_name.setdefault(name, []).append(s)

    if legacy_names is None:
        names_to_check = list(by_name.keys())
    else:
        names_to_check = list(dict.fromkeys(legacy_names))

    migrated = 0
    need_regeneration = 0
    orphaned = 0
    skipped_existing = 0
    for name in names_to_check:
        legacy_path = _find_legacy_thumbnail_path(name)
        if not legacy_path:
            continue
        entries = by_name.get(name) or []
        if not entries:
            orphaned += 1
            continue
        if name in renamed_old_names:
            need_regeneration += 1
            continue
        uniq_sources = list(dict.fromkeys(s.get("source_file") or "" for s in entries))
        uniq_sources = [s for s in uniq_sources if s]
        if len(uniq_sources) > 1 and not _content_identical_across_sources(entries):
            need_regeneration += 1
            continue

        ext = os.path.splitext(legacy_path)[1].lower() or ".webp"
        copied_any = False
        all_existed = True
        for source in uniq_sources:
            new_path = get_thumbnail_path(name, source, ext=ext)
            if os.path.isfile(new_path):
                continue
            all_existed = False
            try:
                shutil.copy2(legacy_path, new_path)
                copied_any = True
            except OSError:
                pass
        if copied_any:
            migrated += 1
        elif all_existed and uniq_sources:
            skipped_existing += 1

    return {
        "migrated": migrated,
        "need_regeneration": need_regeneration,
        "orphaned": orphaned,
        "skipped_existing": skipped_existing,
        "ambiguous": need_regeneration,
    }


def migrate_rel_thumbnails(styles=None, memo=None):
    """Link-or-copy rel-path stems onto source-id stems when safe.

    Non-destructive: old files are never moved, renamed, or deleted.
    Existence checks use a single listdir snapshot (stem -> filename).

    Returns linked / copied / need_regeneration / skipped_existing.
    """
    empty = {
        "linked": 0,
        "copied": 0,
        "need_regeneration": 0,
        "skipped_existing": 0,
    }
    if not os.path.isdir(THUMBNAILS_DIR):
        return empty

    if styles is None:
        styles = get_cached_styles()
    if memo is None:
        memo = _SuffixMemo()

    by_stem = {}
    for fname in os.listdir(THUMBNAILS_DIR):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in _THUMB_EXTS:
            continue
        by_stem[os.path.splitext(fname)[0]] = fname

    groups = {}
    for s in styles:
        name = s.get("name") or ""
        source = s.get("source_file") or ""
        if not name or not source:
            continue
        old_stem = hashlib.md5(f"{name}::{memo.legacy(source)}".encode("utf-8")).hexdigest()
        groups.setdefault(old_stem, []).append(s)

    linked = 0
    copied = 0
    need_regeneration = 0
    skipped_existing = 0
    for old_stem, entries in groups.items():
        if all(
            hashlib.md5(
                f"{e.get('name') or ''}::{memo.new(e.get('source_file') or '')}".encode(
                    "utf-8"
                )
            ).hexdigest()
            == old_stem
            for e in entries
        ):
            continue
        old_fname = by_stem.get(old_stem)
        if not old_fname:
            continue

        uniq_sources = list(dict.fromkeys(s.get("source_file") or "" for s in entries))
        uniq_sources = [s for s in uniq_sources if s]
        if len(uniq_sources) > 1 and not _content_identical_across_sources(entries):
            need_regeneration += 1
            continue

        old_path = os.path.join(THUMBNAILS_DIR, old_fname)
        ext = os.path.splitext(old_fname)[1].lower() or ".webp"
        for source in uniq_sources:
            name = next(
                e.get("name") or ""
                for e in entries
                if (e.get("source_file") or "") == source
            )
            new_stem = hashlib.md5(f"{name}::{memo.new(source)}".encode("utf-8")).hexdigest()
            if new_stem in by_stem:
                skipped_existing += 1
                continue
            new_fname = new_stem + ext
            new_path = os.path.join(THUMBNAILS_DIR, new_fname)
            try:
                os.link(old_path, new_path)
                linked += 1
                by_stem[new_stem] = new_fname
            except OSError:
                try:
                    shutil.copy2(old_path, new_path)
                    copied += 1
                    by_stem[new_stem] = new_fname
                except OSError:
                    pass

    return {
        "linked": linked,
        "copied": copied,
        "need_regeneration": need_regeneration,
        "skipped_existing": skipped_existing,
    }


def list_thumbnails():
    """Return [{name, source_file}, ...] for styles with a source-aware thumbnail."""
    migrate_legacy_thumbnails()
    styles = get_cached_styles()
    memo = _SuffixMemo()
    migrate_rel_thumbnails(styles, memo=memo)
    if not os.path.isdir(THUMBNAILS_DIR):
        return []
    on_disk = {
        os.path.splitext(f)[0]
        for f in os.listdir(THUMBNAILS_DIR)
        if os.path.splitext(f)[1].lower() in _THUMB_EXTS
    }
    result = []
    for s in styles:
        source = s.get("source_file") or ""
        if not source:
            continue
        stem = hashlib.md5(f"{s['name']}::{memo.new(source)}".encode("utf-8")).hexdigest()
        if stem in on_disk:
            result.append({"name": s["name"], "source_file": source})
    return result


def valid_thumbnail_hashes():
    """Source-aware stems for every style currently in the catalog."""
    memo = _SuffixMemo()
    return {
        hashlib.md5(f"{s['name']}::{memo.new(s.get('source_file') or '')}".encode("utf-8")).hexdigest()
        for s in get_cached_styles()
        if s.get("source_file")
    }


def cleanup_orphan_thumbnails():
    """Migrate safe legacy thumbs, then remove true orphans.

    Preserves name-only legacy files for styles still in the catalog so
    migration stays rollback-friendly (copy, not delete). Also preserves
    pre-source-id rel-path stems for catalog styles.

    Returns ``{"removed": int, "migrated": int, "need_regeneration": int,
    "orphaned": int, "skipped_existing": int, "ambiguous": int}``.
    """
    migration = migrate_legacy_thumbnails()
    styles = get_cached_styles()
    memo = _SuffixMemo()
    migrate_rel_thumbnails(styles, memo=memo)
    if not os.path.isdir(THUMBNAILS_DIR):
        return {"removed": 0, **migration}
    valid = valid_thumbnail_hashes()
    for s in styles:
        name = s.get("name") or ""
        source = s.get("source_file") or ""
        if name:
            valid.add(legacy_thumbnail_stem(name))
        if name and source:
            valid.add(
                hashlib.md5(f"{name}::{memo.legacy(source)}".encode("utf-8")).hexdigest()
            )
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
