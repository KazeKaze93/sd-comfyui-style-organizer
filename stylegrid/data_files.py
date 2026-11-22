"""Presets, favorites and CSV backups (JSON / filesystem under data/)."""

import os
import re
import time
import zipfile

from . import config as _config
from .cache import get_cached_styles
from .config import (
    BACKUP_DIR,
    DATA_DIR,
    IMPORTS_DIR,
    PRESETS_FILE,
    _csvs_in,
    logger,
)
from .safe_persistence import (
    CorruptDataError,
    cleanup_stale_tmp,
    load_json_object,
    locked_path,
    write_atomic,
    write_json_atomic,
)
from .source_ids import is_source_id, to_source_id
from .zip_limits import validate_backup_zip_limits
from .wildcards import TOKEN_SGD


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
    """Return {category, spec}[, kind] or None.

    ``kind`` is present only when the raw entry declares deck mode
    (``TOKEN_SGD``); dice / missing / invalid kinds omit the key.
    """
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
    result = {"category": category, "spec": spec}
    raw_kind = entry.get("kind")
    if isinstance(raw_kind, str) and raw_kind.strip().lower() == TOKEN_SGD:
        result["kind"] = TOKEN_SGD
    return result


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
    for s in get_cached_styles():
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


def migrate_presets_source_ids_once() -> int:
    """Eager rewrite of abs ``source_file`` values in presets.json to public ids.

    Copy-never-delete: only rewrites mappable abs paths; unmappable stay as-is.
    Corrupt or missing file: log and return 0 (never overwrite).
    """
    changed = 0
    with locked_path(PRESETS_FILE):
        cleanup_stale_tmp(PRESETS_FILE)
        try:
            raw = load_json_object(PRESETS_FILE, require_object_values=True)
        except CorruptDataError as exc:
            logger.warning(
                "[Style Grid] presets source-id migration skipped (corrupt): %s",
                exc,
            )
            return 0
        if not isinstance(raw, dict):
            return 0
        for _preset_name, preset in raw.items():
            if not isinstance(preset, dict):
                continue
            styles_raw = preset.get("styles")
            if not isinstance(styles_raw, list):
                continue
            for entry in styles_raw:
                if not isinstance(entry, dict):
                    continue
                raw_source = entry.get("source_file", "")
                if not isinstance(raw_source, str) or not raw_source.strip():
                    continue
                src = raw_source.strip()
                if not os.path.isabs(src):
                    continue
                sid = to_source_id(src)
                if sid is None:
                    continue
                if sid != src:
                    entry["source_file"] = sid
                    changed += 1
        if changed:
            write_json_atomic(PRESETS_FILE, raw, require_object_values=True)
    return changed


def save_presets(presets):
    """Normalize and atomically write presets. Refuses if existing file is corrupt."""
    with locked_path(PRESETS_FILE):
        normalized = normalize_presets(presets)
        _write_presets_file(normalized)
        return normalized


BACKUP_KEEP_SNAPSHOTS = 20
"""Snapshots kept by every backup prune (same number as WebUI)."""


def _backup_zip_entries():
    """(abs_path, arcname) for user CSVs + presets. samples/ excluded; one collect.
    Scope is packs+presets only — not category_order.json or thumbnails/
    (that is POST /backup; snapshots add the rest in _snapshot_members).
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
    while len(zips) > BACKUP_KEEP_SNAPSHOTS:
        old_name = zips.pop(0)
        try:
            os.remove(os.path.join(BACKUP_DIR, old_name))
        except OSError:
            pass
    return os.path.basename(zip_path)


# --- Favorites (server-side; the iframe's styleRowKey strings) -----------------

FAVORITE_KEY_SEP = "\0"
"""Favorites store ``"<source id>\\0<name>"`` (the iframe's styleRowKey)."""


def is_favorite_key(entry):
    """True for ``"<source>\\0<name>"`` with a non-empty source and name."""
    if not isinstance(entry, str):
        return False
    source, sep, name = entry.partition(FAVORITE_KEY_SEP)
    return bool(sep) and bool(source.strip()) and bool(name.strip())


def _unique_keys(items):
    """First-seen order, duplicates dropped (input already validated)."""
    out = []
    seen = set()
    for entry in items:
        if entry in seen:
            continue
        seen.add(entry)
        out.append(entry)
    return out


def _read_favorites_file(path):
    """Return ``(items, persisted)``; caller holds the lock. Corrupt → CorruptDataError."""
    cleanup_stale_tmp(path)
    if not os.path.isfile(path):
        return [], False
    raw = load_json_object(path)
    items = raw.get("items", [])
    if not isinstance(items, list):
        raise CorruptDataError(path, '"items" must be a list')
    return _unique_keys([e for e in items if is_favorite_key(e)]), True


def load_favorites():
    """Load favorites.json. Missing → ``([], False)``; present → ``(items, True)``."""
    path = _config.FAVORITES_FILE
    with locked_path(path):
        return _read_favorites_file(path)


def save_favorites(items):
    """Replace favorites.json. Every entry must be a ``source\\0name`` key.

    Raises ``ValueError`` listing the rejected entries (nothing is written).
    Returns the stored list (duplicates dropped, order kept).
    """
    if not isinstance(items, list):
        raise ValueError("items must be a list")
    invalid = [e for e in items if not is_favorite_key(e)]
    if invalid:
        raise ValueError(
            "every favorite needs a source and a name (source\\0name); invalid: %r"
            % (invalid[:5],)
        )
    normalized = _unique_keys(items)
    path = _config.FAVORITES_FILE
    with locked_path(path):
        write_json_atomic(path, {"items": normalized})
    return normalized


def migrate_favorites(items):
    """Merge the iframe's legacy localStorage favorites into favorites.json.

    Only full ``source\\0name`` keys are taken; bare names (ambiguous or missing
    legacy entries) cannot be attributed to a pack and are returned as
    ``dropped``. Keys already stored are not added again, so a repeat call is a
    no-op. Returns ``{"items", "added", "dropped", "migrated"}``.
    """
    incoming = items if isinstance(items, list) else []
    valid = [e for e in incoming if is_favorite_key(e)]
    dropped = [e for e in incoming if not is_favorite_key(e)]
    path = _config.FAVORITES_FILE
    with locked_path(path):
        current, persisted = _read_favorites_file(path)
        present = set(current)
        added = [e for e in _unique_keys(valid) if e not in present]
        merged = current + added
        if added or not persisted:
            write_json_atomic(path, {"items": merged})
    return {
        "items": merged,
        "added": len(added),
        "dropped": dropped,
        "migrated": bool(added),
    }


def _source_id_for_compare(value):
    """Public source id for a stored source ref, or None (bare basenames are ambiguous)."""
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if is_source_id(raw):
        return raw
    if os.path.isabs(raw):
        return to_source_id(raw)
    return None


def rename_favorite_keys(old_name, new_name, source_id):
    """Rewrite the favorite of ``(source_id, old_name)`` to *new_name*. True when changed.

    A same-named style in another pack is never touched. If the new key was
    already a favorite the two collapse into the earlier position.
    """
    if not old_name or not new_name or old_name == new_name or not source_id:
        return False
    path = _config.FAVORITES_FILE
    with locked_path(path):
        current, persisted = _read_favorites_file(path)
        if not persisted:
            return False
        out = []
        for entry in current:
            source, _sep, name = entry.partition(FAVORITE_KEY_SEP)
            if name == old_name and _source_id_for_compare(source) == source_id:
                entry = source + FAVORITE_KEY_SEP + new_name
            out.append(entry)
        out = _unique_keys(out)
        if out == current:
            return False
        write_json_atomic(path, {"items": out})
        return True


def rename_preset_members(old_name, new_name, source_id):
    """Point preset members of ``(source_id, old_name)`` at *new_name*. True when saved.

    Members are matched by public source id; a member without a source (or with
    a bare basename) is left alone, so a same-named style elsewhere never moves.
    """
    if not old_name or not new_name or old_name == new_name or not source_id:
        return False
    path = PRESETS_FILE
    with locked_path(path):
        presets = load_presets()
        changed = False
        for preset in presets.values():
            styles = preset.get("styles") if isinstance(preset, dict) else None
            if not isinstance(styles, list):
                continue
            for entry in styles:
                if not isinstance(entry, dict) or entry.get("name") != old_name:
                    continue
                if _source_id_for_compare(entry.get("source_file") or "") != source_id:
                    continue
                entry["name"] = new_name
                changed = True
        if changed:
            save_presets(presets)
        return changed


# --- Snapshots: list / create / restore -----------------------------------------

# Timestamp plus optional suffixes (``_1``, ``_safety``, ``_safety_1``); the
# existing ``<ts>.zip`` / ``<ts>_<n>.zip`` files from POST /backup match too.
_SNAPSHOT_NAME_RE = re.compile(r"^\d{8}_\d{6}(_[A-Za-z0-9]+)*$")
_RESTORE_CSV_LEAF_RE = re.compile(r"^[^/\\:\x00]+\.csv$", re.IGNORECASE)
_RESTORE_THUMB_LEAF_RE = re.compile(r"^[0-9a-f]{32}\.(webp|png|jpg|jpeg|gif)$")


def _metadata_snapshot_files():
    """Basename → absolute path of the JSON files every snapshot carries."""
    return (
        ("presets.json", PRESETS_FILE),
        ("favorites.json", _config.FAVORITES_FILE),
        ("category_order.json", _config.CATEGORY_ORDER_FILE),
    )


def _snapshot_zip_paths():
    """Snapshot name → its .zip under BACKUP_DIR (only names matching the pattern)."""
    out = {}
    if not os.path.isdir(BACKUP_DIR):
        return out
    for entry in os.listdir(BACKUP_DIR):
        if not entry.endswith(".zip"):
            continue
        stem = entry[:-4]
        path = os.path.join(BACKUP_DIR, entry)
        if _SNAPSHOT_NAME_RE.match(stem) and os.path.isfile(path):
            out[stem] = path
    return out


def _prune_snapshots(protect=()):
    """Delete the oldest snapshots beyond BACKUP_KEEP_SNAPSHOTS; never one in *protect*."""
    snapshots = _snapshot_zip_paths()
    excess = len(snapshots) - BACKUP_KEEP_SNAPSHOTS
    keep = set(protect)
    for name in sorted(snapshots):
        if excess <= 0:
            break
        if name in keep:
            continue
        try:
            os.remove(snapshots[name])
        except OSError:
            continue
        excess -= 1


def thumbnails_dir_size():
    """Total byte size of files under thumbnails/ (0 if missing)."""
    total = 0
    root_dir = _config.THUMBNAILS_DIR
    if not os.path.isdir(root_dir):
        return 0
    for root, _dirs, files in os.walk(root_dir):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total


def _snapshot_members(include_thumbnails):
    """``(abs_path, arcname)`` for a snapshot. samples/ is bundled content: never included."""
    entries = list(_backup_zip_entries())
    for arcname, path in _metadata_snapshot_files():
        if arcname == "presets.json":
            continue  # already in _backup_zip_entries
        if os.path.isfile(path):
            entries.append((path, arcname))
    if include_thumbnails:
        thumbs = _config.THUMBNAILS_DIR
        if os.path.isdir(thumbs):
            for fname in sorted(os.listdir(thumbs)):
                fp = os.path.join(thumbs, fname)
                if os.path.isfile(fp) and _RESTORE_THUMB_LEAF_RE.match(fname):
                    entries.append((fp, "thumbnails/" + fname))
    return entries


def create_snapshot(include_thumbnails=False, *, snapshot_name=None, protect=()):
    """Write ``backups/<name>.zip`` (packs, presets, favorites, optional thumbnails).

    Returns ``{"ok", "snapshot", "members", "thumbnails_bytes"}`` like WebUI.
    """
    name = snapshot_name or time.strftime("%Y%m%d_%H%M%S")
    if not _SNAPSHOT_NAME_RE.match(name):
        raise ValueError("invalid snapshot name: %r" % (name,))
    entries = _snapshot_members(include_thumbnails)
    if not entries:
        return {"ok": False, "snapshot": None, "members": [], "thumbnails_bytes": 0}
    os.makedirs(BACKUP_DIR, exist_ok=True)
    base = name
    n = 1
    while os.path.exists(os.path.join(BACKUP_DIR, name + ".zip")):
        name = "%s_%d" % (base, n)
        n += 1
    zip_path = os.path.join(BACKUP_DIR, name + ".zip")
    tmp_path = zip_path + ".tmp"
    thumbnails_bytes = 0
    try:
        with zipfile.ZipFile(tmp_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for fp, arcname in entries:
                zf.write(fp, arcname=arcname)
                if arcname.startswith("thumbnails/"):
                    thumbnails_bytes += os.path.getsize(fp)
        os.replace(tmp_path, zip_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    _prune_snapshots(protect=tuple(protect) + (name,))
    return {
        "ok": True,
        "snapshot": name,
        "members": [arc for _fp, arc in entries],
        "thumbnails_bytes": thumbnails_bytes,
    }


def list_snapshots():
    """Newest-first snapshot descriptors (WebUI shape; ComfyUI snapshots are zip-only)."""
    out = []
    for name, zip_path in sorted(_snapshot_zip_paths().items(), reverse=True):
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                members = sorted(i.filename for i in zf.infolist() if not i.is_dir())
        except (OSError, zipfile.BadZipFile):
            members = []
        try:
            size = os.path.getsize(zip_path)
        except OSError:
            size = 0
        out.append(
            {
                "name": name,
                "has_dir": False,
                "has_zip": True,
                "size": size,
                "members": members,
                "has_thumbnails": any(m.startswith("thumbnails/") for m in members),
            }
        )
    return out


def _snapshot_zip_path(snapshot_name):
    if not isinstance(snapshot_name, str) or not _SNAPSHOT_NAME_RE.match(snapshot_name):
        raise ValueError("invalid snapshot name")
    return os.path.join(BACKUP_DIR, snapshot_name + ".zip")


def _is_strictly_inside(root, candidate):
    """True when realpath(candidate) is inside realpath(root) and not equal to it."""
    root_abs = os.path.realpath(root)
    cand_abs = os.path.realpath(candidate)
    try:
        common = os.path.commonpath([root_abs, cand_abs])
    except ValueError:
        return False
    return (
        os.path.normcase(common) == os.path.normcase(root_abs)
        and os.path.normcase(cand_abs) != os.path.normcase(root_abs)
    )


def _member_parts(arcname):
    """Split a zip member into path parts, or None for anything that could leave its root.

    Rejects backslashes, drive colons, NUL, absolute paths and ``.`` / ``..``
    segments before any join (zip-slip).
    """
    if not isinstance(arcname, str) or not arcname:
        return None
    if "\\" in arcname or ":" in arcname or "\x00" in arcname or arcname.startswith("/"):
        return None
    parts = arcname.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return None
    return parts


def _restore_dest(arcname):
    """Absolute destination for a snapshot member, or None to skip it (whitelist only)."""
    parts = _member_parts(arcname)
    if parts is None:
        return None
    if len(parts) == 1:
        return dict(_metadata_snapshot_files()).get(parts[0])
    if len(parts) != 2:
        return None
    top, leaf = parts
    if top == "data" and _RESTORE_CSV_LEAF_RE.match(leaf):
        root = DATA_DIR
    elif top == "imports" and _RESTORE_CSV_LEAF_RE.match(leaf):
        root = IMPORTS_DIR
    elif top == "thumbnails" and _RESTORE_THUMB_LEAF_RE.match(leaf):
        root = _config.THUMBNAILS_DIR
    else:
        return None
    dest = os.path.join(root, leaf)
    if not _is_strictly_inside(root, dest):
        return None
    return dest


def restore_snapshot(snapshot_name, *, create_safety=True):
    """Restore packs, presets, favorites (and thumbnails if present) from a snapshot.

    A safety snapshot of the current state is written first. Each file is
    replaced atomically. Members outside the whitelist are skipped and
    reported. Returns ``{"ok", "snapshot", "safety_snapshot", "restored", "skipped"}``.
    """
    zip_path = _snapshot_zip_path(snapshot_name)
    if not os.path.isfile(zip_path):
        raise FileNotFoundError("snapshot not found: %s" % snapshot_name)
    with zipfile.ZipFile(zip_path, "r") as zf:
        validate_backup_zip_limits(zf)
        members = [(i.filename, zf.read(i.filename)) for i in zf.infolist() if not i.is_dir()]

    safety = None
    if create_safety:
        safety = create_snapshot(
            include_thumbnails=False,
            snapshot_name=time.strftime("%Y%m%d_%H%M%S") + "_safety",
            protect=(snapshot_name,),
        )

    restored = []
    skipped = []
    for arcname, blob in members:
        dest = _restore_dest(arcname)
        if dest is None:
            skipped.append(arcname)
            continue
        write_atomic(dest, blob)
        restored.append(arcname)
    return {
        "ok": True,
        "snapshot": snapshot_name,
        "safety_snapshot": (safety or {}).get("snapshot"),
        "restored": restored,
        "skipped": skipped,
    }
