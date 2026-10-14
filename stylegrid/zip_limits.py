"""Limits for backup / import ZIP archives (zip-bomb guards)."""

from __future__ import annotations

import zipfile

# Caps apply to declared ZipInfo sizes before any member is fully extracted.
MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024  # 100 MiB total
MAX_BACKUP_ZIP_ENTRY_COUNT = 500


class BackupZipLimitError(ValueError):
    """Raised when a ZIP exceeds uncompressed size or entry-count limits."""


def validate_backup_zip_limits(
    zf: zipfile.ZipFile,
    *,
    max_uncompressed_bytes: int = MAX_BACKUP_ZIP_UNCOMPRESSED_BYTES,
    max_entry_count: int = MAX_BACKUP_ZIP_ENTRY_COUNT,
) -> None:
    """Reject archives with too many entries or too much declared uncompressed size.

    Raises ``BackupZipLimitError`` with a clear message for the HTTP layer.
    """
    infos = zf.infolist()
    entry_count = len(infos)
    if entry_count > max_entry_count:
        raise BackupZipLimitError(
            f"ZIP has too many entries ({entry_count}; max {max_entry_count})"
        )

    total_uncompressed = 0
    for info in infos:
        size = info.file_size
        if size < 0:
            raise BackupZipLimitError("ZIP entry declares a negative uncompressed size")
        total_uncompressed += size
        if total_uncompressed > max_uncompressed_bytes:
            raise BackupZipLimitError(
                f"ZIP uncompressed size exceeds limit "
                f"({total_uncompressed} bytes; max {max_uncompressed_bytes})"
            )
