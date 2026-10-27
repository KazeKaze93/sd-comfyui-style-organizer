"""Unit tests for capped request-body reads (no aiohttp / ComfyUI required)."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest
from stylegrid.http_limits import (
    IMPORT_BODY_MAX_BYTES,
    JSON_BODY_MAX_BYTES,
    THUMBNAIL_UPLOAD_BODY_MAX_BYTES,
    RequestBodyTooLarge,
    read_body_capped,
)


class _FakeContent:
    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks

    def iter_chunked(self, _size: int) -> AsyncIterator[bytes]:
        async def _gen() -> AsyncIterator[bytes]:
            for chunk in self._chunks:
                yield chunk

        return _gen()


class _FakeRequest:
    def __init__(self, chunks: list[bytes], content_length: int | None) -> None:
        self.content_length = content_length
        self.content = _FakeContent(chunks)


async def _read_json_via_helper(request, max_bytes: int = JSON_BODY_MAX_BYTES):
    """Mirror routes._read_json empty/invalid -> {} without importing aiohttp."""
    import json

    try:
        raw = await read_body_capped(request, max_bytes)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}


def test_body_cap_constants():
    assert JSON_BODY_MAX_BYTES == 2 * 1024 * 1024
    assert THUMBNAIL_UPLOAD_BODY_MAX_BYTES == 16 * 1024 * 1024
    assert IMPORT_BODY_MAX_BYTES == 50 * 1024 * 1024


def test_read_body_capped_under_cap_returns_bytes():
    req = _FakeRequest([b"hello", b" world"], content_length=11)

    async def _run():
        return await read_body_capped(req, max_bytes=100)

    assert asyncio.run(_run()) == b"hello world"


def test_read_body_capped_declared_over_cap_raises_without_iterating():
    class _BoomContent:
        def iter_chunked(self, _size: int):
            raise AssertionError("iter_chunked must not run when Content-Length is over cap")

    req = _FakeRequest([], content_length=None)
    req.content_length = 50
    req.content = _BoomContent()

    async def _run():
        with pytest.raises(RequestBodyTooLarge) as exc:
            await read_body_capped(req, max_bytes=10)
        assert exc.value.max_size == 10
        assert exc.value.actual_size == 50

    asyncio.run(_run())


def test_read_body_capped_stream_over_cap_raises_after_crossing():
    req = _FakeRequest([b"abcd", b"efgh", b"ijkl"], content_length=None)

    async def _run():
        with pytest.raises(RequestBodyTooLarge) as exc:
            await read_body_capped(req, max_bytes=6)
        assert exc.value.max_size == 6
        assert exc.value.actual_size == 8

    asyncio.run(_run())


def test_read_json_empty_body_returns_empty_object():
    req = _FakeRequest([], content_length=0)

    async def _run():
        return await _read_json_via_helper(req)

    assert asyncio.run(_run()) == {}


def test_read_json_invalid_json_returns_empty_object():
    req = _FakeRequest([b"not-json"], content_length=8)

    async def _run():
        return await _read_json_via_helper(req)

    assert asyncio.run(_run()) == {}
