"""Bounds for the Style Grid node's deck_seed / deck_index inputs."""

from __future__ import annotations

from stylegrid.deck_limits import (
    DECK_INDEX_MAX,
    DECK_SEED_MAX,
    JS_MAX_SAFE_INTEGER,
    clamp_deck_index,
    clamp_deck_seed,
)


def test_seed_max_is_js_safe() -> None:
    assert DECK_SEED_MAX == 2**53 - 1
    assert DECK_SEED_MAX == JS_MAX_SAFE_INTEGER


def test_clamps_below_zero_and_above_max() -> None:
    assert clamp_deck_seed(-5) == 0
    assert clamp_deck_seed(2**64) == DECK_SEED_MAX
    assert clamp_deck_index(-1) == 0
    assert clamp_deck_index(10**9) == DECK_INDEX_MAX


def test_clamps_keep_in_range_values() -> None:
    assert clamp_deck_seed(123) == 123
    assert clamp_deck_index(42) == 42


def test_accepts_numeric_strings_and_floats() -> None:
    assert clamp_deck_index("7") == 7
    assert clamp_deck_index(7.0) == 7
