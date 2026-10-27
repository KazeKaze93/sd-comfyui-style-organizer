"""Parity: stylegrid.prompt_ops._tag_key vs tests/fixtures/tag_identity.json."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from stylegrid.prompt_ops import _parse, _tag_key

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "tag_identity.json"


def _load_fixture() -> dict:
    with _FIXTURE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


FIXTURE = _load_fixture()


@pytest.mark.parametrize(
    "segment,key",
    [(case["segment"], case["key"]) for case in FIXTURE["cases"]],
    ids=[case["segment"] for case in FIXTURE["cases"]],
)
def test_tag_key_matches_fixture(segment: str, key: str) -> None:
    assert _tag_key(segment, _parse(segment)) == key


def test_tag_identity_fixture_is_well_formed() -> None:
    assert FIXTURE["cases"]
    for case in FIXTURE["cases"]:
        assert isinstance(case["segment"], str)
        assert isinstance(case["key"], str)
