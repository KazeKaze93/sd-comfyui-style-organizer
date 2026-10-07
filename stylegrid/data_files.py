"""Presets, usage stats, CSV backups (JSON / filesystem under data/)."""

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
)
from .csv_io import load_all_styles
from .safe_persistence import (
    CorruptDataError,
    cleanup_stale_tmp,
    load_json_object,
    locked_path,
    write_json_atomic,
)


def _coerce_weight(raw):
    if isinstance(raw, bool) or raw is None:
        return 1.0
    if isinstance(raw, (int, float)):
        return float(raw)
    if isinstance(raw, str):
        try:
            return float(raw.strip())
        except ValueError:
            return 1.0
    return 1.0


def normalize_wildcard_entry(entry):
    """Return {category, spec} or None."""
    if not isinstance(entry, dict):
        return None
    raw_cat = entry.get("category", "")
    if not isinstance(raw_cat, str):
        return None
    category = raw_cat.strip()
    if not category:
        return None
    raw_spec = entry.get("spec", "")
    spec = raw_spec if isinstance(raw_spec, str) else ""
    return {"category": category, "spec": spec}


def normalize_preset_entry(entry, styles_by_name_first):
    """Return {name, source_file, weight} or None.

    Accepts bare name str or dict. Unresolvable names are kept (empty source_file)
    so the UI can show missing members.
    """
    weight = 1.0
    if isinstance(entry, str):
        name = entry.strip()
        if not name:
            return None
        match = styles_by_name_first.get(name)
        source_file = (match.get("source_file") or "") if match else ""
        if match:
            name = match["name"]
        return {"name": name, "source_file": source_file, "weight": weight}

    if isinstance(entry, dict):
        raw_name = entry.get("name", "")
        if not isinstance(raw_name, str):
            return None
        name = raw_name.strip()
        if not name:
            return None
        weight = _coerce_weight(entry.get("weight", 1.0))
        raw_source = entry.get("source_file", "")
        source_file = raw_source.strip() if isinstance(raw_source, str) else ""
        if source_file:
            return {"name": name, "source_file": source_file, "weight": weight}
        match = styles_by_name_first.get(name)
        if match:
            return {
                "name": match["name"],
                "source_file": match.get("source_file") or "",
                "weight": weight,
            }
        return {"name": name, "source_file": "", "weight": weight}

    return None


def normalize_presets(presets):
    """Upgrade presets in memory: styles -> {name, source_file, weight}; wildcards/note defaults.

    Does not write to disk. Callers that persist must use ``save_presets``.
    """
    if not isinstance(presets, dict):
        return {}
    styles_by_name_first = {}
    for s in load_all_styles():
        styles_by_name_first.setdefault(s["name"], s)
    out = {}
    for preset_name, preset in presets.items():
        if not isinstance(preset_name, str) or not preset_name.strip():
            continue
        if not isinstance(preset, dict):
            continue
        styles_raw = preset.get("styles", [])
        if not isinstance(styles_raw, list):
            styles_raw = []
        normalized_styles = []
        for entry in styles_raw:
            normalized = normalize_preset_entry(entry, styles_by_name_first)
            if normalized is not None:
                normalized_styles.append(normalized)

        wildcards_raw = preset.get("wildcards", [])
        if not isinstance(wildcards_raw, list):
            wildcards_raw = []
        wildcards = []
        for entry in wildcards_raw:
            wc = normalize_wildcard_entry(entry)
            if wc is not None:
                wildcards.append(wc)

        note = preset.get("note", "")
        if not isinstance(note, str):
            note = ""

        created = preset.get("created")
        if not isinstance(created, str) or not created:
            created = time.strftime("%Y-%m-%dT%H:%M:%S")

        new_preset = {
            "styles": normalized_styles,
            "wildcards": wildcards,
            "note": note,
            "created": created,
        }
        last_used = preset.get("last_used")
        if isinstance(last_used, str) and last_used:
            new_preset["last_used"] = last_used
        out[preset_name.strip()] = new_preset
    return out


def preset_styles_payload_ok(styles):
    """True if styles is a list of bare names and/or {name, ...} objects."""
    if not isinstance(styles, list):
        return False
    for entry in styles:
        if isinstance(entry, str):
            if not entry.strip():
                return False
            continue
        if isinstance(entry, dict):
            raw_name = entry.get("name", "")
            if not isinstance(raw_name, str) or not raw_name.strip():
                return False
            continue
        return False
    return True


def _write_presets_file(normalized):
    write_json_atomic(PRESETS_FILE, normalized, require_object_values=True)


def load_presets():
    """Load presets.json. Missing → {}; corrupt/wrong-shape/IO → CorruptDataError.

    Never writes to disk (legacy shapes are normalized only in memory).
    """
    with locked_path(PRESETS_FILE):
        cleanup_stale_tmp(PRESETS_FILE)
        raw = load_json_object(PRESETS_FILE, require_object_values=True)
        return normalize_presets(raw)


def save_presets(presets):
    """Normalize and atomically write presets. Refuses if existing file is corrupt."""
    with locked_path(PRESETS_FILE):
        normalized = normalize_presets(presets)
        _write_presets_file(normalized)
        return normalized


def load_usage():
    """Load usage.json. Missing → {}; corrupt/wrong-shape/IO → CorruptDataError."""
    with locked_path(USAGE_FILE):
        return load_json_object(USAGE_FILE, require_object_values=True)


def save_usage(usage):
    """Atomically write usage. Refuses if existing file is corrupt."""
    if not isinstance(usage, dict):
        raise TypeError("usage must be a dict")
    with locked_path(USAGE_FILE):
        write_json_atomic(USAGE_FILE, usage, require_object_values=True)


def increment_usage(style_names):
    with locked_path(USAGE_FILE):
        usage = load_usage()
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
