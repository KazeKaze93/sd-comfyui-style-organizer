"""Routes for the iframe port: presets alias, favorites, style rename, backups."""

from __future__ import annotations

import asyncio
import csv
import json
import os
import sys
import zipfile
from pathlib import Path

import pytest

from tests.test_import_ignores_usage import _FakeRoutes, _install_aiohttp_stub

KEY_SEP = "\0"


class _JsonRequest:
    def __init__(self, payload=None, query=None):
        self._body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        self.content_length = len(self._body)

    async def read(self) -> bytes:
        return self._body


def _write_csv(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name", "prompt", "negative_prompt", "description", "category"])
        for r in rows:
            w.writerow(r)


def _read_names(path: Path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [r[0] for r in list(csv.reader(f))[1:] if r]


@pytest.fixture
def env(tmp_path, monkeypatch):
    _install_aiohttp_stub()
    sys.modules.pop("stylegrid.routes", None)
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv
    from stylegrid import data_files as sg_data
    from stylegrid import routes as sg_routes
    from stylegrid import thumbnails as sg_thumbs

    data = tmp_path / "style_grid"
    imports = data / "imports"
    samples = tmp_path / "samples"
    thumbs = data / "thumbnails"
    backups = data / "backups"
    for d in (imports, samples, thumbs):
        d.mkdir(parents=True)
    presets = data / "presets.json"
    favorites = data / "favorites.json"
    category_order = data / "category_order.json"

    for mod, attrs in (
        (sg_config, {"DATA_DIR": data, "IMPORTS_DIR": imports, "SAMPLES_DIR": samples,
                     "PRESETS_FILE": presets, "FAVORITES_FILE": favorites,
                     "CATEGORY_ORDER_FILE": category_order,
                     "BACKUP_DIR": backups, "THUMBNAILS_DIR": thumbs}),
        (sg_data, {"DATA_DIR": data, "IMPORTS_DIR": imports, "PRESETS_FILE": presets,
                   "BACKUP_DIR": backups}),
        (sg_csv, {"DATA_DIR": data, "IMPORTS_DIR": imports, "SAMPLES_DIR": samples}),
        (sg_thumbs, {"DATA_DIR": data, "THUMBNAILS_DIR": thumbs}),
        (sg_routes, {"DATA_DIR": data, "IMPORTS_DIR": imports, "PRESETS_FILE": presets,
                     "CATEGORY_ORDER_FILE": category_order}),
    ):
        for name, value in attrs.items():
            monkeypatch.setattr(mod, name, str(value))
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [str(data), str(imports), str(samples)])
    monkeypatch.setattr(sg_data, "get_cached_styles", lambda: [])

    # The same name in two packs, plus a read-only sample.
    _write_csv(data / "a.csv", [["Foo", "a-foo", "", "", "BODY"], ["Baz", "a-baz", "", "", "BODY"]])
    _write_csv(imports / "b.csv", [["Foo", "b-foo", "", "", "BODY"]])
    _write_csv(samples / "s.csv", [["Foo", "s-foo", "", "", "BODY"]])

    fake = _FakeRoutes()
    sg_routes.register_api(fake)

    def call(method, path, payload=None):
        return asyncio.run(fake.handlers[(method, path)](_JsonRequest(payload)))

    return {
        "call": call, "data": data, "imports": imports, "samples": samples, "thumbs": thumbs,
        "backups": backups, "presets": presets, "favorites": favorites,
        "category_order": category_order, "tmp": tmp_path,
        "sg_data": sg_data, "sg_thumbs": sg_thumbs, "sg_csv": sg_csv, "handlers": fake.handlers,
    }


# --- presets alias -------------------------------------------------------------

def test_presets_alias_returns_the_same_list(env):
    env["presets"].write_text(
        json.dumps({"P": {"styles": [{"name": "Foo", "source_file": "data/a.csv"}]}}), encoding="utf-8"
    )
    alias = env["call"]("GET", "/style_grid/presets")
    legacy = env["call"]("GET", "/style_grid/presets/list")
    assert alias.status == 200
    assert alias.data == legacy.data
    assert list(alias.data) == ["P"]


# --- favorites -----------------------------------------------------------------

def test_favorites_get_save_roundtrip_and_dedupe(env):
    resp = env["call"]("GET", "/style_grid/favorites")
    assert resp.data == {"items": [], "persisted": False, "ambiguous": []}
    a, b = "data/a.csv" + KEY_SEP + "Foo", "imports/b.csv" + KEY_SEP + "Foo"
    resp = env["call"]("POST", "/style_grid/favorites/save", {"items": [a, b, a]})
    assert resp.status == 200
    assert resp.data == {"ok": True, "items": [a, b]}
    resp = env["call"]("GET", "/style_grid/favorites")
    assert resp.data == {"items": [a, b], "persisted": True, "ambiguous": []}
    assert json.loads(env["favorites"].read_text(encoding="utf-8")) == {"items": [a, b]}


@pytest.mark.parametrize(
    "bad",
    ["Foo", KEY_SEP + "Foo", "data/a.csv" + KEY_SEP, "  " + KEY_SEP + "Foo", 3, None, {"name": "Foo"}],
)
def test_favorites_save_rejects_entries_without_source_and_name(env, bad):
    good = "data/a.csv" + KEY_SEP + "Foo"
    env["call"]("POST", "/style_grid/favorites/save", {"items": [good]})
    before = env["favorites"].read_bytes()
    resp = env["call"]("POST", "/style_grid/favorites/save", {"items": [good, bad]})
    assert resp.status == 400
    assert resp.data["ok"] is False
    assert "source" in resp.data["error"]
    assert env["favorites"].read_bytes() == before


def test_favorites_save_requires_a_list(env):
    resp = env["call"]("POST", "/style_grid/favorites/save", {})
    assert resp.status == 400


def test_favorites_migrate_merges_dedupes_drops_bare_names_and_is_idempotent(env):
    a, b, c = (
        "data/a.csv" + KEY_SEP + "Foo",
        "imports/b.csv" + KEY_SEP + "Foo",
        "data/a.csv" + KEY_SEP + "Baz",
    )
    env["call"]("POST", "/style_grid/favorites/save", {"items": [a]})
    legacy = [b, a, "Foo", b, c, 7]
    first = env["call"]("POST", "/style_grid/favorites/migrate", {"items": legacy})
    assert first.data == {"ok": True, "items": [a, b, c], "added": 2, "dropped": ["Foo", 7], "migrated": True}
    stat_before = env["favorites"].stat().st_mtime_ns
    second = env["call"]("POST", "/style_grid/favorites/migrate", {"items": legacy})
    assert second.data == {"ok": True, "items": [a, b, c], "added": 0, "dropped": ["Foo", 7], "migrated": False}
    assert env["favorites"].stat().st_mtime_ns == stat_before


def test_favorites_migrate_creates_the_file_when_absent(env):
    a = "data/a.csv" + KEY_SEP + "Foo"
    resp = env["call"]("POST", "/style_grid/favorites/migrate", {"items": [a]})
    assert resp.data["items"] == [a]
    assert json.loads(env["favorites"].read_text(encoding="utf-8")) == {"items": [a]}
    empty = env["call"]("POST", "/style_grid/favorites/migrate", {"items": []})
    assert empty.data["items"] == [a]


def test_favorites_corrupt_file_is_409_and_never_overwritten_by_migrate(env):
    env["favorites"].write_text("{not json", encoding="utf-8")
    assert env["call"]("GET", "/style_grid/favorites").status == 409
    resp = env["call"]("POST", "/style_grid/favorites/migrate", {"items": ["data/a.csv" + KEY_SEP + "Foo"]})
    assert resp.status == 409
    assert env["favorites"].read_text(encoding="utf-8") == "{not json"


def test_favorites_failed_write_leaves_the_old_file(env, monkeypatch):
    from stylegrid import safe_persistence as sp

    a = "data/a.csv" + KEY_SEP + "Foo"
    env["sg_data"].save_favorites([a])
    before = env["favorites"].read_bytes()

    def boom(_src, _dst):
        raise OSError("disk full")

    monkeypatch.setattr(sp, "_replace_with_retry", boom)
    with pytest.raises(OSError):
        env["sg_data"].save_favorites([a, "imports/b.csv" + KEY_SEP + "Foo"])
    assert env["favorites"].read_bytes() == before
    assert not Path(str(env["favorites"]) + ".tmp").exists()


# --- rename ----------------------------------------------------------------------

def _thumb(env, name, source):
    path = Path(env["sg_thumbs"].get_thumbnail_path(name, source, ext=".png"))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + name.encode() + source.encode())
    return path


def test_rename_touches_only_the_requested_source(env):
    a_thumb = _thumb(env, "Foo", "data/a.csv")
    b_thumb = _thumb(env, "Foo", "imports/b.csv")
    fa, fb = "data/a.csv" + KEY_SEP + "Foo", "imports/b.csv" + KEY_SEP + "Foo"
    env["sg_data"].save_favorites([fa, fb])
    env["presets"].write_text(json.dumps({"P": {"styles": [
        {"name": "Foo", "source_file": "data/a.csv"},
        {"name": "Foo", "source_file": "imports/b.csv"},
    ]}}), encoding="utf-8")

    resp = env["call"]("POST", "/style_grid/style/rename",
                       {"source": "imports/b.csv", "old_name": "Foo", "new_name": "Qux"})
    assert resp.status == 200
    assert resp.data == {"ok": True}

    assert _read_names(env["data"] / "a.csv") == ["Foo", "Baz"]
    assert _read_names(env["imports"] / "b.csv") == ["Qux"]
    assert _read_names(env["samples"] / "s.csv") == ["Foo"]

    assert a_thumb.exists()
    assert not b_thumb.exists()
    moved = Path(env["sg_thumbs"].find_thumbnail_path("Qux", "imports/b.csv"))
    assert moved.read_bytes().endswith(b"Fooimports/b.csv")

    assert env["sg_data"].load_favorites()[0] == [fa, "imports/b.csv" + KEY_SEP + "Qux"]
    styles = json.loads(env["presets"].read_text(encoding="utf-8"))["P"]["styles"]
    assert [(s["name"], s["source_file"]) for s in styles] == [("Foo", "data/a.csv"), ("Qux", "imports/b.csv")]


def test_rename_keeps_fields_unless_given(env):
    env["call"]("POST", "/style_grid/style/rename",
                {"source": "data/a.csv", "old_name": "Foo", "new_name": "Foo2", "prompt": "new-p"})
    with open(env["data"] / "a.csv", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    assert rows[1] == ["Foo2", "new-p", "", "", "BODY"]
    assert rows[2] == ["Baz", "a-baz", "", "", "BODY"]


def test_rename_without_source_is_400_and_changes_nothing(env):
    before = (env["data"] / "a.csv").read_bytes(), (env["imports"] / "b.csv").read_bytes()
    for payload in ({"old_name": "Foo", "new_name": "Qux"}, {"source": "  ", "old_name": "Foo", "new_name": "Qux"}):
        resp = env["call"]("POST", "/style_grid/style/rename", payload)
        assert resp.status == 400
        assert resp.data == {"ok": False, "error": "source is required to rename a style"}
    assert ((env["data"] / "a.csv").read_bytes(), (env["imports"] / "b.csv").read_bytes()) == before


def test_rename_collision_is_400(env):
    resp = env["call"]("POST", "/style_grid/style/rename",
                       {"source": "data/a.csv", "old_name": "Foo", "new_name": "Baz"})
    assert resp.status == 400
    assert resp.data == {"ok": False, "error": "Name collision: 'Baz' already exists in a.csv"}
    assert _read_names(env["data"] / "a.csv") == ["Foo", "Baz"]


def test_rename_missing_style_is_400(env):
    resp = env["call"]("POST", "/style_grid/style/rename",
                       {"source": "imports/b.csv", "old_name": "Baz", "new_name": "X"})
    assert resp.status == 400
    assert resp.data == {"ok": False, "error": "Style not found: Baz"}


def test_rename_in_samples_is_403(env):
    resp = env["call"]("POST", "/style_grid/style/rename",
                       {"source": "samples/s.csv", "old_name": "Foo", "new_name": "X"})
    assert resp.status == 403
    assert resp.data == {"ok": False, "error": "Cannot modify styles from the read-only samples/ pack."}
    assert _read_names(env["samples"] / "s.csv") == ["Foo"]


def test_rename_names_required_like_webui(env):
    assert env["call"]("POST", "/style_grid/style/rename", {"source": "data/a.csv", "new_name": "X"}).data == {
        "error": "old_name required"
    }
    assert env["call"]("POST", "/style_grid/style/rename", {"source": "data/a.csv", "old_name": "Foo"}).data == {
        "error": "new_name required"
    }


# --- backups ---------------------------------------------------------------------

def test_backup_create_list_and_contents(env):
    env["presets"].write_text("{}", encoding="utf-8")
    env["sg_data"].save_favorites(["data/a.csv" + KEY_SEP + "Foo"])
    assert env["call"]("POST", "/style_grid/category_order/save", {"order": ["BODY", "HAIR"]}).data == {"ok": True}
    thumb = _thumb(env, "Foo", "data/a.csv")

    plain = env["call"]("POST", "/style_grid/backups/create", {})
    assert plain.data["ok"] is True
    assert sorted(plain.data["members"]) == [
        "category_order.json", "data/a.csv", "favorites.json", "imports/b.csv", "presets.json",
    ]
    assert plain.data["thumbnails_bytes"] == 0

    with_thumbs = env["call"]("POST", "/style_grid/backups/create", {"include_thumbnails": True})
    assert "thumbnails/" + thumb.name in with_thumbs.data["members"]
    assert with_thumbs.data["thumbnails_bytes"] == thumb.stat().st_size
    assert with_thumbs.data["snapshot"] != plain.data["snapshot"]

    listing = env["call"]("GET", "/style_grid/backups").data
    assert listing["keep_snapshots"] == 20
    assert listing["thumbnails_bytes"] == thumb.stat().st_size
    names = [b["name"] for b in listing["backups"]]
    assert names == sorted(names, reverse=True)
    by_name = {b["name"]: b for b in listing["backups"]}
    assert by_name[with_thumbs.data["snapshot"]]["has_thumbnails"] is True
    assert by_name[plain.data["snapshot"]]["has_thumbnails"] is False
    assert by_name[plain.data["snapshot"]]["has_zip"] is True
    assert not any(m.startswith("samples/") for b in listing["backups"] for m in b["members"])


def test_backup_retention_keeps_the_newest_20(env):
    sg = env["sg_data"]
    created = [sg.create_snapshot(snapshot_name="20250101_0000%02d" % i)["snapshot"] for i in range(22)]
    remaining = sorted(p.stem for p in env["backups"].glob("*.zip"))
    assert remaining == created[2:]
    assert len(remaining) == 20


def test_backup_prune_never_deletes_a_protected_snapshot(env):
    sg = env["sg_data"]
    for i in range(20):
        sg.create_snapshot(snapshot_name="20250101_0000%02d" % i)
    sg.create_snapshot(snapshot_name="20250102_000000", protect=("20250101_000000",))
    remaining = sorted(p.stem for p in env["backups"].glob("*.zip"))
    assert "20250101_000000" in remaining
    assert "20250101_000001" not in remaining
    assert len(remaining) == 20


def test_restore_brings_files_back_after_a_safety_snapshot(env):
    env["sg_data"].save_favorites(["data/a.csv" + KEY_SEP + "Foo"])
    env["call"]("POST", "/style_grid/category_order/save", {"order": ["BODY", "HAIR"]})
    snap = env["call"]("POST", "/style_grid/backups/create", {}).data["snapshot"]
    _write_csv(env["data"] / "a.csv", [["Changed", "x", "", "", "BODY"]])
    env["sg_data"].save_favorites(["imports/b.csv" + KEY_SEP + "Foo"])
    env["call"]("POST", "/style_grid/category_order/save", {"order": ["HAIR"]})
    assert env["call"]("GET", "/style_grid/category_order").data == ["HAIR"]

    resp = env["call"]("POST", "/style_grid/restore", {"id": snap})
    assert resp.status == 200
    assert resp.data["ok"] is True
    assert resp.data["snapshot"] == snap
    assert sorted(resp.data["restored"]) == ["category_order.json", "data/a.csv", "favorites.json", "imports/b.csv"]
    assert resp.data["skipped"] == []
    assert _read_names(env["data"] / "a.csv") == ["Foo", "Baz"]
    assert env["sg_data"].load_favorites()[0] == ["data/a.csv" + KEY_SEP + "Foo"]
    assert env["call"]("GET", "/style_grid/category_order").data == ["BODY", "HAIR"]
    safety = resp.data["safety_snapshot"]
    assert safety and safety.endswith("_safety")
    with zipfile.ZipFile(env["backups"] / (safety + ".zip")) as zf:
        assert "data/a.csv" in zf.namelist()


def test_restore_rejects_bad_names_and_missing_snapshots(env):
    assert env["call"]("POST", "/style_grid/restore", {}).status == 400
    assert env["call"]("POST", "/style_grid/restore", {"id": "../../etc"}).status == 400
    assert env["call"]("POST", "/style_grid/restore", {"id": "20990101_000000"}).status == 404


SLIP_MEMBERS = [
    "../evil1.csv",
    "data/../../evil2.csv",
    "data/../evil3.csv",
    "/evil4.csv",
    "C:/evil5.csv",
    "data\\..\\evil6.csv",
    "imports/sub/evil7.csv",
    "thumbnails/../evil8.csv",
    "samples/evil9.csv",
]


def test_restore_skips_zip_slip_members(env):
    env["backups"].mkdir(parents=True, exist_ok=True)
    zpath = env["backups"] / "20250101_000000_evil.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        for arc in SLIP_MEMBERS:
            zf.writestr(arc, "name,prompt\nEvil,x\n")
        zf.writestr("data/ok.csv", "name,prompt\nOk,x\n")
    # zipfile stores os.sep as "/" on Windows: compare with the names it really wrote.
    with zipfile.ZipFile(zpath) as zf:
        slip_names = [n for n in zf.namelist() if n != "data/ok.csv"]
    assert len(slip_names) == len(SLIP_MEMBERS)

    resp = env["call"]("POST", "/style_grid/restore", {"id": "20250101_000000_evil"})
    assert resp.status == 200
    assert resp.data["restored"] == ["data/ok.csv"]
    assert sorted(resp.data["skipped"]) == sorted(slip_names)
    written = [p for p in env["tmp"].rglob("*") if p.is_file() and "evil" in p.name and p.suffix == ".csv"]
    assert written == []
    assert not any("evil" in p.name for p in Path(os.path.dirname(env["tmp"])).glob("evil*.csv"))
    assert (env["data"] / "ok.csv").exists()
