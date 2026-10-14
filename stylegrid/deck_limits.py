"""Bounds for the node's hidden deck_seed / deck_index inputs."""

from __future__ import annotations

# The frontend stores widget values as JS numbers; integers above 2**53 - 1 lose precision.
JS_MAX_SAFE_INTEGER = 2**53 - 1

DECK_SEED_DEFAULT = 0
DECK_SEED_MAX = JS_MAX_SAFE_INTEGER

DECK_INDEX_DEFAULT = 0
# deck_position rebuilds the seam-fixed epoch chain, so cost grows linearly with the
# index (~0.05 s at 9_999 for a 2-card deck, ~5 s at 999_999). deck.py must stay
# byte-identical to WebUI, so the bound lives here. Change deck_seed for a fresh deck.
DECK_INDEX_MAX = 9_999


def _clamp(value: object, upper: int) -> int:
    return min(max(int(value), 0), upper)  # type: ignore[call-overload]


def clamp_deck_seed(value: object) -> int:
    return _clamp(value, DECK_SEED_MAX)


def clamp_deck_index(value: object) -> int:
    return _clamp(value, DECK_INDEX_MAX)
