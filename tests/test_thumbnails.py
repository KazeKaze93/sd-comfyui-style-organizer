"""Unit tests for thumbnail identity (name + source) and legacy migration."""

from __future__ import annotations

from pathlib import Path

import pytest

from stylegrid import config as sg_config
from stylegrid import thumbnails as sg_thumbs


@pytest.fixture
def thumbs_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbnails"
    d.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(d))
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [str(tmp_path)])
    monkeypatch.setattr(sg_thumbs, "discover_renamed_old_names", lambda: set())
    return d


@pytest.fixture
def rooted_thumbs(tmp_path, monkeypatch):
    """DATA/IMPORTS/SAMPLES roots so to_source_id resolves."""
    data = tmp_path / "style_grid"
    data.mkdir()
    imports = data / "imports"
    imports.mkdir()
    samples = tmp_path / "ext_samples"
    samples.mkdir()
    thumbs = data / "thumbnails"
    thumbs.mkdir()
    monkeypatch.setattr(sg_config, "DATA_DIR", str(data))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(imports))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(samples))
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(thumbs))
    monkeypatch.setattr(
        sg_thumbs, "get_styles_dirs", lambda: [str(data), str(imports), str(samples)]
    )
    monkeypatch.setattr(sg_thumbs, "discover_renamed_old_names", lambda: set())
    return {"data": data, "imports": imports, "samples": samples, "thumbs": thumbs}


def _write_legacy(thumbs_dir, name, payload=b"\x89PNG\r\n\x1a\nLEGACY", ext=".png"):
    path = thumbs_dir / f"{sg_thumbs.legacy_thumbnail_stem(name)}{ext}"
    path.write_bytes(payload)
    return path


def _write_rel(thumbs_dir, name, source, payload=b"\x89PNG\r\n\x1a\nREL", ext=".png"):
    path = thumbs_dir / f"{sg_thumbs._legacy_rel_stem(name, source)}{ext}"
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


def test_same_basename_in_two_roots_gives_different_stems(rooted_thumbs):
    data_csv = str(rooted_thumbs["data"] / "foo.csv")
    imports_csv = str(rooted_thumbs["imports"] / "foo.csv")
    name = "BASE_Shared"
    assert sg_thumbs.thumbnail_hash_key(name, data_csv) != sg_thumbs.thumbnail_hash_key(
        name, imports_csv
    )
    assert sg_thumbs._thumbnail_hash_input(name, data_csv) == f"{name}::data/foo.csv"
    assert (
        sg_thumbs._thumbnail_hash_input(name, imports_csv) == f"{name}::imports/foo.csv"
    )


def test_migrate_rel_unique_old_stem(rooted_thumbs):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "CAMERA_Closeup"
    payload = b"\x89PNG\r\n\x1a\nUNIQUE"
    old = _write_rel(rooted_thumbs["thumbs"], name, src, payload)
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] + result["copied"] == 1
    assert result["need_regeneration"] == 0
    assert old.exists()
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png"))
    assert new_path.exists()
    assert new_path.read_bytes() == payload
    assert old.read_bytes() == payload


def test_migrate_rel_shared_identical_places_all(rooted_thumbs):
    a = str(rooted_thumbs["data"] / "foo.csv")
    b = str(rooted_thumbs["samples"] / "foo.csv")
    name = "LIGHTING_Rim"
    payload = b"RIFF....WEBPSHARED"
    old = _write_rel(rooted_thumbs["thumbs"], name, a, payload, ext=".webp")
    assert sg_thumbs._legacy_rel_stem(name, a) == sg_thumbs._legacy_rel_stem(name, b)
    styles = [
        {"name": name, "source_file": a, "prompt": "rim light", "negative_prompt": "flat"},
        {"name": name, "source_file": b, "prompt": "rim light", "negative_prompt": "flat"},
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] + result["copied"] == 2
    assert result["need_regeneration"] == 0
    assert old.exists()
    assert Path(sg_thumbs.get_thumbnail_path(name, a, ext=".webp")).read_bytes() == payload
    assert Path(sg_thumbs.get_thumbnail_path(name, b, ext=".webp")).read_bytes() == payload


def test_migrate_rel_shared_diverging_needs_regeneration(rooted_thumbs):
    a = str(rooted_thumbs["data"] / "foo.csv")
    b = str(rooted_thumbs["samples"] / "foo.csv")
    name = "BASE_Anti_3D"
    old = _write_rel(rooted_thumbs["thumbs"], name, a, b"SHARED", ext=".webp")
    styles = [
        {"name": name, "source_file": a, "prompt": "", "negative_prompt": "3d"},
        {"name": name, "source_file": b, "prompt": "", "negative_prompt": "3d, realistic"},
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] == 0
    assert result["copied"] == 0
    assert result["need_regeneration"] == 1
    assert old.exists()
    assert sg_thumbs.find_thumbnail_path(name, a) is None
    assert sg_thumbs.find_thumbnail_path(name, b) is None


def test_migrate_rel_never_overwrites_existing(rooted_thumbs):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "POSE_Standing"
    old = _write_rel(rooted_thumbs["thumbs"], name, src, b"\x89PNG\r\n\x1a\nOLD")
    existing = Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png"))
    existing.write_bytes(b"\x89PNG\r\n\x1a\nKEEP")
    styles = [
        {"name": name, "source_file": src, "prompt": "standing", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["skipped_existing"] == 1
    assert result["linked"] == 0
    assert result["copied"] == 0
    assert existing.read_bytes() == b"\x89PNG\r\n\x1a\nKEEP"
    assert old.exists()


def test_migrate_rel_second_run_idempotent(rooted_thumbs):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "POSE_Standing"
    _write_rel(rooted_thumbs["thumbs"], name, src, b"ONCE", ext=".webp")
    styles = [
        {"name": name, "source_file": src, "prompt": "standing", "negative_prompt": ""}
    ]
    first = sg_thumbs.migrate_rel_thumbnails(styles)
    second = sg_thumbs.migrate_rel_thumbnails(styles)
    assert first["linked"] + first["copied"] == 1
    assert second["linked"] == 0
    assert second["copied"] == 0


def test_migrate_rel_hardlink_isolation_after_rewrite(rooted_thumbs):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "CAMERA_Closeup"
    old_payload = b"\x89PNG\r\n\x1a\nOLDSTEM"
    old = _write_rel(rooted_thumbs["thumbs"], name, src, old_payload)
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["linked"] + result["copied"] == 1
    new_raw = b"\x89PNG\r\n\x1a\nNEWRITE"
    sg_thumbs.clear_thumbnail_files(name, src)
    ext = sg_thumbs.detect_image_ext(new_raw)
    path = sg_thumbs.get_thumbnail_path(name, src, ext=ext)
    with open(path, "wb") as f:
        f.write(new_raw)
    assert old.exists()
    assert old.read_bytes() == old_payload


def test_migrate_rel_link_fallback_to_copy2(rooted_thumbs, monkeypatch):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "CAMERA_Closeup"
    _write_rel(rooted_thumbs["thumbs"], name, src, b"\x89PNG\r\n\x1a\nCOPY")
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]

    def _boom(*_a, **_k):
        raise OSError("no hardlinks")

    monkeypatch.setattr(sg_thumbs.os, "link", _boom)
    result = sg_thumbs.migrate_rel_thumbnails(styles)
    assert result["copied"] == 1
    assert result["linked"] == 0
    assert Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png")).read_bytes().endswith(
        b"COPY"
    )


def test_to_source_id_none_falls_back_to_legacy_rel(rooted_thumbs, monkeypatch):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "CAMERA_Closeup"
    monkeypatch.setattr(sg_thumbs, "to_source_id", lambda _p: None)
    assert sg_thumbs._thumbnail_hash_input(name, src) == sg_thumbs._legacy_rel_hash_input(
        name, src
    )


def test_name_only_legacy_migrates_to_source_id_stem(rooted_thumbs):
    src = str(rooted_thumbs["data"] / "pack.csv")
    name = "CAMERA_Closeup"
    legacy = _write_legacy(rooted_thumbs["thumbs"], name)
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert legacy.exists()
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png"))
    assert new_path.exists()
    assert sg_thumbs._thumbnail_hash_input(name, src) == f"{name}::data/pack.csv"
    assert new_path.name.startswith(sg_thumbs.thumbnail_hash_key(name, src))


def test_cleanup_keeps_rel_stem_removes_orphan(rooted_thumbs, monkeypatch):
    src = str(rooted_thumbs["data"] / "only.csv")
    name = "CAMERA_Closeup"
    old = _write_rel(rooted_thumbs["thumbs"], name, src, b"\x89PNG\r\n\x1a\nREL")
    orphan = rooted_thumbs["thumbs"] / "deadbeefdeadbeefdeadbeefdeadbeef.webp"
    orphan.write_bytes(b"ORPHAN")
    styles = [
        {"name": name, "source_file": src, "prompt": "closeup", "negative_prompt": ""}
    ]
    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: styles)
    result = sg_thumbs.cleanup_orphan_thumbnails()
    assert old.exists()
    assert not orphan.exists()
    assert result["removed"] == 1
    assert Path(sg_thumbs.get_thumbnail_path(name, src, ext=".png")).exists()
