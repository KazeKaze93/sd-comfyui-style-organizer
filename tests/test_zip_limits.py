"""Backup ZIP uncompressed-size and entry-count guards."""

from __future__ import annotations

import io
import zipfile

import pytest

from stylegrid.zip_limits import (
    MAX_BACKUP_ZIP_ENTRY_COUNT,
    MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES,
    BackupZipLimitError,
    validate_backup_zip_limits,
)


def _zip_with_entries(entries: list[tuple[str, bytes]]) -> zipfile.ZipFile:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
        for name, data in entries:
            zf.writestr(name, data)
    return zipfile.ZipFile(io.BytesIO(buf.getvalue()), "r")


def test_constants_are_positive():
    assert MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES == 100 * 1024 * 1024
    assert MAX_BACKUP_ZIP_ENTRY_COUNT == 500


def test_validate_accepts_small_zip():
    with _zip_with_entries(
        [
            ("data/styles.csv", b"name,prompt\nA,b\n"),
            ("presets.json", b"{}"),
        ]
    ) as zf:
        validate_backup_zip_limits(zf)  # does not raise


def test_reject_too_many_entries():
    entries = [(f"data/f{i}.csv", b"x") for i in range(MAX_BACKUP_ZIP_ENTRY_COUNT + 1)]
    with _zip_with_entries(entries) as zf:
        with pytest.raises(BackupZipLimitError, match="too many entries") as exc:
            validate_backup_zip_limits(zf)
    assert str(MAX_BACKUP_ZIP_ENTRY_COUNT) in str(exc.value)


def test_reject_oversize_uncompressed():
    # Cap lowered in-call so the suite does not allocate 100MiB.
    payload = b"a" * 64
    with _zip_with_entries([("data/big.csv", payload)]) as zf:
        with pytest.raises(BackupZipLimitError, match="uncompressed size") as exc:
            validate_backup_zip_limits(zf, max_uncompressed_bytes=32)
    assert "32" in str(exc.value)


def test_reject_sum_of_entries_over_limit():
    with _zip_with_entries(
        [
            ("data/a.csv", b"bbbbbbbb"),
            ("data/b.csv", b"cccccccc"),
        ]
    ) as zf:
        with pytest.raises(BackupZipLimitError, match="uncompressed size"):
            validate_backup_zip_limits(zf, max_uncompressed_bytes=10)


def test_reject_too_many_entries_custom_cap():
    with _zip_with_entries([("a.csv", b"hello"), ("b.csv", b"world")]) as zf:
        with pytest.raises(BackupZipLimitError, match="too many entries"):
            validate_backup_zip_limits(zf, max_entry_count=1)
