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
from .config import DATA_DIR, THUMBNAILS_DIR
from .csv_io import (
    categorize_styles,
    delete_style_from_csv,
    load_all_styles,
    save_style_to_csv,
)
from .data_files import (
    backup_csv_files,
    increment_usage,
    load_presets,
    load_usage,
    save_presets,
)
from .thumbnails import _thumbnail_hash_input, get_thumbnail_path, list_thumbnails


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
        etag = hashlib.md5(json.dumps(styles_cache_hashes(), sort_keys=True).encode()).hexdigest()
        if_none_match = request.headers.get("If-None-Match", "").strip().strip('"')
        if if_none_match and if_none_match == etag:
            return web.Response(status=304)
        response = web.json_response({"categories": categories, "usage": load_usage(), "presets": load_presets()})
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
        return web.json_response({
            "styles": load_all_styles(),
            "presets": load_presets(),
            "usage": load_usage(),
            "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        })

    @routes.post("/style_grid/import")
    async def api_import(request):
        raw = await request.read()
        if not raw:
            return web.json_response({"ok": True})
        if len(raw) >= 2 and raw[:2] == b"PK":
            try:
                with zipfile.ZipFile(BytesIO(raw)) as zf:
                    if "presets.json" in zf.namelist():
                        data = json.loads(zf.read("presets.json").decode("utf-8"))
                        if isinstance(data, dict):
                            save_presets(data)
            except (zipfile.BadZipFile, json.JSONDecodeError, KeyError) as e:
                return web.json_response({"error": f"Invalid ZIP archive: {e}"}, status=422)
            return web.json_response({"ok": True})
        try:
            data = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return web.json_response({"error": "Invalid JSON"}, status=422)
        if not isinstance(data, dict):
            return web.json_response({"ok": True})
        if "presets" in data:
            p = load_presets()
            p.update(data["presets"])
            save_presets(p)
        if "styles" in data and data["styles"]:
            os.makedirs(DATA_DIR, exist_ok=True)
            target = os.path.join(DATA_DIR, f"imported_{time.strftime('%Y%m%d_%H%M%S')}.csv")
            with open(target, "w", encoding="utf-8", newline="") as f:
                w = csv.writer(f)
                w.writerow(["name", "prompt", "negative_prompt", "description", "category"])
                for s in data["styles"]:
                    w.writerow([
                        s.get("name", ""),
                        s.get("prompt", ""),
                        s.get("negative_prompt", ""),
                        s.get("description", ""),
                        s.get("category", "") or s.get("category_explicit", ""),
                    ])
            invalidate_styles_cache()
        return web.json_response({"ok": True})

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
    @routes.get("/style_grid/presets")
    async def get_presets(request):
        return web.json_response(load_presets())

    @routes.post("/style_grid/presets/save")
    async def api_save_preset(request):
        data = await _read_json(request)
        presets = load_presets()
        name = data.get("name", "").strip()
        styles = data.get("styles", [])
        if not name:
            return web.json_response({"error": "Name required"})
        presets[name] = {"styles": styles, "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
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
        increment_usage(data.get("styles", []))
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
        path = get_thumbnail_path(name)
        if os.path.isfile(path):
            return web.FileResponse(
                path,
                headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
            )

        all_styles = get_cached_styles()
        matches = [s for s in all_styles if s.get("name") == name]
        seen = set()
        for style in reversed(matches):
            sf = style.get("source_file") or ""
            candidate = get_thumbnail_path(name, sf)
            if candidate not in seen:
                seen.add(candidate)
                if os.path.isfile(candidate):
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
            raw = base64.b64decode(image_data)
            if len(raw) > 2 * 1024 * 1024:
                return web.json_response({"error": "Image too large (max 2MB)"})
            allowed_magic = [
                b"\xff\xd8\xff",
                b"\x89PNG\r\n\x1a\n",
                b"RIFF",
                b"GIF87a",
                b"GIF89a",
            ]
            is_valid_image = any(raw.startswith(m) for m in allowed_magic)
            if raw.startswith(b"RIFF") and raw[8:12] != b"WEBP":
                is_valid_image = False
            if not is_valid_image:
                return web.json_response({"error": "Invalid image format. Allowed: JPEG, PNG, WEBP, GIF"})
            path = get_thumbnail_path(style_name)
            with open(path, "wb") as f:
                f.write(raw)
            return web.json_response({"ok": True})
        except (ValueError, OSError) as e:
            return web.json_response({"error": str(e)})

    @routes.delete("/style_grid/thumbnail")
    async def api_delete_thumbnail(request):
        name = request.rel_url.query.get("name", "")
        path = get_thumbnail_path(name)
        if os.path.isfile(path):
            os.remove(path)
        return web.json_response({"ok": True})

    @routes.post("/style_grid/thumbnails/cleanup")
    async def api_cleanup_thumbnails(request):
        """Remove thumbnails for styles that no longer exist in any CSV."""
        if not os.path.isdir(THUMBNAILS_DIR):
            return web.json_response({"removed": 0})
        valid_hashes = set()
        for s in get_cached_styles():
            h = hashlib.md5(
                _thumbnail_hash_input(s["name"], s.get("source_file") or "").encode("utf-8")
            ).hexdigest()
            valid_hashes.add(h)
        removed = 0
        for fname in os.listdir(THUMBNAILS_DIR):
            if not fname.endswith(".webp"):
                continue
            h = os.path.splitext(fname)[0]
            if h not in valid_hashes:
                try:
                    os.remove(os.path.join(THUMBNAILS_DIR, fname))
                    removed += 1
                except OSError:
                    pass
        return web.json_response({"removed": removed})


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
