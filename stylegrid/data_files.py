"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

import json
import os
import time
import zipfile

from .config import (
    BACKUP_DIR,
    DATA_DIR,
    IMPORTS_DIR,
    PRESETS_FILE,
    USAGE_FILE,
    _csvs_in,
    logger,
)


def _read_presets():
    """Load presets.json. Returns (data, corrupt) — corrupt when the file exists but is unusable."""
    if not os.path.isfile(PRESETS_FILE):
        return {}, False
    try:
        with open(PRESETS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("[Style Grid] presets.json is not a JSON object; treating as empty")
            return {}, True
        return data, False
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("[Style Grid] presets.json unreadable (%s); treating as empty", e)
        return {}, True


def load_presets():
    presets, _ = _read_presets()
    return presets


def save_presets(presets):
    directory = os.path.dirname(PRESETS_FILE)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = PRESETS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(presets, f, indent=2, ensure_ascii=False)
    os.replace(tmp, PRESETS_FILE)


def _read_usage():
    """Load usage.json. Returns (data, corrupt) — corrupt when the file exists but is unusable."""
    if not os.path.isfile(USAGE_FILE):
        return {}, False
    try:
        with open(USAGE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            logger.warning("[Style Grid] usage.json is not a JSON object; treating as empty")
            return {}, True
        return data, False
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("[Style Grid] usage.json unreadable (%s); treating as empty", e)
        return {}, True


def load_usage():
    usage, _ = _read_usage()
    return usage


def save_usage(usage):
    directory = os.path.dirname(USAGE_FILE)
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = USAGE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(usage, f, indent=2, ensure_ascii=False)
    os.replace(tmp, USAGE_FILE)


def increment_usage(style_names):
    usage, corrupt = _read_usage()
    if corrupt:
        # Counts are non-critical UX polish — reset loudly rather than block the click
        # or silently clobber history forever without a log line.
        logger.warning(
            "[Style Grid] usage.json corrupt — resetting usage history and writing a fresh file"
        )
    ts = time.strftime("%Y-%m-%dT%H:%M:%S")
    for name in style_names:
        if name not in usage:
            usage[name] = {"count": 0, "last_used": None, "first_used": ts}
        usage[name]["count"] = usage[name].get("count", 0) + 1
        usage[name]["last_used"] = ts
    save_usage(usage)


def _backup_zip_entries():
    """(abs_path, arcname) for user CSVs + presets. samples/ excluded; one collect.
    Scope is packs+presets only — not usage.json, category_order.json, or thumbnails/.
    """
    entries = []
    for fp in _csvs_in(DATA_DIR):
        if os.path.isfile(fp):
            entries.append((fp, "data/" + os.path.basename(fp)))
    for fp in _csvs_in(IMPORTS_DIR):
        if os.path.isfile(fp):
            entries.append((fp, "imports/" + os.path.basename(fp)))
    if os.path.isfile(PRESETS_FILE):
        entries.append((PRESETS_FILE, "presets.json"))
    return entries


def _unique_backup_zip_path():
    ts = time.strftime("%Y%m%d_%H%M%S")
    candidate = os.path.join(BACKUP_DIR, ts + ".zip")
    if not os.path.exists(candidate):
        return candidate
    n = 1
    while True:
        candidate = os.path.join(BACKUP_DIR, f"{ts}_{n}.zip")
        if not os.path.exists(candidate):
            return candidate
        n += 1


def backup_csv_files():
    entries = _backup_zip_entries()
    if not entries:
        return False

    os.makedirs(BACKUP_DIR, exist_ok=True)
    zip_path = _unique_backup_zip_path()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp, arcname in entries:
            zf.write(fp, arcname=arcname)

    zips = sorted(
        name
        for name in os.listdir(BACKUP_DIR)
        if name.endswith(".zip") and os.path.isfile(os.path.join(BACKUP_DIR, name))
    )
    while len(zips) > 20:
        old_name = zips.pop(0)
        try:
            os.remove(os.path.join(BACKUP_DIR, old_name))
        except OSError:
            pass
    return os.path.basename(zip_path)
