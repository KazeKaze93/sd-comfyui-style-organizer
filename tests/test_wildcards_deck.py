"""Deck-mode {sgd:...} resolution and dice {sg:...} isolation (ported from WebUI)."""

from __future__ import annotations

import random
from copy import deepcopy

from stylegrid.prompt_ops import resolve_and_pack
from stylegrid.wildcards import DeckContext, build_deck_pool, normalize_deck_spec, resolve_sg_wildcards


def _cat_styles(n: int = 6) -> list[dict]:
    return [
        {
            "name": f"CAT_S{i}",
            "prompt": f"prompt-{i}",
            "negative_prompt": f"neg-{i}",
            "source_file": "/pack/a.csv",
        }
        for i in range(n)
    ]


def test_dice_isolation_from_sgd_and_global_rng_untouched():
    styles = {
        "a": [
            {"name": "A_1", "prompt": "a1", "negative_prompt": "", "source_file": "/a.csv"},
            {"name": "A_2", "prompt": "a2", "negative_prompt": "", "source_file": "/a.csv"},
        ],
        "b": [
            {"name": "B_1", "prompt": "b1", "negative_prompt": "", "source_file": "/b.csv"},
            {"name": "B_2", "prompt": "b2", "negative_prompt": "", "source_file": "/b.csv"},
        ],
    }
    random.seed(7)
    mixed = resolve_sg_wildcards("{sg:a} {sgd:b} {sg:a}", styles, deck=DeckContext(99, 0))
    random.seed(7)
    dice_only = resolve_sg_wildcards("{sg:a} {sg:a}", styles)
    mixed_parts = mixed.split()
    dice_parts = dice_only.split()
    assert mixed_parts[0] == dice_parts[0]
    assert mixed_parts[2] == dice_parts[1]

    before = random.getstate()
    resolve_sg_wildcards("{sgd:b} {sgd:b}", styles, deck=DeckContext(1, 0))
    assert random.getstate() == before


def test_nested_sgd_without_deck_strips_after_max_passes():
    """Injected `{sgd:…}` without a deck stays unresolved, then is stripped."""
    styles = {
        "a": [
            {
                "name": "A_NEST",
                "prompt": "{sgd:b}",
                "negative_prompt": "",
                "source_file": "/a.csv",
            }
        ],
        "b": [
            {
                "name": "B_NEST",
                "prompt": "leaf",
                "negative_prompt": "",
                "source_file": "/b.csv",
            }
        ],
    }
    random.seed(1)
    dice_out = resolve_sg_wildcards("{sg:a}", styles)
    assert dice_out == ""

    deck_out = resolve_sg_wildcards("{sgd:b}", styles, deck=DeckContext(5, 0))
    assert deck_out == "leaf"


def test_no_repeats_within_epoch():
    styles = {"cat": _cat_styles(6)}
    deck_base = 42
    epoch0 = [
        resolve_sg_wildcards("{sgd:cat}", styles, deck=DeckContext(deck_base, i))
        for i in range(6)
    ]
    epoch1 = [
        resolve_sg_wildcards("{sgd:cat}", styles, deck=DeckContext(deck_base, i))
        for i in range(6, 12)
    ]
    assert len(set(epoch0)) == 6
    assert len(set(epoch1)) == 6


def test_two_occurrences_in_one_prompt():
    styles = {"cat": _cat_styles(6)}
    seen: list[str] = []
    for i in range(3):
        out = resolve_sg_wildcards(
            "{sgd:cat} {sgd:cat}", styles, deck=DeckContext(77, i)
        )
        left, right = out.split(" ", 1)
        assert left != right
        seen.extend([left, right])
    assert len(set(seen)) == 6


def test_build_deck_pool_dedupes_identical_content():
    pool = [
        {
            "name": "CAT_A",
            "prompt": "same",
            "negative_prompt": "neg",
            "source_file": "/pack1.csv",
        },
        {
            "name": "CAT_A",
            "prompt": "same",
            "negative_prompt": "neg",
            "source_file": "/pack2.csv",
        },
        {
            "name": "CAT_B",
            "prompt": "same",
            "negative_prompt": "neg",
            "source_file": "/pack1.csv",
        },
        {
            "name": "CAT_C",
            "prompt": "other",
            "negative_prompt": "neg2",
            "source_file": "/pack1.csv",
        },
    ]
    built = build_deck_pool(pool)
    assert len(built) == 2
    assert [e["prompt"] for e in built] == ["other", "same"]


def test_candidate_order_does_not_affect_deck_draws():
    base = _cat_styles(5)
    shuffled = deepcopy(base)
    random.Random(0).shuffle(shuffled)
    styles_a = {"cat": base}
    styles_b = {"cat": shuffled}
    for i in range(10):
        a = resolve_sg_wildcards("{sgd:cat}", styles_a, deck=DeckContext(123, i))
        b = resolve_sg_wildcards("{sgd:cat}", styles_b, deck=DeckContext(123, i))
        assert a == b


def test_positive_and_negative_pair_to_same_style():
    styles = {"cat": _cat_styles(4)}
    for i in range(8):
        pos = resolve_sg_wildcards(
            "{sgd:cat}", styles, field="prompt", deck=DeckContext(9, i)
        )
        neg = resolve_sg_wildcards(
            "{sgd:cat}", styles, field="negative_prompt", deck=DeckContext(9, i)
        )
        idx = int(pos.split("-")[1])
        assert neg == f"neg-{idx}"


def test_deck_fallbacks():
    styles = {"cat": _cat_styles(3)}
    # No deck / unknown category: keep raw through passes, then strip.
    assert resolve_sg_wildcards("{sgd:cat}", styles, deck=None) == ""
    assert resolve_sg_wildcards("{sgd:missing}", styles, deck=DeckContext(1, 0)) == ""
    out = resolve_sg_wildcards(
        "{sgd:cat:Ghost,Missing}", styles, deck=DeckContext(1, 0)
    )
    assert out in {s["prompt"] for s in styles["cat"]}
    assert "{sgd:" not in out


def test_spec_normalization_order_independent():
    styles = {
        "body": [
            {
                "name": "BODY_Male_A",
                "prompt": "male a",
                "negative_prompt": "",
                "source_file": "/b.csv",
            },
            {
                "name": "BODY_Male_BBC",
                "prompt": "male bbc",
                "negative_prompt": "",
                "source_file": "/b.csv",
            },
            {
                "name": "BODY_Female_A",
                "prompt": "female a",
                "negative_prompt": "",
                "source_file": "/b.csv",
            },
        ]
    }
    assert normalize_deck_spec("Male_*,-Male_BBC") == normalize_deck_spec(
        "-male_bbc, male_*"
    )
    a = resolve_sg_wildcards(
        "{sgd:body:Male_*,-Male_BBC}", styles, deck=DeckContext(3, 0)
    )
    b = resolve_sg_wildcards(
        "{sgd:body:-male_bbc, male_*}", styles, deck=DeckContext(3, 0)
    )
    assert a == b
    assert a == "male a"


def test_resolved_output_has_no_leftover_tokens():
    styles = {"cat": _cat_styles(3), "a": _cat_styles(2)}
    out = resolve_sg_wildcards(
        "{sgd:cat} and {sg:a}",
        styles,
        deck=DeckContext(11, 0),
    )
    assert "{sgd:" not in out
    assert "{sg:" not in out


def test_sgd_token_is_case_insensitive_like_sg():
    styles = {"cat": _cat_styles(4)}
    lower = resolve_sg_wildcards("{sgd:cat}", styles, deck=DeckContext(5, 2))
    upper = resolve_sg_wildcards("{SGD:Cat}", styles, deck=DeckContext(5, 2))
    assert lower == upper
    assert "{" not in upper


def test_resolve_and_pack_forwards_deck():
    styles = {"cat": _cat_styles(4)}
    direct = resolve_sg_wildcards("{sgd:cat}", styles, deck=DeckContext(8, 3))
    packed = resolve_and_pack("{sgd:cat}", styles, deck=DeckContext(8, 3))
    assert packed == direct
