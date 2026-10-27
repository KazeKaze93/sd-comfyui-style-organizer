"""Request body size caps (importable without aiohttp / ComfyUI)."""

from __future__ import annotations

JSON_BODY_MAX_BYTES = 2 * 1024 * 1024
THUMBNAIL_UPLOAD_BODY_MAX_BYTES = 16 * 1024 * 1024  # base64 of the 10 MB raw cap plus JSON envelope
IMPORT_BODY_MAX_BYTES = 50 * 1024 * 1024


class RequestBodyTooLarge(Exception):
    """Raised when a request body exceeds a declared byte cap."""

    def __init__(self, max_size: int, actual_size: int) -> None:
        self.max_size = max_size
        self.actual_size = actual_size
        super().__init__(
            f"request body too large ({actual_size} bytes; max {max_size})"
        )


async def read_body_capped(request, max_bytes: int) -> bytes:
    """Read the full request body, stopping once *max_bytes* is exceeded."""
    declared = getattr(request, "content_length", None)
    if declared is not None and declared > max_bytes:
        raise RequestBodyTooLarge(max_size=max_bytes, actual_size=declared)

    content = getattr(request, "content", None)
    iter_chunked = getattr(content, "iter_chunked", None) if content is not None else None
    if iter_chunked is None:
        # Test fakes and non-aiohttp callers may only expose request.read().
        raw = await request.read()
        if len(raw) > max_bytes:
            raise RequestBodyTooLarge(max_size=max_bytes, actual_size=len(raw))
        return raw

    buf = bytearray()
    async for chunk in iter_chunked(64 * 1024):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise RequestBodyTooLarge(max_size=max_bytes, actual_size=len(buf))
    return bytes(buf)
