"""aiohttp routes for Style Grid, registered on PromptServer.instance.routes."""

import base64
import csv
import hashlib
import json
import os
import time
import zipfile
from io import BytesIO

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
)
from .thumbnails import (
    cleanup_orphan_thumbnails,
    clear_thumbnail_files,
    detect_image_ext,
    find_thumbnail_path,
    get_thumbnail_path,
    list_thumbnails,
)


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
                    if "presets.json" not in zf.namelist():
                        return web.json_response(
                            {"error": "No importable data found in file"}
                        )
                    data = json.loads(zf.read("presets.json").decode("utf-8"))
                    if not isinstance(data, dict) or not data:
                        return web.json_response(
                            {"error": "No importable data found in file"}
                        )
                    p = load_presets()
                    p.update(data)
                    save_presets(p)
                    return web.json_response({
                        "ok": True,
                        "imported": 0,
                        "skipped": 0,
                        "presets_imported": len(data),
                        "presets_skipped": 0,
                    })
            except (zipfile.BadZipFile, json.JSONDecodeError, KeyError) as e:
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
        if duplicate_import and imported == 0 and presets_imported == 0:
            return web.json_response({
                "error": "This looks like a duplicate of an existing import",
            })
        if imported == 0 and presets_imported == 0:
            return web.json_response({"error": "No importable data found in file"})
        resp = {
            "ok": True,
            "imported": imported,
            "skipped": skipped,
            "presets_imported": presets_imported,
            "presets_skipped": presets_skipped,
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
        return web.json_response({"ok": deleted})

    @routes.post("/style_grid/backup")
    async def api_backup(request):
        try:
            return web.json_response({"ok": backup_csv_files()})
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
