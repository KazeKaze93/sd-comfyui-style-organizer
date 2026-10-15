"""Placeholders bring the picked style's negative prompt along (resolve_pair + node)."""

from __future__ import annotations

import importlib
import logging
import random

import pytest

from stylegrid.prompt_ops import build_styles_by_cat, drop_shared_tags, resolve_pair
from stylegrid.wildcards import DeckContext, resolve_sg_picks

RUNS = range(40)
DECK = DeckContext(0, 0)


def _style(name, prompt, negative, source="a.csv"):
    return {
        "name": name,
        "prompt": prompt,
        "negative_prompt": negative,
        "category": name.split("_", 1)[0],
        "source": source,
    }


BODY = [
    _style("BODY_Tanned", "tanned skin", "pale skin"),
    _style("BODY_Pale", "pale skin", "tanned skin"),
    _style("BODY_Tall", "tall", "short"),
]
POSE = [_style("POSE_Lean", "leaning forward", "standing straight")]
HAIR = [
    _style("HAIR_Red", "red hair", "blue hair"),
    _style("HAIR_Long", "long hair", "short hair"),
    _style("HAIR_Bald", "bald", "hair"),
]
NEGATIVE_BY_PROMPT = {s["prompt"]: s["negative_prompt"] for s in BODY + HAIR + POSE}


def _by_cat(styles):
    return build_styles_by_cat(styles)


def test_positive_only_placeholder_fills_empty_negative():
    assert resolve_pair("1girl, {sg:body:Tanned}", "", _by_cat(BODY), deck=DECK) == (
        "1girl, tanned skin",
        "pale skin",
    )


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_positive_only_sg_or_sgd_fills_empty_negative(kind):
    for i in RUNS:
        positive, negative = resolve_pair(f"{{{kind}:body}}", "", _by_cat(BODY), deck=DeckContext(i, i))
        assert negative == NEGATIVE_BY_PROMPT[positive]
        assert negative


def test_negative_order_user_text_then_styles_in_placeholder_order():
    _, negative = resolve_pair("{sg:pose}, {sg:body:Tanned}", "lowres", _by_cat(BODY + POSE), deck=DECK)
    assert negative == "lowres, standing straight, pale skin"


def test_nested_placeholder_negative_is_added():
    styles = [_style("OUTFIT_Set", "dress, {sg:pose}", "pants")] + POSE
    assert resolve_pair("{sg:outfit}", "", _by_cat(styles), deck=DECK) == (
        "dress, leaning forward",
        "pants, standing straight",
    )


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_negative_placeholder_pairs_with_positive_pick(kind):
    for i in RUNS:
        positive, negative = resolve_pair(
            f"{{{kind}:body}}", f"{{{kind}:body}}, lowres", _by_cat(BODY), deck=DeckContext(i, i)
        )
        assert negative == f"{NEGATIVE_BY_PROMPT[positive]}, lowres"


def test_pairing_holds_when_token_layout_differs():
    # Negatives are tags that never appear in any positive, so drop_shared_tags cannot hide pairing.
    styles = [
        _style("HAIR_A", "red hair", "neg-hair-a"),
        _style("HAIR_B", "blue hair", "neg-hair-b"),
        _style("BODY_A", "tanned skin", "neg-body-a"),
        _style("BODY_B", "pale skin", "neg-body-b"),
        _style("BODY_C", "tall", "neg-body-c"),
    ]
    by_cat = _by_cat(styles)
    for i in RUNS:
        _, negative = resolve_pair(
            "{sg:hair}, {sg:body}, {sgd:body}",
            "{sgd:body}, {sg:body}",
            by_cat,
            rng=random.Random(i),
            deck=DeckContext(i, i),
        )
        _, picks = resolve_sg_picks(
            "{sg:hair}, {sg:body}, {sgd:body}", by_cat, random.Random(i), deck=DeckContext(i, i)
        )
        # Negative-field tokens resolve first (paired), then appended style negatives in pick order.
        assert negative == ", ".join(
            dict.fromkeys(
                [
                    picks[2].style["negative_prompt"],
                    picks[1].style["negative_prompt"],
                    picks[0].style["negative_prompt"],
                ]
            )
        )


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_paired_placeholder_and_style_negative_collapse(kind):
    for i in RUNS:
        positive, negative = resolve_pair(
            f"{{{kind}:body}}", f"{{{kind}:body}}", _by_cat(BODY), deck=DeckContext(i, i)
        )
        assert negative == NEGATIVE_BY_PROMPT[positive]


def test_all_sources_ambiguous_name_uses_negative_of_the_picked_source():
    styles = [
        _style("BODY_Tanned", "tanned skin, pack a", "neg-a", source="a.csv"),
        _style("BODY_Tanned", "tanned skin, pack b", "neg-b", source="b.csv"),
    ]
    seen = set()
    for i in RUNS:
        positive, negative = resolve_pair("{sg:body:Tanned}", "", _by_cat(styles), deck=DeckContext(i, i))
        seen.add(positive)
        assert negative == {"tanned skin, pack a": "neg-a", "tanned skin, pack b": "neg-b"}[positive]
    assert len(seen) == 2


def test_negative_tag_already_in_positive_is_dropped_and_logged(caplog):
    styles = [
        _style("SKIN_Tan", "tanned skin, (freckles:1.2)", "pale skin"),
        _style("DETAIL_Clean", "smooth skin", "Freckles, blurry"),
    ]
    with caplog.at_level(logging.INFO, logger="StyleGrid"):
        _, negative = resolve_pair("{sg:skin}, {sg:detail}", "lowres, smooth skin", _by_cat(styles), deck=DECK)

    assert negative == "lowres, pale skin, blurry"
    dropped = [rec.getMessage() for rec in caplog.records if "dropped from negative" in rec.getMessage()]
    assert dropped == ["[Style Grid] dropped from negative, also in positive: smooth skin, Freckles"]


def test_text_without_placeholders_is_not_filtered():
    assert resolve_pair("red hair", "red hair", _by_cat(BODY), deck=DECK) == ("red hair", "red hair")


def test_resolve_sg_picks_reuses_paired_picks_then_draws():
    styles = {"cat": [{"name": f"CAT_{i}", "prompt": f"p{i}", "negative_prompt": f"n{i}"} for i in range(4)]}
    _, picks = resolve_sg_picks("{sgd:cat}", styles, deck=DECK)
    assert [pick.key for pick in picks] == [("sgd", "cat", "")]

    negative, _ = resolve_sg_picks("{sgd:cat} {SGD:cat}", styles, field="negative_prompt", deck=DECK, paired=picks)
    first, second = negative.split()
    assert first == picks[0].style["negative_prompt"]
    assert second != first


def test_drop_shared_tags_uses_dedup_identity():
    kept, dropped = drop_shared_tags(
        "Blurry, (pale skin:0.8), BREAK, <lora:x:1>, lowres", "blurry, pale skin, break, <LORA:x:1>"
    )
    assert kept == "BREAK, lowres"
    assert dropped == ["Blurry", "(pale skin:0.8)", "<lora:x:1>"]


@pytest.fixture
def node_module(monkeypatch):
    module = importlib.import_module("sd_comfyui_style_organizer.nodes.style_grid_node")
    monkeypatch.setattr(module, "get_cached_styles", lambda: [dict(s) for s in BODY[:1]])
    return module


def test_node_has_no_style_negatives_input(node_module):
    optional = node_module.StyleGridNode.INPUT_TYPES()["optional"]
    assert "style_negatives" not in optional
    assert list(optional) == ["deck_seed", "deck_index", "seed"]


def test_node_apply_always_adds_style_negatives(node_module):
    node = node_module.StyleGridNode
    assert node().apply("{sgd:body}", "lowres", "") == ("tanned skin", "lowres, pale skin")
    assert node.IS_CHANGED("{sgd:body}", "", "", seed=1) != node.IS_CHANGED("{sgd:body}", "", "", seed=2)
