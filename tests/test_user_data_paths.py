"""User-dir data root resolution and legacy migration (copy-only)."""

from __future__ import annotations

import os
from pathlib import Path

from stylegrid import config as sg_config


def test_resolve_user_data_dir_under_comfy_user(tmp_path):
    user = tmp_path / "comfy_user"
    user.mkdir()
    resolved = sg_config.resolve_user_data_dir(str(user))
    assert Path(resolved) == user / sg_config.USER_DATA_DIRNAME
    assert sg_config.USER_DATA_DIRNAME in resolved
    assert str(user) in resolved


def test_resolve_user_data_dir_fallback_without_folder_paths(monkeypatch):
    """When folder_paths is missing, resolve to legacy extension data/."""
    import builtins

    real_import = builtins.__import__

    def _blocked(name, *args, **kwargs):
        if name == "folder_paths" or name.startswith("folder_paths."):
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", _blocked)
    assert sg_config.resolve_user_data_dir(None) == sg_config.LEGACY_DATA_DIR


def test_migrate_copies_when_dest_empty(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    (legacy / "presets.json").write_text('{"a":{}}', encoding="utf-8")
    (legacy / "styles.csv").write_text("name,prompt\nX,y\n", encoding="utf-8")
    imports = legacy / "imports"
    imports.mkdir()
    (imports / "pack.csv").write_text("name,prompt\nY,z\n", encoding="utf-8")
    thumbs = legacy / "thumbnails"
    thumbs.mkdir()
    (thumbs / "abc.webp").write_bytes(b"webp-bytes")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is True

    assert (dest / "presets.json").read_text(encoding="utf-8") == '{"a":{}}'
    assert (dest / "styles.csv").is_file()
    assert (dest / "imports" / "pack.csv").is_file()
    assert (dest / "thumbnails" / "abc.webp").read_bytes() == b"webp-bytes"
    marker = dest / sg_config.MIGRATION_MARKER_NAME
    assert marker.is_file()
    marker_text = marker.read_text(encoding="utf-8")
    assert "copied_from=" in marker_text
    # Legacy untouched (copy, not move).
    assert (legacy / "presets.json").is_file()
    assert (legacy / "styles.csv").is_file()


def test_migrate_skips_when_dest_has_data(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    dest.mkdir()
    (legacy / "presets.json").write_text('{"legacy":{}}', encoding="utf-8")
    (dest / "presets.json").write_text('{"new":{}}', encoding="utf-8")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is False
    assert (dest / "presets.json").read_text(encoding="utf-8") == '{"new":{}}'
    assert not (dest / sg_config.MIGRATION_MARKER_NAME).exists()


def test_migrate_skips_when_same_path(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    (root / "presets.json").write_text("{}", encoding="utf-8")
    assert sg_config.migrate_legacy_user_data(str(root), str(root)) is False


def test_migrate_writes_marker_only_after_copy(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    (legacy / "usage.json").write_text('{"n":{}}', encoding="utf-8")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is True
    assert (dest / sg_config.MIGRATION_MARKER_NAME).is_file()
    # Second call is a no-op (marker present).
    (legacy / "extra.csv").write_text("name\nZ\n", encoding="utf-8")
    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is False
    assert not (dest / "extra.csv").exists()


def test_module_paths_use_resolver_constants():
    """Production constants are derived from DATA_DIR (single resolver)."""
    assert sg_config.IMPORTS_DIR == os.path.join(sg_config.DATA_DIR, "imports")
    assert sg_config.PRESETS_FILE == os.path.join(sg_config.DATA_DIR, "presets.json")
    assert sg_config.USAGE_FILE == os.path.join(sg_config.DATA_DIR, "usage.json")
    assert sg_config.CATEGORY_ORDER_FILE == os.path.join(
        sg_config.DATA_DIR, "category_order.json"
    )
    assert sg_config.BACKUP_DIR == os.path.join(sg_config.DATA_DIR, "backups")
    assert sg_config.THUMBNAILS_DIR == os.path.join(sg_config.DATA_DIR, "thumbnails")
    assert sg_config.SAMPLES_DIR == os.path.join(sg_config.EXT_DIR, "samples")
    assert sg_config.LEGACY_DATA_DIR == os.path.join(sg_config.EXT_DIR, "data")
