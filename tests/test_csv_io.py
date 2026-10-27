"""CSV sanitize / legacy apostrophe migration for ComfyUI Style Grid."""

from __future__ import annotations

import csv
import io
import logging

from stylegrid import csv_io


def _patch_write_dirs(tmp_path, monkeypatch):
    from stylegrid import config as sg_config

    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    monkeypatch.setattr(csv_io, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(csv_io, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    (tmp_path / "imports").mkdir(exist_ok=True)
    (tmp_path / "samples").mkdir(exist_ok=True)
    p = tmp_path / "styles.csv"
    monkeypatch.setattr(
        csv_io,
        "get_all_styles_file_paths",
        lambda: [str(p)] if p.is_file() else [],
    )
    return p


def test_load_all_styles_shared_name_no_warning(tmp_path, monkeypatch, caplog):
    """Cross-pack duplicate names are legal; do not flood WARNING logs."""
    a = tmp_path / "pack_a.csv"
    b = tmp_path / "pack_b.csv"
    a.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "SHARED,prompt_a,neg_a,desc_a,BASE\n",
        encoding="utf-8-sig",
    )
    b.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "SHARED,prompt_b,neg_b,desc_b,BASE\n",
        encoding="utf-8-sig",
    )
    from stylegrid import config as sg_config

    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    monkeypatch.setattr(csv_io, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(
        csv_io,
        "get_all_styles_file_paths",
        lambda: [str(a), str(b)],
    )

    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        styles = csv_io.load_all_styles()

    assert len(styles) == 2
    assert {s["prompt"] for s in styles} == {"prompt_a", "prompt_b"}
    assert all(s["name"] == "SHARED" for s in styles)
    assert not [
        rec for rec in caplog.records
        if rec.name == "StyleGrid" and rec.levelno >= logging.WARNING
    ]


def test_minus_underscore_minus_round_trip_unchanged(tmp_path, monkeypatch):
    """Names like -_- must not gain a leading apostrophe on save/load."""
    p = _patch_write_dirs(tmp_path, monkeypatch)
    csv_io.save_style_to_csv(
        "-_-",
        "prompt_a",
        "neg_a",
        "desc_a",
        source_file="styles.csv",
        category="BASE",
    )
    row = next(csv.reader(io.StringIO(p.read_text(encoding="utf-8-sig"))))
    # header then data — re-read properly
    rows = list(csv.reader(io.StringIO(p.read_text(encoding="utf-8-sig"))))
    assert rows[1][0] == "-_-"
    styles = csv_io.parse_styles_csv(str(p))
    assert styles[0]["name"] == "-_-"
    assert styles[0]["prompt"] == "prompt_a"


def test_plus_underscore_plus_round_trip_unchanged(tmp_path, monkeypatch):
    """Names/prompts like +_+ / +weight_tag must not gain a leading apostrophe."""
    p = _patch_write_dirs(tmp_path, monkeypatch)
    csv_io.save_style_to_csv(
        "+_+",
        "+weight_tag",
        "-neg_tag",
        "desc",
        source_file="styles.csv",
        category="BASE",
    )
    rows = list(csv.reader(io.StringIO(p.read_text(encoding="utf-8-sig"))))
    assert rows[1][0] == "+_+"
    assert rows[1][1] == "+weight_tag"
    assert rows[1][2] == "-neg_tag"

    styles = csv_io.parse_styles_csv(str(p))
    assert styles[0]["name"] == "+_+"
    assert styles[0]["prompt"] == "+weight_tag"
    assert styles[0]["negative_prompt"] == "-neg_tag"


def test_legacy_apostrophe_stripped_on_load_only(tmp_path, monkeypatch):
    """Older files with '=formula / '-tag style cells are migrated in memory, not rewritten."""
    from stylegrid import config as sg_config

    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    p = tmp_path / "styles.csv"
    before = (
        "name,prompt,negative_prompt,description,category\n"
        "'=CMD,prompt,'-neg,'@desc,BASE\n"
    )
    p.write_text(before, encoding="utf-8-sig")
    before_bytes = p.read_bytes()

    styles = csv_io.parse_styles_csv(str(p))
    assert styles[0]["name"] == "=CMD"
    assert styles[0]["negative_prompt"] == "-neg"
    assert styles[0]["description"] == "@desc"
    assert p.read_bytes() == before_bytes, "load must not rewrite the file"


def test_delete_missing_bare_basename_returns_false(tmp_path, monkeypatch):
    """Unknown bare basename must not raise or create a file (regression vs dbe3f77)."""
    _patch_write_dirs(tmp_path, monkeypatch)
    missing = tmp_path / "nope.csv"
    assert not missing.exists()
    assert csv_io.delete_style_from_csv("Any", "nope.csv") is False
    assert not missing.exists()


def test_delete_missing_data_id_returns_false(tmp_path, monkeypatch):
    """Unknown data/ id must not raise or create a file (regression vs dbe3f77)."""
    _patch_write_dirs(tmp_path, monkeypatch)
    missing = tmp_path / "missing.csv"
    assert not missing.exists()
    assert csv_io.delete_style_from_csv("Any", "data/missing.csv") is False
    assert not missing.exists()


def test_delete_imports_id_when_data_has_same_basename(tmp_path, monkeypatch):
    """Delete via imports/ id must hit only the imports file."""
    from stylegrid import config as sg_config

    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    monkeypatch.setattr(csv_io, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(csv_io, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    (tmp_path / "imports").mkdir(exist_ok=True)
    (tmp_path / "samples").mkdir(exist_ok=True)
    data_csv = tmp_path / "foo.csv"
    imports_csv = tmp_path / "imports" / "foo.csv"
    header = "name,prompt,negative_prompt,description,category\n"
    data_csv.write_text(header + "KeepMe,p,n,d,BASE\n", encoding="utf-8-sig")
    imports_csv.write_text(header + "DropMe,p,n,d,BASE\n", encoding="utf-8-sig")
    monkeypatch.setattr(
        csv_io,
        "get_all_styles_file_paths",
        lambda: [str(data_csv), str(imports_csv)],
    )

    assert csv_io.delete_style_from_csv("DropMe", "imports/foo.csv") is True
    assert "DropMe" not in imports_csv.read_text(encoding="utf-8-sig")
    assert "KeepMe" in data_csv.read_text(encoding="utf-8-sig")
