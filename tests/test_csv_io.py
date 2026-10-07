"""CSV sanitize / legacy apostrophe migration for ComfyUI Style Grid."""

from __future__ import annotations

import csv
import io

from stylegrid import csv_io


def _patch_write_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    monkeypatch.setattr(csv_io, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(csv_io, "IMPORTS_DIR", str(tmp_path / "imports"))
    p = tmp_path / "styles.csv"
    monkeypatch.setattr(
        csv_io,
        "get_all_styles_file_paths",
        lambda: [str(p)] if p.is_file() else [],
    )
    return p


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


def test_legacy_apostrophe_stripped_on_load_only(tmp_path):
    """Older files with '=formula / '-tag style cells are migrated in memory, not rewritten."""
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
