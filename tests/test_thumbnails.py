"""Unit tests for thumbnail identity (name + source) and legacy migration."""

from __future__ import annotations

from pathlib import Path

import pytest

from stylegrid import thumbnails as sg_thumbs


@pytest.fixture
def thumbs_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbnails"
    d.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(d))
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [str(tmp_path)])
    monkeypatch.setattr(sg_thumbs, "discover_renamed_old_names", lambda: set())
    return d


def _write_legacy(thumbs_dir, name, payload=b"\x89PNG\r\n\x1a\nLEGACY", ext=".png"):
    path = thumbs_dir / f"{sg_thumbs.legacy_thumbnail_stem(name)}{ext}"
    path.write_bytes(payload)
    return path


def test_hash_keys_differ_across_source_files(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "BASE_Anti_Futa"
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.thumbnail_hash_key(name, b)
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.legacy_thumbnail_stem(name)


def test_furry_futa_labeled_styles_are_independent(thumbs_dir, tmp_path):
    src = str(tmp_path / "pack.csv")
    keys = {
        sg_thumbs.thumbnail_hash_key("BODY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FURRY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FUTA_Ears", src),
    }
    assert len(keys) == 3
    legacy_base = _write_legacy(thumbs_dir, "BODY_Ears", b"\x89PNG\r\n\x1a\nBASE")
    styles = [
        {"name": "BODY_Ears", "source_file": src, "prompt": "ears", "negative_prompt": ""},
        {
            "name": "BODY_FURRY_Ears",
            "source_file": src,
            "prompt": "animal ears",
            "negative_prompt": "",
        },
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert Path(sg_thumbs.get_thumbnail_path("BODY_Ears", src, ext=".png")).read_bytes().startswith(
        b"\x89PNG"
    )
    assert sg_thumbs.find_thumbnail_path("BODY_FURRY_Ears", src) is None
    assert legacy_base.exists()


def test_migrate_unique_name_copies_legacy_file(thumbs_dir, tmp_path):
    src = str(tmp_path / "only.csv")
    name = "CAMERA_Closeup"
    legacy = _write_legacy(thumbs_dir, name)
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert result["need_regeneration"] == 0
    assert legacy.exists()
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png"))
    assert new_path.exists()
    assert new_path.read_bytes().startswith(b"\x89PNG")


def test_migrate_identical_multi_file_copies_to_both_keys(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "LIGHTING_Rim"
    legacy = _write_legacy(thumbs_dir, name, b"RIFF....WEBPSHARED", ext=".webp")
    styles = [
        {"name": name, "source_file": a, "prompt": "rim light", "negative_prompt": "flat"},
        {"name": name, "source_file": b, "prompt": "rim light", "negative_prompt": "flat"},
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert result["need_regeneration"] == 0
    assert legacy.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a, ext=".webp")).read_bytes().endswith(b"SHARED")
    assert Path(sg_thumbs.get_thumbnail_path(name, b, ext=".webp")).read_bytes().endswith(b"SHARED")


def test_migrate_diverging_multi_file_does_not_guess(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "BASE_Anti_3D"
    legacy = _write_legacy(thumbs_dir, name, b"SHARED", ext=".webp")
    styles = [
        {"name": name, "source_file": a, "prompt": "", "negative_prompt": "3d"},
        {"name": name, "source_file": b, "prompt": "", "negative_prompt": "3d, realistic"},
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 0
    assert result["need_regeneration"] == 1
    assert legacy.exists()
    assert sg_thumbs.find_thumbnail_path(name, a) is None
    assert sg_thumbs.find_thumbnail_path(name, b) is None


def test_migrate_renamed_old_name_needs_regeneration(thumbs_dir, tmp_path):
    src = str(tmp_path / "furry.csv")
    name = "ACTION_Rimjob"
    legacy = _write_legacy(thumbs_dir, name)
    styles = [
        {"name": name, "source_file": src, "prompt": "rimjob", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles, renamed_old_names={name})
    assert result["migrated"] == 0
    assert result["need_regeneration"] == 1
    assert legacy.exists()
    assert sg_thumbs.find_thumbnail_path(name, src) is None


def test_migrate_orphan_name_category(thumbs_dir, tmp_path):
    gone = "DELETED_Style"
    legacy = _write_legacy(thumbs_dir, gone)
    keep_src = str(tmp_path / "keep.csv")
    styles = [
        {
            "name": "KEEP_Style",
            "source_file": keep_src,
            "prompt": "x",
            "negative_prompt": "",
        }
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(
        styles, legacy_names=[gone, "KEEP_Style"]
    )
    assert result["orphaned"] == 1
    assert result["migrated"] == 0
    assert legacy.exists()


def test_migrate_second_run_is_idempotent(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "POSE_Standing"
    legacy = _write_legacy(thumbs_dir, name, b"ONCE", ext=".webp")
    styles = [
        {"name": name, "source_file": a, "prompt": "standing", "negative_prompt": ""},
        {"name": name, "source_file": b, "prompt": "standing", "negative_prompt": ""},
    ]
    first = sg_thumbs.migrate_legacy_thumbnails(styles)
    second = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert first["migrated"] == 1
    assert second["migrated"] == 0
    assert second["skipped_existing"] == 1
    assert legacy.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a, ext=".webp")).read_bytes() == b"ONCE"
    assert Path(sg_thumbs.get_thumbnail_path(name, b, ext=".webp")).read_bytes() == b"ONCE"


def test_list_thumbnails_is_source_aware(thumbs_dir, tmp_path, monkeypatch):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "POSE_Standing"
    Path(sg_thumbs.get_thumbnail_path(name, a, ext=".webp")).write_bytes(b"A")
    styles = [
        {"name": name, "source_file": a, "prompt": "standing", "negative_prompt": ""},
        {"name": name, "source_file": b, "prompt": "standing", "negative_prompt": ""},
    ]
    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: styles)
    listed = sg_thumbs.list_thumbnails()
    assert listed == [{"name": name, "source_file": a}]


def test_cleanup_preserves_legacy_for_catalog_styles(thumbs_dir, tmp_path, monkeypatch):
    src = str(tmp_path / "only.csv")
    name = "CAMERA_Closeup"
    legacy = _write_legacy(thumbs_dir, name)
    orphan = thumbs_dir / "deadbeefdeadbeefdeadbeefdeadbeef.webp"
    orphan.write_bytes(b"ORPHAN")
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: styles)
    result = sg_thumbs.cleanup_orphan_thumbnails()
    assert legacy.exists()
    assert not orphan.exists()
    assert result["removed"] == 1
    assert Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png")).exists()
