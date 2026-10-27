"""Relative source ids: resolver, csv emit, writes, active_source, presets migration."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from stylegrid import config as sg_config
from stylegrid import csv_io, source_ids
from stylegrid import data_files as sg_data
from stylegrid import thumbnails as sg_thumbs
from stylegrid.prompt_ops import build_styles_by_cat
from stylegrid.safe_persistence import CorruptDataError


def _patch_roots(monkeypatch, data: Path, samples: Path | None = None) -> None:
    data.mkdir(parents=True, exist_ok=True)
    imports = data / "imports"
    imports.mkdir(parents=True, exist_ok=True)
    if samples is None:
        samples = data / "samples_root"
        samples.mkdir(parents=True, exist_ok=True)
    else:
        samples.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(sg_config, "DATA_DIR", str(data))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(samples))
    monkeypatch.setattr(csv_io, "DATA_DIR", str(data))
    monkeypatch.setattr(csv_io, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(csv_io, "SAMPLES_DIR", str(samples))
    monkeypatch.setattr(sg_data, "DATA_DIR", str(data))
    monkeypatch.setattr(sg_data, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(data / "presets.json"))
    monkeypatch.setattr(sg_config, "PRESETS_FILE", str(data / "presets.json"))


def _write_csv(path: Path, name: str = "S1") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "name,prompt,negative_prompt,description,category\n"
        f"{name},p,n,d,BASE\n",
        encoding="utf-8-sig",
    )


def test_round_trip_each_root(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    samples = tmp_path / "ext_samples"
    _patch_roots(monkeypatch, data, samples)
    data_csv = data / "foo.csv"
    imports_csv = data / "imports" / "foo.csv"
    samples_csv = samples / "foo.csv"
    _write_csv(data_csv)
    _write_csv(imports_csv)
    _write_csv(samples_csv)

    assert source_ids.to_source_id(str(data_csv)) == "data/foo.csv"
    assert source_ids.to_source_id(str(imports_csv)) == "imports/foo.csv"
    assert source_ids.to_source_id(str(samples_csv)) == "samples/foo.csv"

    assert source_ids.resolve_source_id("data/foo.csv") == os.path.normpath(
        os.path.abspath(str(data_csv))
    )
    assert source_ids.resolve_source_id("imports/foo.csv") == os.path.normpath(
        os.path.abspath(str(imports_csv))
    )
    assert source_ids.resolve_source_id("samples/foo.csv") == os.path.normpath(
        os.path.abspath(str(samples_csv))
    )


def test_same_basename_distinct_ids(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    _write_csv(data / "foo.csv")
    _write_csv(data / "imports" / "foo.csv")
    assert source_ids.to_source_id(str(data / "foo.csv")) == "data/foo.csv"
    assert source_ids.to_source_id(str(data / "imports" / "foo.csv")) == "imports/foo.csv"


@pytest.mark.parametrize(
    "bad_id",
    [
        "../x.csv",
        "data/../x.csv",
        "data/sub/x.csv",
        "data\\x.csv",
        "C:/x.csv",
        "other/x.csv",
        "data/x.txt",
        "data/.",
        "data/..",
    ],
)
def test_resolve_rejects_bad_ids(bad_id, tmp_path, monkeypatch):
    _patch_roots(monkeypatch, tmp_path / "style_grid")
    assert source_ids.resolve_source_id(bad_id) is None


def test_coerce_maps_abs_inside_rejects_outside(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    inside = data / "foo.csv"
    _write_csv(inside)
    outside = tmp_path / "elsewhere" / "foo.csv"
    _write_csv(outside)
    assert source_ids.coerce_source_ref(str(inside)) == os.path.normpath(
        os.path.abspath(str(inside))
    )
    assert source_ids.coerce_source_ref(str(outside)) is None
    assert source_ids.coerce_source_ref("foo.csv") is None


def test_moved_install_ids_and_thumb_hash_stable(tmp_path, monkeypatch):
    name = "BODY_Ears"

    def _tree(root: Path) -> tuple[str, str, str]:
        data = root / "style_grid"
        samples = root / "samples"
        _patch_roots(monkeypatch, data, samples)
        data_csv = data / "pack.csv"
        imports_csv = data / "imports" / "pack.csv"
        samples_csv = samples / "demo.csv"
        _write_csv(data_csv)
        _write_csv(imports_csv)
        _write_csv(samples_csv)
        return str(data_csv), str(imports_csv), str(samples_csv)

    a = tmp_path / "install_a"
    b = tmp_path / "install_b"
    a_paths = _tree(a)
    ids_a = [source_ids.to_source_id(p) for p in a_paths]
    hashes_from_abs_a = [sg_thumbs.thumbnail_hash_key(name, p) for p in a_paths]
    hashes_from_id_a = [sg_thumbs.thumbnail_hash_key(name, sid) for sid in ids_a]

    b_paths = _tree(b)
    ids_b = [source_ids.to_source_id(p) for p in b_paths]
    hashes_from_abs_b = [sg_thumbs.thumbnail_hash_key(name, p) for p in b_paths]
    hashes_from_id_b = [sg_thumbs.thumbnail_hash_key(name, sid) for sid in ids_b]

    assert ids_a == ids_b == ["data/pack.csv", "imports/pack.csv", "samples/demo.csv"]
    assert hashes_from_id_a == hashes_from_abs_a
    assert hashes_from_id_b == hashes_from_abs_b
    assert hashes_from_id_a == hashes_from_id_b


def test_parse_styles_csv_emits_ids_not_abs(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    path = data / "pack.csv"
    _write_csv(path, "Alpha")
    styles = csv_io.parse_styles_csv(str(path))
    assert styles
    sf = styles[0]["source_file"]
    assert sf == "data/pack.csv"
    root_s = str(tmp_path)
    assert root_s not in sf
    assert "\\" not in sf
    assert not (len(sf) >= 2 and sf[1] == ":")


def test_writes_prefer_id_target(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    data_csv = data / "foo.csv"
    imports_csv = data / "imports" / "foo.csv"
    _write_csv(data_csv, "InData")
    _write_csv(imports_csv, "InImports")
    monkeypatch.setattr(
        csv_io,
        "get_all_styles_file_paths",
        lambda: [str(data_csv), str(imports_csv)],
    )

    assert csv_io.save_style_to_csv(
        "NewOne", "p", "n", "d", source_file="imports/foo.csv", category="BASE"
    )
    text = imports_csv.read_text(encoding="utf-8-sig")
    assert "NewOne" in text
    assert "NewOne" not in data_csv.read_text(encoding="utf-8-sig")

    assert csv_io.delete_style_from_csv("NewOne", "imports/foo.csv") is True
    assert "NewOne" not in imports_csv.read_text(encoding="utf-8-sig")

    assert (
        csv_io.save_style_to_csv(
            "X", "p", "n", source_file="samples/demo.csv", category="BASE"
        )
        is False
    )
    outside = tmp_path / "nope" / "x.csv"
    _write_csv(outside)
    assert (
        csv_io.save_style_to_csv(
            "X", "p", "n", source_file=str(outside), category="BASE"
        )
        is False
    )

    assert csv_io.save_style_to_csv(
        "Bare", "p", "n", source_file="foo.csv", category="BASE"
    )
    assert "Bare" in data_csv.read_text(encoding="utf-8-sig")


def test_build_styles_by_cat_active_source(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    samples = tmp_path / "samples"
    _patch_roots(monkeypatch, data, samples)
    _write_csv(data / "foo.csv", "A")
    _write_csv(data / "imports" / "foo.csv", "B")
    styles = [
        {
            "name": "A",
            "category": "BASE",
            "source_file": "data/foo.csv",
            "source": "foo.csv",
        },
        {
            "name": "B",
            "category": "BASE",
            "source_file": "imports/foo.csv",
            "source": "foo.csv",
        },
    ]
    by_id = build_styles_by_cat(styles, "data/foo.csv")
    assert [s["name"] for s in by_id["base"]] == ["A"]

    abs_data = str(data / "foo.csv")
    by_abs = build_styles_by_cat(styles, abs_data)
    assert [s["name"] for s in by_abs["base"]] == ["A"]

    warnings: list[str] = []
    by_amb = build_styles_by_cat(styles, "foo.csv", warnings=warnings)
    assert by_amb == {}
    assert len(warnings) == 1
    assert "foo.csv" in warnings[0]
    assert "data/foo.csv" in warnings[0]
    assert "imports/foo.csv" in warnings[0]

    unique = [
        {
            "name": "Only",
            "category": "BASE",
            "source_file": "data/bar.csv",
            "source": "bar.csv",
        }
    ]
    by_base = build_styles_by_cat(unique, "bar.csv")
    assert [s["name"] for s in by_base["base"]] == ["Only"]


def test_migrate_presets_source_ids_once(tmp_path, monkeypatch):
    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    abs_path = os.path.abspath(str(data / "pack.csv"))
    _write_csv(data / "pack.csv")
    presets_path = Path(sg_data.PRESETS_FILE)
    outside = os.path.abspath(str(tmp_path / "outside.csv"))
    payload = {
        "P": {
            "styles": [
                {"name": "A", "source_file": abs_path, "weight": 1.0},
                {"name": "B", "source_file": outside, "weight": 1.0},
            ],
            "wildcards": [],
            "note": "",
            "created": "2026-01-01T00:00:00",
        }
    }
    presets_path.write_text(json.dumps(payload), encoding="utf-8")

    n = sg_data.migrate_presets_source_ids_once()
    assert n == 1
    disk = json.loads(presets_path.read_text(encoding="utf-8"))
    assert disk["P"]["styles"][0]["source_file"] == "data/pack.csv"
    assert disk["P"]["styles"][1]["source_file"] == outside
    assert presets_path.with_suffix(presets_path.suffix + ".bak").exists() or (
        Path(str(presets_path) + ".bak").exists()
    )
    assert Path(str(presets_path) + ".bak").is_file()
    assert sg_data.migrate_presets_source_ids_once() == 0

    presets_path.write_text("{not-json", encoding="utf-8")
    before = presets_path.read_bytes()
    assert sg_data.migrate_presets_source_ids_once() == 0
    assert presets_path.read_bytes() == before


def test_corrupt_payload_hides_abs(tmp_path, monkeypatch):
    import sys
    import types

    if "aiohttp" not in sys.modules:
        aiohttp = types.ModuleType("aiohttp")
        web = types.ModuleType("aiohttp.web")
        aiohttp.web = web
        sys.modules["aiohttp"] = aiohttp
        sys.modules["aiohttp.web"] = web

    from stylegrid import routes as sg_routes

    data = tmp_path / "style_grid"
    _patch_roots(monkeypatch, data)
    monkeypatch.setattr(sg_routes, "DATA_DIR", str(data))
    abs_presets = os.path.abspath(str(data / "presets.json"))
    exc = CorruptDataError(abs_presets, "unreadable or invalid JSON")
    payload = sg_routes._corrupt_payload(exc)
    assert abs_presets not in payload["path"]
    assert abs_presets not in payload["bak_path"]
    assert abs_presets not in payload["message"]
    assert "\\" not in payload["path"]
    assert payload["path"] == "presets.json"
