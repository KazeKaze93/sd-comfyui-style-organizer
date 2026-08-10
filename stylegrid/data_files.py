"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

import json
import os
import shutil
import time
import zipfile

from .config import BACKUP_DIR, PRESETS_FILE, USAGE_FILE, get_all_styles_file_paths, logger


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


def backup_csv_files():
    ts = time.strftime("%Y%m%d_%H%M%S")
    backup_subdir = os.path.join(BACKUP_DIR, ts)
    backed_up = False

    for fp in get_all_styles_file_paths():
        if not os.path.isfile(fp):
            continue
        if not backed_up:
            os.makedirs(backup_subdir, exist_ok=True)
            backed_up = True
        fname = os.path.basename(fp)
        shutil.copy2(fp, os.path.join(backup_subdir, fname))

    if os.path.isfile(PRESETS_FILE):
        if not backed_up:
            os.makedirs(backup_subdir, exist_ok=True)
            backed_up = True
        shutil.copy2(PRESETS_FILE, os.path.join(backup_subdir, "presets.json"))

    if backed_up:
        zip_path = backup_subdir + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp in get_all_styles_file_paths():
                if os.path.isfile(fp):
                    zf.write(fp, arcname=os.path.basename(fp))
            if os.path.isfile(PRESETS_FILE):
                zf.write(PRESETS_FILE, arcname="presets.json")

    if os.path.isdir(BACKUP_DIR):
        backups = sorted(os.listdir(BACKUP_DIR))
        while len(backups) > 20:
            old_name = backups.pop(0)
            old_path = os.path.join(BACKUP_DIR, old_name)
            if os.path.isdir(old_path):
                shutil.rmtree(old_path, ignore_errors=True)
            elif os.path.isfile(old_path) and old_name.endswith(".zip"):
                try:
                    os.remove(old_path)
                except OSError:
                    pass
    return backed_up
