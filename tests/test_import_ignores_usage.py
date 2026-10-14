"""Legacy usage.json / \"usage\" export keys must be ignored on import."""

from __future__ import annotations

import asyncio
import io
import json
import sys
import types
import zipfile
from pathlib import Path


def _install_aiohttp_stub() -> types.ModuleType:
    """Minimal aiohttp.web stub so stylegrid.routes can import without ComfyUI."""
    if "aiohttp" in sys.modules and hasattr(sys.modules["aiohttp"], "web"):
        return sys.modules["aiohttp"].web

    aiohttp = types.ModuleType("aiohttp")
    web = types.ModuleType("aiohttp.web")

    class Response:
        def __init__(self, *, status: int = 200, body: bytes | None = None, **_kwargs):
            self.status = status
            self.body = body or b""
            self.headers: dict[str, str] = {}

    class FileResponse(Response):
        pass

    class JsonResponse(Response):
        def __init__(self, data, *, status: int = 200):
            super().__init__(status=status)
            self.data = data
            self.body = json.dumps(data).encode("utf-8")

    def json_response(data=None, *, status: int = 200):
        return JsonResponse(data if data is not None else {}, status=status)

    web.Response = Response
    web.FileResponse = FileResponse
    web.json_response = json_response
    aiohttp.web = web
    sys.modules["aiohttp"] = aiohttp
    sys.modules["aiohttp.web"] = web
    return web


class _FakeRoutes:
    def __init__(self) -> None:
        self.handlers: dict[tuple[str, str], object] = {}

    def _add(self, method: str, path: str):
        def deco(fn):
            self.handlers[(method, path)] = fn
            return fn

        return deco

    def get(self, path: str):
        return self._add("GET", path)

    def post(self, path: str):
        return self._add("POST", path)

    def delete(self, path: str):
        return self._add("DELETE", path)


class _FakeRequest:
    def __init__(self, body: bytes):
        self._body = body

    async def read(self) -> bytes:
        return self._body


def _import_handler(monkeypatch, tmp_path: Path):
    _install_aiohttp_stub()
    # Fresh import after stub so routes binds to JsonResponse.
    sys.modules.pop("stylegrid.routes", None)
    from stylegrid import config as sg_config
    from stylegrid import data_files as sg_data
    from stylegrid import routes as sg_routes

    data_dir = tmp_path / "style_grid"
    imports = data_dir / "imports"
    imports.mkdir(parents=True)
    presets = data_dir / "presets.json"
    presets.write_text("{}", encoding="utf-8")

    monkeypatch.setattr(sg_config, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(sg_config, "PRESETS_FILE", str(presets))
    monkeypatch.setattr(sg_routes, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(sg_routes, "PRESETS_FILE", str(presets))
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets))
    monkeypatch.setattr(sg_data, "load_all_styles", lambda: [])

    fake = _FakeRoutes()
    sg_routes.register_api(fake)
    handler = fake.handlers[("POST", "/style_grid/import")]
    usage_path = data_dir / "usage.json"
    return handler, data_dir, imports, usage_path


def test_json_import_ignores_usage_key(tmp_path, monkeypatch):
    handler, data_dir, imports, usage_path = _import_handler(monkeypatch, tmp_path)
    payload = {
        "styles": [
            {
                "name": "IgnoreUsageStyle",
                "prompt": "a",
                "negative_prompt": "",
                "description": "",
                "category": "BASE",
            }
        ],
        "usage": {
            "IgnoreUsageStyle": {
                "count": 99,
                "last_used": "2099-01-01T00:00:00",
                "first_used": "2099-01-01T00:00:00",
            }
        },
    }
    resp = asyncio.run(handler(_FakeRequest(json.dumps(payload).encode("utf-8"))))
    assert resp.status == 200
    assert resp.data.get("ok") is True
    assert resp.data.get("imported") == 1
    assert "usage_imported" not in resp.data
    assert not usage_path.exists()
    assert list(imports.glob("*.csv")), "styles should still be imported"


def test_json_import_usage_only_is_not_importable(tmp_path, monkeypatch):
    handler, _data_dir, imports, usage_path = _import_handler(monkeypatch, tmp_path)
    payload = {
        "usage": {"Solo": {"count": 1, "last_used": None, "first_used": "2020-01-01T00:00:00"}},
    }
    resp = asyncio.run(handler(_FakeRequest(json.dumps(payload).encode("utf-8"))))
    assert resp.status == 200
    assert resp.data.get("error") == "No importable data found in file"
    assert not usage_path.exists()
    assert not list(imports.glob("*.csv"))


def test_json_import_ignores_malformed_usage_key(tmp_path, monkeypatch):
    """Old clients sending a non-object usage value must not fail the import."""
    handler, _data_dir, imports, usage_path = _import_handler(monkeypatch, tmp_path)
    payload = {
        "styles": [
            {
                "name": "BadUsageStillOk",
                "prompt": "b",
                "negative_prompt": "",
                "description": "",
                "category": "BASE",
            }
        ],
        "usage": "not-an-object",
    }
    resp = asyncio.run(handler(_FakeRequest(json.dumps(payload).encode("utf-8"))))
    assert resp.status == 200
    assert resp.data.get("ok") is True
    assert resp.data.get("imported") == 1
    assert not usage_path.exists()
    assert list(imports.glob("*.csv"))


def test_zip_import_ignores_usage_json_member(tmp_path, monkeypatch):
    handler, _data_dir, imports, usage_path = _import_handler(monkeypatch, tmp_path)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "data/pack.csv",
            "name,prompt,negative_prompt,description,category\n"
            "ZipUsageStyle,p,,,BASE\n",
        )
        zf.writestr(
            "usage.json",
            json.dumps(
                {
                    "ZipUsageStyle": {
                        "count": 7,
                        "last_used": "2099-01-01T00:00:00",
                        "first_used": "2099-01-01T00:00:00",
                    }
                }
            ),
        )
    resp = asyncio.run(handler(_FakeRequest(buf.getvalue())))
    assert resp.status == 200
    assert resp.data.get("ok") is True
    assert resp.data.get("imported") == 1
    assert "usage_imported" not in resp.data
    assert not usage_path.exists()
    assert list(imports.glob("*.csv"))
