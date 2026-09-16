"""Phase A preset normalize / payload helpers (Comfy)."""

import json
import os
import sys

import pytest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)


@pytest.fixture
def data_files(tmp_path, monkeypatch):
    from stylegrid import data_files as sg_data
    from stylegrid import config as sg_config

    presets_path = tmp_path / "presets.json"
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    monkeypatch.setattr(sg_config, "PRESETS_FILE", str(presets_path))
    monkeypatch.setattr(
        sg_data,
        "load_all_styles",
        lambda: [
            {
                "name": "Test Style A",
                "source_file": str(tmp_path / "pack.csv").replace("\\", "/"),
            }
        ],
    )
    return sg_data, presets_path


def test_normalize_bare_names_and_keep_missing(data_files):
    sg_data, presets_path = data_files
    presets_path.write_text(
        json.dumps(
            {
                "P": {
                    "styles": ["Test Style A", "Gone"],
                    "created": "2026-01-01T00:00:00",
                }
            }
        ),
        encoding="utf-8",
    )
    loaded = sg_data.load_presets()
    assert [e["name"] for e in loaded["P"]["styles"]] == ["Test Style A", "Gone"]
    assert loaded["P"]["styles"][1]["source_file"] == ""
    assert loaded["P"]["wildcards"] == []
    assert loaded["P"]["note"] == ""
    disk = json.loads(presets_path.read_text(encoding="utf-8"))
    assert disk["P"]["styles"][0]["weight"] == 1.0


def test_preset_styles_payload_ok_accepts_objects(data_files):
    sg_data, _ = data_files
    assert sg_data.preset_styles_payload_ok(["A", {"name": "B", "source_file": "x.csv"}])
    assert not sg_data.preset_styles_payload_ok([{"source_file": "x.csv"}])
    assert not sg_data.preset_styles_payload_ok("A")
