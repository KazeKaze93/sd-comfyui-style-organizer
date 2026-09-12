"""aiohttp routes for Style Grid, registered on PromptServer.instance.routes."""

import base64
import csv
import hashlib
import json
import os
import time
import zipfile
from io import BytesIO, StringIO

from aiohttp import web

from .cache import (
    check_files_changed,
    get_cached_styles,
    invalidate_styles_cache,
    styles_cache_hashes,
)
from .config import DATA_DIR, IMPORTS_DIR
from .csv_io import (
    FIELDNAMES,
    categorize_styles,
    delete_style_from_csv,
    load_all_styles,
    parse_styles_csv,
    save_style_to_csv,
)
from .data_files import (
    backup_csv_files,
    increment_usage,
    load_presets,
    load_usage,
    save_presets,
    save_usage,
)
from .thumbnails import (
    cleanup_orphan_thumbnails,
    clear_thumbnail_files,
    detect_image_ext,
    find_thumbnail_path,
    get_thumbnail_path,
    list_thumbnails,
)


def _zip_csv_member_names(namelist):
    """Stored zip names that are exactly data/*.csv or imports/*.csv (no traversal)."""
    members = []
    for name in namelist:
        norm = name.replace("\\", "/")
        if ".." in norm.split("/"):
            continue
        parts = norm.split("/")
        if len(parts) != 2:
            continue
        root, fname = parts
        if root not in ("data", "imports"):
            continue
        if not fname or not fname.lower().endswith(".csv"):
            continue
        members.append(name)
    return members


def _styles_from_csv_text(text):
    """Parse style dicts from CSV text. Returns (styles, skipped)."""
    styles = []
    skipped = 0
    reader = csv.reader(StringIO(text))
    header = None
    for row in reader:
        try:
            if not row or all(c.strip() == "" for c in row):
                continue
            if header is None and row[0].strip().lower() == "name":
                header = row
                continue
            if header is None:
                header = ["name", "prompt", "negative_prompt"]
            name = row[0].strip() if len(row) > 0 else ""
            if not name:
                skipped += 1
                continue
            styles.append({
                "name": name,
                "prompt": row[1].strip() if len(row) > 1 else "",
                "negative_prompt": row[2].strip() if len(row) > 2 else "",
                "description": row[3].strip() if len(row) > 3 else "",
                "category": row[4].strip() if len(row) > 4 else "",
            })
        except (IndexError, AttributeError):
            skipped += 1
            continue
    return styles, skipped


def _write_styles_to_new_import_csv(styles, name_hint):
    """Seed a new IMPORTS_DIR CSV and upsert styles (same path as JSON import)."""
    os.makedirs(IMPORTS_DIR, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    safe = name_hint.replace("\\", "/").replace("/", "_")
    if not safe.lower().endswith(".csv"):
        safe += ".csv"
    target = os.path.join(IMPORTS_DIR, f"imported_{ts}_{safe}")
    n = 1
    while os.path.isfile(target):
        target = os.path.join(IMPORTS_DIR, f"imported_{ts}_{n}_{safe}")
        n += 1
    with open(target, "w", encoding="utf-8-sig", newline="") as f:
        csv.writer(f).writerow(FIELDNAMES)
    for s in styles:
        cat = s.get("category", "") or s.get("category_explicit", "")
        save_style_to_csv(
            s.get("name", ""),
            s.get("prompt", ""),
            s.get("negative_prompt", ""),
            s.get("description", ""),
            source_file=target,
            category=cat if cat else None,
        )
    return len(styles)


def detect_conflicts(style_names):
    styles_map = {s["name"]: s for s in get_cached_styles()}
    conflicts = []
    style_tokens = {}
    for name in style_names:
        s = styles_map.get(name)
        if not s:
            continue
        style_tokens[name] = {"positive": set(), "negative": set()}
        for token in (s.get("prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[name]["positive"].add(t)
        for token in (s.get("negative_prompt") or "").split(","):
            t = token.strip().lower()
            if t and t != "{prompt}":
                style_tokens[name]["negative"].add(t)
    names = list(style_tokens.keys())
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = names[i], names[j]
            overlap1 = style_tokens[a]["positive"] & style_tokens[b]["negative"]
            if overlap1:
                conflicts.append({
                    "styles": [a, b],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap1)[:5],
                    "message": f"'{a}' adds tokens that '{b}' negates: {', '.join(list(overlap1)[:3])}"
                })
            overlap2 = style_tokens[b]["positive"] & style_tokens[a]["negative"]
            if overlap2:
                conflicts.append({
                    "styles": [b, a],
                    "type": "positive_vs_negative",
                    "tokens": list(overlap2)[:5],
                    "message": f"'{b}' adds tokens that '{a}' negates: {', '.join(list(overlap2)[:3])}"
                })
    return conflicts


async def _read_json(request):
    """Parse request body as JSON, returning {} on empty/invalid body."""
    try:
        raw = await request.read()
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def _register_style_routes(routes):
    @routes.get("/style_grid/styles")
    async def get_styles(request):
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        presets = load_presets()
        # Presets are embedded in the body; include them so save/delete busts ETag.
        etag = hashlib.md5(
            (
                json.dumps(styles_cache_hashes(), sort_keys=True)
                + "\0"
                + json.dumps(presets, sort_keys=True)
            ).encode()
        ).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip().strip('"')
        if if_none_match and if_none_match == etag:
            return web.Response(status=304)
        response = web.json_response({"categories": categories, "usage": load_usage(), "presets": presets})
        response.headers["ETag"] = etag
        return response

    @routes.post("/style_grid/reload")
    async def reload_styles(request):
        check_files_changed()
        invalidate_styles_cache()
        styles = get_cached_styles()
        categories = categorize_styles(styles)
        return web.json_response({"categories": categories, "usage": load_usage()})

    @routes.get("/style_grid/check_update")
    async def api_check_update(request):
        return web.json_response({"changed": check_files_changed()})

    @routes.post("/style_grid/conflicts")
    async def api_conflicts(request):
        data = await _read_json(request)
        return web.json_response({"conflicts": detect_conflicts(data.get("styles", []))})

    @routes.get("/style_grid/export")
    async def api_export(request):
        styles = [
            {k: v for k, v in s.items() if k != "source_file"}
            for s in load_all_styles()
            if not s.get("read_only")
        ]
        return web.json_response({
            "styles": styles,
            "presets": load_presets(),
            "usage": load_usage(),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })

    @routes.post("/style_grid/import")
    async def api_import(request):
        raw = await request.read()
        if not raw:
            return web.json_response({"error": "No importable data found in file"})
        max_import = 50 * 1024 * 1024
        if len(raw) > max_import:
            return web.json_response({"error": "Import too large (max 50MB)"})
        if len(raw) >= 2 and raw[:2] == b"PK":
            try:
                with zipfile.ZipFile(BytesIO(raw)) as zf:
                    names = zf.namelist()
                    csv_members = _zip_csv_member_names(names)
                    has_presets = "presets.json" in names
                    if not csv_members and not has_presets:
                        return web.json_response(
                            {"error": "No importable data found in file"}
                        )

                    presets_imported = 0
                    presets_skipped = 0
                    if has_presets:
                        incoming = json.loads(zf.read("presets.json").decode("utf-8"))
                        if not isinstance(incoming, dict):
                            return web.json_response({"error": "presets must be an object"})
                        p = load_presets()
                        for name, entry in incoming.items():
                            if not isinstance(name, str) or not name.strip():
                                presets_skipped += 1
                                continue
                            if not isinstance(entry, dict):
                                presets_skipped += 1
                                continue
                            styles = entry.get("styles")
                            if not isinstance(styles, list) or not all(
                                isinstance(n, str) for n in styles
                            ):
                                presets_skipped += 1
                                continue
                            created = entry.get("created")
                            if not isinstance(created, str) or not created:
                                created = time.strftime("%Y-%m-%dT%H:%M:%S")
                            p[name.strip()] = {"styles": styles, "created": created}
                            presets_imported += 1
                        if presets_imported:
                            save_presets(p)

                    imported = 0
                    skipped = 0
                    for member in csv_members:
                        try:
                            text = zf.read(member).decode("utf-8-sig")
                        except UnicodeDecodeError:
                            skipped += 1
                            continue
                        rows, row_skipped = _styles_from_csv_text(text)
                        skipped += row_skipped
                        if rows:
                            imported += _write_styles_to_new_import_csv(rows, member)

                    if imported == 0 and presets_imported == 0:
                        return web.json_response(
                            {"error": "No importable data found in file"}
                        )
                    return web.json_response({
                        "ok": True,
                        "imported": imported,
                        "skipped": skipped,
                        "presets_imported": presets_imported,
                        "presets_skipped": presets_skipped,
                        "usage_imported": 0,
                        "usage_skipped": 0,
                    })
            except (zipfile.BadZipFile, json.JSONDecodeError, KeyError, UnicodeDecodeError) as e:
                return web.json_response({"error": f"Invalid ZIP archive: {e}"}, status=422)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "Invalid JSON"}, status=422)
        if not isinstance(data, dict):
            return web.json_response({"error": "No importable data found in file"})
        presets_imported = 0
        presets_skipped = 0
        if "presets" in data:
            incoming = data["presets"]
            if not isinstance(incoming, dict):
                return web.json_response({"error": "presets must be an object"})
            p = load_presets()
            for name, entry in incoming.items():
                if not isinstance(name, str) or not name.strip():
                    presets_skipped += 1
                    continue
                if not isinstance(entry, dict):
                    presets_skipped += 1
                    continue
                styles = entry.get("styles")
                if not isinstance(styles, list) or not all(
                    isinstance(n, str) for n in styles
                ):
                    presets_skipped += 1
                    continue
                created = entry.get("created")
                if not isinstance(created, str) or not created:
                    created = time.strftime("%Y-%m-%dT%H:%M:%S")
                p[name.strip()] = {"styles": styles, "created": created}
                presets_imported += 1
            if presets_imported:
                save_presets(p)
        imported = 0
        skipped = 0
        duplicate_import = False
        if "styles" in data:
            styles = data["styles"]
            if not isinstance(styles, list):
                return web.json_response({"error": "styles must be a list"})
            valid = []
            for s in styles:
                if isinstance(s, dict):
                    valid.append(s)
                else:
                    skipped += 1
            if valid:
                incoming_names = frozenset(
                    (s.get("name") or "").strip()
                    for s in valid
                    if (s.get("name") or "").strip()
                )
                if incoming_names and os.path.isdir(IMPORTS_DIR):
                    for fname in sorted(os.listdir(IMPORTS_DIR)):
                        if not fname.lower().endswith(".csv"):
                            continue
                        existing = frozenset(
                            row["name"]
                            for row in parse_styles_csv(os.path.join(IMPORTS_DIR, fname))
                            if row.get("name")
                        )
                        if existing == incoming_names:
                            duplicate_import = True
                            break
                if not duplicate_import:
                    os.makedirs(IMPORTS_DIR, exist_ok=True)
                    target = os.path.join(
                        IMPORTS_DIR, f"imported_{time.strftime('%Y%m%d_%H%M%S')}.csv"
                    )
                    # Seed so _resolve_write_target matches IMPORTS_DIR, not DATA_DIR.
                    with open(target, "w", encoding="utf-8-sig", newline="") as f:
                        csv.writer(f).writerow(FIELDNAMES)
                    for s in valid:
                        cat = s.get("category", "") or s.get("category_explicit", "")
                        save_style_to_csv(
                            s.get("name", ""),
                            s.get("prompt", ""),
                            s.get("negative_prompt", ""),
                            s.get("description", ""),
                            source_file=target,
                            category=cat if cat else None,
                        )
                    imported = len(valid)
        usage_imported = 0
        usage_skipped = 0
        if "usage" in data:
            incoming_usage = data["usage"]
            if not isinstance(incoming_usage, dict):
                return web.json_response({"error": "usage must be an object"})
            known_names = {s["name"] for s in load_all_styles()}
            usage = load_usage()
            changed = False
            for name, entry in incoming_usage.items():
                if not isinstance(name, str) or not name.strip():
                    usage_skipped += 1
                    continue
                name = name.strip()
                if name not in known_names:
                    usage_skipped += 1
                    continue
                if not isinstance(entry, dict):
                    usage_skipped += 1
                    continue
                count = entry.get("count")
                if not isinstance(count, int) or count < 0:
                    usage_skipped += 1
                    continue
                last_used = entry.get("last_used")
                if last_used is not None and not isinstance(last_used, str):
                    usage_skipped += 1
                    continue
                first_used = entry.get("first_used")
                if first_used is not None and not isinstance(first_used, str):
                    usage_skipped += 1
                    continue
                if name not in usage or not isinstance(usage.get(name), dict):
                    usage[name] = {
                        "count": count,
                        "last_used": last_used,
                        "first_used": first_used or time.strftime("%Y-%m-%dT%H:%M:%S"),
                    }
                else:
                    cur = usage[name]
                    cur["count"] = int(cur.get("count", 0) or 0) + count
                    cur_last = cur.get("last_used")
                    if last_used and (
                        not isinstance(cur_last, str) or not cur_last or last_used > cur_last
                    ):
                        cur["last_used"] = last_used
                    cur_first = cur.get("first_used")
                    if first_used and (
                        not isinstance(cur_first, str)
                        or not cur_first
                        or first_used < cur_first
                    ):
                        cur["first_used"] = first_used
                    elif not cur_first:
                        cur["first_used"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                usage_imported += 1
                changed = True
            if changed:
                save_usage(usage)
        if (
            duplicate_import
            and imported == 0
            and presets_imported == 0
            and usage_imported == 0
        ):
            return web.json_response({
                "error": "This looks like a duplicate of an existing import",
            })
        if imported == 0 and presets_imported == 0 and usage_imported == 0:
            return web.json_response({"error": "No importable data found in file"})
        resp = {
            "ok": True,
            "imported": imported,
            "skipped": skipped,
            "presets_imported": presets_imported,
            "presets_skipped": presets_skipped,
            "usage_imported": usage_imported,
            "usage_skipped": usage_skipped,
        }
        if duplicate_import:
            resp["warning"] = "This looks like a duplicate of an existing import"
        return web.json_response(resp)

    @routes.get("/style_grid/category_order")
    async def api_get_category_order(request):
        order_file = os.path.join(DATA_DIR, "category_order.json")
        if not os.path.isfile(order_file):
            return web.json_response([])
        try:
            with open(order_file, "r", encoding="utf-8") as f:
                order = json.load(f)
        except (OSError, json.JSONDecodeError):
            return web.json_response([])
        if not isinstance(order, list):
            return web.json_response([])
        return web.json_response(order)

    @routes.post("/style_grid/category_order")
    @routes.post("/style_grid/category_order/save")
    async def api_save_category_order(request):
        data = await _read_json(request)
        order = data.get("order", [])
        if not isinstance(order, list):
            return web.json_response({"error": "order must be a list"})
        order_file = os.path.join(DATA_DIR, "category_order.json")
        with open(order_file, "w", encoding="utf-8") as f:
            json.dump(order, f, indent=2, ensure_ascii=False)
        return web.json_response({"ok": True})


def _register_preset_routes(routes):
    # Logical failures use HTTP 200 + {error}/{ok} (see register_api); not a presets-only quirk.
    @routes.post("/style_grid/presets/save")
    async def api_save_preset(request):
        data = await _read_json(request)
        presets = load_presets()
        name = data.get("name", "").strip()
        styles = data.get("styles")
        if styles is None:
            styles = []
        if not name:
            return web.json_response({"error": "Name required"})
        if not isinstance(styles, list) or not all(isinstance(n, str) for n in styles):
            return web.json_response({"error": "styles must be a list of strings"})
        prev = presets.get(name)
        created = (
            prev["created"]
            if isinstance(prev, dict) and prev.get("created")
            else time.strftime("%Y-%m-%dT%H:%M:%S")
        )
        presets[name] = {"styles": styles, "created": created}
        save_presets(presets)
        return web.json_response({"ok": True, "presets": presets})

    @routes.post("/style_grid/presets/delete")
    async def api_delete_preset(request):
        data = await _read_json(request)
        presets = load_presets()
        name = data.get("name", "")
        if name in presets:
            del presets[name]
            save_presets(presets)
        return web.json_response({"ok": True, "presets": presets})

    @routes.get("/style_grid/presets/list")
    async def api_list_presets(request):
        return web.json_response(load_presets())


def _register_usage_routes(routes):
    @routes.get("/style_grid/usage")
    async def get_usage_route(request):
        return web.json_response(load_usage())

    @routes.post("/style_grid/usage/increment")
    async def api_increment(request):
        data = await _read_json(request)
        style_names = data.get("styles")
        if style_names is None:
            return web.json_response({"ok": True})
        if not isinstance(style_names, list) or not all(
            isinstance(n, str) for n in style_names
        ):
            return web.json_response({"error": "styles must be a list of strings"})
        style_names = [n for n in style_names if n]
        increment_usage(style_names)
        return web.json_response({"ok": True})


def _register_crud_routes(routes):
    @routes.post("/style_grid/style/save")
    async def api_save_style(request):
        data = await _read_json(request)
        name = data.get("name", "").strip()
        if not name:
            return web.json_response({"error": "Name required"})
        save_style_to_csv(
            name,
            data.get("prompt", ""),
            data.get("negative_prompt", ""),
            data.get("description", ""),
            data.get("source"),
            category=data.get("category"),
        )
        return web.json_response({"ok": True})

    @routes.post("/style_grid/style/delete")
    async def api_del_style(request):
        data = await _read_json(request)
        name = data.get("name", "").strip()
        if not name:
            return web.json_response({"error": "Name required"})
        deleted = delete_style_from_csv(name, data.get("source"))
        if deleted:
            clear_thumbnail_files(name, (data.get("source") or "").strip())
        return web.json_response({"ok": deleted})

    @routes.post("/style_grid/backup")
    async def api_backup(request):
        try:
            created = backup_csv_files()
            if not created:
                return web.json_response({"ok": False, "empty": True})
            return web.json_response({"ok": True, "file": created})
        except OSError as e:
            return web.json_response({"error": str(e)})


def _register_thumbnail_routes(routes):
    @routes.get("/style_grid/thumbnails/list")
    async def api_list_thumbnails(request):
        return web.json_response({"has_thumbnail": list(list_thumbnails())})

    @routes.get("/style_grid/thumbnail")
    async def api_get_thumbnail(request):
        name = request.rel_url.query.get("name", "")
        source = (request.rel_url.query.get("source") or "").strip()
        # Prefer the source-aware path when the client names a pack.
        if source:
            path = find_thumbnail_path(name, source)
            if path:
                return web.FileResponse(
                    path,
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                )
        # Legacy name-only hash (compat net for older uploads).
        path = find_thumbnail_path(name)
        if path:
            return web.FileResponse(
                path,
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        all_styles = get_cached_styles()
        matches = [s for s in all_styles if s.get("name") == name]
        seen = set()
        for style in reversed(matches):
            sf = style.get("source_file") or ""
            candidate = find_thumbnail_path(name, sf)
            if candidate and candidate not in seen:
                seen.add(candidate)
                return web.FileResponse(
                    candidate,
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
                )

        return web.Response(status=404)

    @routes.post("/style_grid/thumbnail/upload")
    async def api_upload_thumbnail(request):
        data = await _read_json(request)
        style_name = data.get("name", "").strip()
        image_data = data.get("image", "")
        if not style_name or not image_data:
            return web.json_response({"error": "name and image required"})
        try:
            if "," in image_data:
                image_data = image_data.split(",", 1)[1]
            # Reject before decode: base64 expands ~4/3, so encoded len > 4/3*10MB
            # would decode past the limit and waste a full raw allocation.
            max_raw = 10 * 1024 * 1024
            max_b64 = (max_raw * 4 + 2) // 3
            if len(image_data) > max_b64:
                return web.json_response({"error": "Image too large (max 10MB)"})
            raw = base64.b64decode(image_data)
            if len(raw) > max_raw:
                return web.json_response({"error": "Image too large (max 10MB)"})
            ext = detect_image_ext(raw)
            if not ext:
                return web.json_response({"error": "Invalid image format. Allowed: JPEG, PNG, WEBP, GIF"})
            # Prefer source-aware hash when client sends source; legacy name-only otherwise.
            csv_path = (data.get("source") or data.get("csv_path") or "").strip()
            clear_thumbnail_files(style_name, csv_path)
            path = get_thumbnail_path(style_name, csv_path, ext=ext)
            with open(path, "wb") as f:
                f.write(raw)
            return web.json_response({"ok": True})
        except (ValueError, OSError) as e:
            return web.json_response({"error": str(e)})

    @routes.delete("/style_grid/thumbnail")
    async def api_delete_thumbnail(request):
        name = request.rel_url.query.get("name", "")
        csv_path = (request.rel_url.query.get("source") or "").strip()
        # source present → source-aware stem; absent → legacy name-only (same as upload).
        clear_thumbnail_files(name, csv_path)
        return web.json_response({"ok": True})

    @routes.post("/style_grid/thumbnails/cleanup")
    async def api_cleanup_thumbnails(request):
        """Remove thumbnails for styles that no longer exist in any CSV."""
        return web.json_response({"removed": cleanup_orphan_thumbnails()})


def register_api(routes):
    """
    Register all Style Grid API groups on the aiohttp RouteTableDef.

    Most handlers return HTTP 200 with `{ "error": ... }` payloads on logical failures;
    notable exceptions are the /styles ETag 304 and /thumbnail 404. Thumbnail generation
    and the UI HTML route are registered separately in later phases.
    """
    _register_style_routes(routes)
    _register_preset_routes(routes)
    _register_usage_routes(routes)
    _register_crud_routes(routes)
    _register_thumbnail_routes(routes)
