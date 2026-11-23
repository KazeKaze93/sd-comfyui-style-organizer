"""POST /style_grid/backup and /style_grid/import speak the WebUI iframe's contracts."""

from __future__ import annotations

import csv
import io
import json
import zipfile

from tests.test_port_routes import _read_names, _thumb, _write_csv, env  # noqa: F401  (fixture)


def _import_files(env):
    return sorted(p.name for p in env["imports"].glob("imported_*.csv"))


def _rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f))[1:]


# --- /backup ---------------------------------------------------------------------

def test_backup_returns_the_snapshot_contract(env):
    resp = env["call"]("POST", "/style_grid/backup", {})
    assert resp.status == 200
    assert set(resp.data) == {"ok", "snapshot", "members", "thumbnails_bytes"}
    assert resp.data["ok"] is True
    assert (env["backups"] / (resp.data["snapshot"] + ".zip")).is_file()
    assert "file" not in resp.data


def test_backup_honors_include_thumbnails(env):
    thumb = _thumb(env, "Foo", "data/a.csv")
    plain = env["call"]("POST", "/style_grid/backup", {}).data
    with_thumbs = env["call"]("POST", "/style_grid/backup", {"include_thumbnails": True}).data
    assert not any(m.startswith("thumbnails/") for m in plain["members"])
    assert "thumbnails/" + thumb.name in with_thumbs["members"]
    assert with_thumbs["thumbnails_bytes"] == thumb.stat().st_size


def test_backup_and_backups_create_are_the_same_handler(env):
    a = env["call"]("POST", "/style_grid/backup", {"include_thumbnails": True}).data
    b = env["call"]("POST", "/style_grid/backups/create", {"include_thumbnails": True}).data
    assert sorted(a["members"]) == sorted(b["members"])
    with zipfile.ZipFile(env["backups"] / (a["snapshot"] + ".zip")) as za, zipfile.ZipFile(
        env["backups"] / (b["snapshot"] + ".zip")
    ) as zb:
        assert sorted(za.namelist()) == sorted(zb.namelist())
        for name in za.namelist():
            assert za.read(name) == zb.read(name)


# --- /import -------------------------------------------------------------------------

def _import(env, payload):
    return env["call"]("POST", "/style_grid/import", payload)


def test_import_response_fields(env):
    resp = _import(env, {"styles": [{"name": "New", "prompt": "n", "negative_prompt": ""}]})
    assert resp.data == {
        "ok": True,
        "imported": 1,
        "collisions": [],
        "invalid": 0,
        "presets_imported": 0,
        "presets_skipped": 0,
    }


def test_identical_row_already_in_the_library_is_a_collision_and_not_written(env):
    before = (env["data"] / "a.csv").read_bytes()
    resp = _import(env, {"styles": [{"name": "Foo", "prompt": "a-foo", "negative_prompt": ""}]})
    assert resp.data["collisions"] == ["Foo"]
    assert resp.data["imported"] == 0
    assert _import_files(env) == []
    assert (env["data"] / "a.csv").read_bytes() == before


def test_identical_row_in_another_pack_is_a_collision(env):
    # imports/b.csv holds Foo with prompt "b-foo"; data/a.csv holds Foo with "a-foo".
    resp = _import(env, {"styles": [{"name": "Foo", "prompt": "b-foo", "negative_prompt": ""}]})
    assert resp.data["collisions"] == ["Foo"]
    assert resp.data["imported"] == 0


def test_same_name_with_different_content_is_imported(env):
    resp = _import(env, {"styles": [
        {"name": "Foo", "prompt": "a-foo", "negative_prompt": "blurry"},
        {"name": "Foo", "prompt": "other prompt", "negative_prompt": ""},
    ]})
    assert resp.data["collisions"] == []
    assert resp.data["imported"] == 2
    [written] = _import_files(env)
    assert [r[:3] for r in _rows(env["imports"] / written)] == [
        ["Foo", "a-foo", "blurry"],
        ["Foo", "other prompt", ""],
    ]
    assert _read_names(env["data"] / "a.csv") == ["Foo", "Baz"]


def test_samples_are_not_part_of_the_duplicate_check(env):
    resp = _import(env, {"styles": [{"name": "Foo", "prompt": "s-foo", "negative_prompt": ""}]})
    assert resp.data["collisions"] == []
    assert resp.data["imported"] == 1


def test_duplicate_rows_inside_one_import_are_written_once(env):
    row = {"name": "Twice", "prompt": "t", "negative_prompt": ""}
    resp = _import(env, {"styles": [row, dict(row)]})
    assert resp.data["imported"] == 1
    assert resp.data["collisions"] == ["Twice"]


def test_invalid_rows_are_counted(env):
    resp = _import(env, {"styles": [
        "not an object",
        {"prompt": "no name"},
        {"name": "   ", "prompt": "blank"},
        {"name": 5},
        {"name": "Good", "prompt": "g"},
    ]})
    assert resp.data["invalid"] == 4
    assert resp.data["imported"] == 1


def test_reimporting_own_export_writes_nothing(env):
    exported = env["call"]("GET", "/style_grid/export").data
    assert {s["name"] for s in exported["styles"]} == {"Foo", "Baz"}
    resp = _import(env, {"styles": exported["styles"]})
    assert resp.data["imported"] == 0
    assert resp.data["collisions"] == ["Baz", "Foo"]
    assert resp.data["invalid"] == 0
    assert _import_files(env) == []


def test_reimporting_a_backup_zip_writes_nothing(env):
    snap = env["call"]("POST", "/style_grid/backup", {}).data["snapshot"]
    raw = (env["backups"] / (snap + ".zip")).read_bytes()
    from tests.test_import_ignores_usage import _FakeRequest  # raw body, not JSON

    resp = env["handlers"][("POST", "/style_grid/import")](_FakeRequest(raw))
    import asyncio

    data = asyncio.run(resp).data
    assert data["imported"] == 0
    assert data["collisions"] == ["Baz", "Foo"]
    assert _import_files(env) == []


def test_presets_counter_and_presets_only_import(env):
    # Unchanged presets behavior: a same-named preset is replaced; only invalid entries are skipped.
    payload = {"presets": {"P": {"styles": [{"name": "Foo", "source_file": "data/a.csv"}]}, "Bad": "x"}}
    first = _import(env, payload)
    assert first.data == {"ok": True, "presets_imported": 1, "presets_skipped": 1}
    second = _import(env, payload)
    assert second.data == {"ok": True, "presets_imported": 1, "presets_skipped": 1}
    assert list(json.loads(env["presets"].read_text(encoding="utf-8"))) == ["P"]
    both = _import(env, {**payload, "styles": [{"name": "Foo", "prompt": "a-foo", "negative_prompt": ""}]})
    assert both.data["presets_imported"] == 1
    assert both.data["collisions"] == ["Foo"]


def test_nothing_importable_is_still_an_error(env):
    assert _import(env, {"usage": {}}).data == {"error": "No importable data found in file"}
    assert _import(env, {"styles": "nope"}).data == {"error": "styles must be a list"}
    assert json.loads(json.dumps(_import(env, {"styles": []}).data))["imported"] == 0
