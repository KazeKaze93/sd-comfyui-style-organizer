"""Paths and CSV discovery for Style Grid (ComfyUI).

User-writable data lives under ComfyUI's user directory
(``folder_paths.get_user_directory() / style_grid``). Bundled ``samples/``
stay inside the extension folder. Legacy ``<ext>/data/`` is never deleted;
on first startup it is copied into the new root when the new root is empty.
"""

from __future__ import annotations

import logging
import os
import shutil
from typing import Iterable

logger = logging.getLogger("StyleGrid")

# stylegrid/ package dir -> repo root
PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
EXT_DIR = os.path.dirname(PACKAGE_DIR)

# Bundled read-only samples remain in the extension.
SAMPLES_DIR = os.path.join(EXT_DIR, "samples")

# Pre-user-dir location (never auto-deleted).
LEGACY_DATA_DIR = os.path.join(EXT_DIR, "data")

USER_DATA_DIRNAME = "style_grid"
MIGRATION_MARKER_NAME = ".migrated_from_extension_data"

_USER_JSON_NAMES = frozenset(
    {"presets.json", "category_order.json"}
)
_USER_SUBDIR_NAMES = frozenset({"imports", "thumbnails", "backups"})


def _get_comfy_user_directory() -> str | None:
    """Return ComfyUI user directory, or None when folder_paths is unavailable."""
    try:
        import folder_paths
    except ImportError:
        return None
    return folder_paths.get_user_directory()


def resolve_user_data_dir(user_directory: str | None = None) -> str:
    """Abs path of the Style Grid user data root.

    Production: ``<Comfy user dir>/style_grid``.
    Offline / pytest (no ``folder_paths``): fall back to legacy ``<ext>/data``.
    """
    if user_directory is None:
        user_directory = _get_comfy_user_directory()
    if user_directory is None:
        return LEGACY_DATA_DIR
    return os.path.join(user_directory, USER_DATA_DIRNAME)


def _is_user_content_name(name: str) -> bool:
    if name.startswith("."):
        return False
    lower = name.lower()
    if lower.endswith(".csv"):
        return True
    if name in _USER_JSON_NAMES:
        return True
    if name in _USER_SUBDIR_NAMES:
        return True
    return False


def _subdir_has_files(dirpath: str) -> bool:
    for _root, _dirs, files in os.walk(dirpath):
        if files:
            return True
    return False


def has_user_data(root: str) -> bool:
    """True when ``root`` contains migratable / meaningful user files."""
    if not os.path.isdir(root):
        return False
    try:
        names = os.listdir(root)
    except OSError:
        return False
    for name in names:
        if not _is_user_content_name(name):
            continue
        path = os.path.join(root, name)
        if name in _USER_SUBDIR_NAMES:
            if os.path.isdir(path) and _subdir_has_files(path):
                return True
            continue
        if os.path.isfile(path):
            return True
    return False


def _iter_legacy_entries(legacy_dir: str) -> Iterable[tuple[str, str]]:
    """Yield (abs_src, relpath) for every file under legacy_dir (files only)."""
    for root, _dirs, files in os.walk(legacy_dir):
        for fname in files:
            src = os.path.join(root, fname)
            rel = os.path.relpath(src, legacy_dir)
            yield src, rel


def migrate_legacy_user_data(
    data_dir: str,
    legacy_dir: str,
    *,
    marker_name: str = MIGRATION_MARKER_NAME,
) -> bool:
    """Copy legacy extension ``data/`` into ``data_dir`` when safe.

    Rules:
    - Never move or delete legacy files.
    - Skip when ``data_dir`` and ``legacy_dir`` are the same path.
    - Skip when the destination already has user data (no overwrite).
    - Skip when legacy has no user data.
    - On success: recursive copy, write marker, log, return True.
    """
    data_abs = os.path.normpath(os.path.abspath(data_dir))
    legacy_abs = os.path.normpath(os.path.abspath(legacy_dir))
    if data_abs == legacy_abs:
        return False

    marker_path = os.path.join(data_abs, marker_name)
    if os.path.isfile(marker_path):
        return False

    if has_user_data(data_abs):
        return False

    if not has_user_data(legacy_abs):
        return False

    os.makedirs(data_abs, exist_ok=True)
    copied = 0
    for src, rel in _iter_legacy_entries(legacy_abs):
        dest = os.path.join(data_abs, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest):
            continue
        try:
            shutil.copy2(src, dest)
            copied += 1
        except OSError as exc:
            logger.warning(
                "[Style Grid] migration copy failed %s -> %s: %s",
                src,
                dest,
                exc,
            )

    try:
        with open(marker_path, "w", encoding="utf-8") as fh:
            fh.write(f"copied_from={legacy_abs}\n")
            fh.write(f"files_copied={copied}\n")
    except OSError as exc:
        logger.warning("[Style Grid] could not write migration marker: %s", exc)

    logger.info(
        "[Style Grid] Migrated user data from %s to %s (%s files copied; "
        "legacy folder left in place)",
        legacy_abs,
        data_abs,
        copied,
    )
    return True


def _ensure_data_dirs(data_dir: str) -> None:
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(os.path.join(data_dir, "backups"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "thumbnails"), exist_ok=True)
    os.makedirs(os.path.join(data_dir, "imports"), exist_ok=True)


# Resolved once at import (ComfyUI startup / pytest import).
DATA_DIR = resolve_user_data_dir()
migrate_legacy_user_data(DATA_DIR, LEGACY_DATA_DIR)
_ensure_data_dirs(DATA_DIR)

IMPORTS_DIR = os.path.join(DATA_DIR, "imports")
PRESETS_FILE = os.path.join(DATA_DIR, "presets.json")
CATEGORY_ORDER_FILE = os.path.join(DATA_DIR, "category_order.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
THUMBNAILS_DIR = os.path.join(DATA_DIR, "thumbnails")


def _csvs_in(dirpath):
    if not os.path.isdir(dirpath):
        return []
    return [
        os.path.join(dirpath, fname)
        for fname in sorted(os.listdir(dirpath))
        if fname.lower().endswith(".csv")
    ]


def get_all_styles_file_paths():
    """Abs paths of every .csv in data/ then imports/ then samples/, sorted within each dir."""
    return _csvs_in(DATA_DIR) + _csvs_in(IMPORTS_DIR) + _csvs_in(SAMPLES_DIR)


def get_styles_dirs():
    """Directories searched for style CSVs, used to compute thumbnail-hash relpaths."""
    return [DATA_DIR, IMPORTS_DIR, SAMPLES_DIR]
