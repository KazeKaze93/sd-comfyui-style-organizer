"""{sg:...} picks follow the node's seed input, independent of the deck inputs."""

from __future__ import annotations

import importlib
import random

import pytest

from stylegrid.deck_limits import DECK_INDEX_MAX

POOL_SIZE = 50
SEEDS = range(20)
DECKS = [(0, 0), (7, 0), (0, 5_000), (123, DECK_INDEX_MAX), (0, DECK_INDEX_MAX + 500)]
TEXT = "{sg:body}, {sg:body}, {sg:body}"


def _style(name, prompt, negative):
    return {
        "name": name,
        "prompt": prompt,
        "negative_prompt": negative,
        "category": name.split("_", 1)[0],
        "source": "a.csv",
    }


STYLES = [_style(f"BODY_B{i}", f"body {i}", f"body neg {i}") for i in range(POOL_SIZE)] + [
    _style(f"HAIR_H{i}", f"hair {i}", f"hair neg {i}") for i in range(POOL_SIZE)
]
NEGATIVE_BY_PROMPT = {s["prompt"]: s["negative_prompt"] for s in STYLES}


@pytest.fixture
def node_module(monkeypatch):
    module = importlib.import_module("sd_comfyui_style_organizer.nodes.style_grid_node")
    monkeypatch.setattr(module, "get_cached_styles", lambda: [dict(s) for s in STYLES])
    return module


@pytest.fixture
def node(node_module):
    return node_module.StyleGridNode()


def test_seed_is_a_standard_seed_widget_and_the_last_input(node_module):
    optional = node_module.StyleGridNode.INPUT_TYPES()["optional"]
    assert list(optional) == ["deck_seed", "deck_index", "seed"]
    kind, options = optional["seed"]
    assert kind == "INT"
    assert options["control_after_generate"] is True
    assert (options["default"], options["min"], options["max"]) == (0, 0, 2**64 - 1)


@pytest.mark.parametrize("seed", [0, 1, 123_456_789, 2**64 - 1])
def test_same_seed_gives_same_picks(node, seed):
    first = node.apply(TEXT, "{sg:hair}", "", seed=seed)
    random.seed(seed + 1)
    assert node.apply(TEXT, "{sg:hair}", "", seed=seed) == first


def test_missing_seed_uses_the_default(node):
    assert node.apply(TEXT, "{sg:hair}", "") == node.apply(TEXT, "{sg:hair}", "", seed=0)


def test_different_seeds_give_different_picks(node):
    results = [node.apply(TEXT, "{sg:hair}", "", seed=seed) for seed in SEEDS]
    assert len({positive for positive, _ in results}) == len(SEEDS)
    assert len({negative for _, negative in results}) > 1


def test_sg_picks_ignore_the_deck_inputs(node):
    for seed in SEEDS:
        positives = [
            node.apply("{sg:body}, {sgd:hair}", "", "", deck_seed=deck_seed, deck_index=deck_index, seed=seed)[0]
            for deck_seed, deck_index in DECKS
        ]
        assert len({positive.split(", ")[0] for positive in positives}) == 1


def test_sg_does_not_freeze_past_the_last_deck_position(node):
    frozen_deck = {node.apply("{sgd:body}", "", "", deck_index=i)[0] for i in (DECK_INDEX_MAX, DECK_INDEX_MAX + 500)}
    assert len(frozen_deck) == 1
    picks = {node.apply(TEXT, "", "", deck_index=DECK_INDEX_MAX + 500, seed=seed)[0] for seed in SEEDS}
    assert len(picks) == len(SEEDS)


def test_paired_negative_follows_the_seeded_pick(node):
    for seed in SEEDS:
        positive, negative = node.apply("{sg:body}", "{sg:body}, lowres", "", seed=seed)
        assert negative == f"{NEGATIVE_BY_PROMPT[positive]}, lowres"
        positive, negative = node.apply("{sg:body}", "lowres", "", seed=seed)
        assert negative == f"lowres, {NEGATIVE_BY_PROMPT[positive]}"


def test_global_random_state_is_untouched(node):
    before = random.getstate()
    node.apply(TEXT, "{sg:hair}", "", seed=5)
    assert random.getstate() == before


def test_is_changed_follows_seed_without_forcing_reruns(node_module):
    is_changed = node_module.StyleGridNode.IS_CHANGED
    assert is_changed(TEXT, "", "", seed=1) == is_changed(TEXT, "", "", seed=1)
    assert is_changed(TEXT, "", "", seed=1) != is_changed(TEXT, "", "", seed=2)
