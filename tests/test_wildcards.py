"""Tests for stylegrid.wildcards (parse/select + ComfyUI resolve behaviour)."""

import json
import logging
import random
from pathlib import Path

import pytest
from stylegrid.prompt_ops import resolve_pair
from stylegrid.wildcards import (
    _MAX_PASSES,
    DeckContext,
    parse_sg_token,
    resolve_sg_picks,
    resolve_sg_wildcards,
    select_slice,
)

_GOLDEN_PATH = Path(__file__).resolve().parent / "fixtures" / "sg_wildcard_golden.json"
_FIELD_BY_CASE = {"pos": "prompt", "neg": "negative_prompt"}


def _load_golden():
    with _GOLDEN_PATH.open(encoding="utf-8") as f:
        return json.load(f)


GOLDEN = _load_golden()


def _styles_from_names(names):
    return [
        {
            "name": n,
            "prompt": "p::" + n,
            "negative_prompt": "n::" + n,
        }
        for n in names
    ]


class _RecordingPicker:
    """rng stand-in that always returns seq[0] and records each pool."""

    def __init__(self):
        self.pools = []

    def choice(self, seq):
        self.pools.append(seq)
        return seq[0]


# --- parse_sg_token ---------------------------------------------------------


def test_parse_sg_token_plain_category_returns_no_spec():
    assert parse_sg_token("body") == ("body", None)


def test_parse_sg_token_splits_on_first_colon_and_lowercases_category():
    assert parse_sg_token("BODY:Tanned,Shortstack") == ("body", "Tanned,Shortstack")


def test_parse_sg_token_spec_may_contain_a_colon():
    assert parse_sg_token("body:Tanned:extra") == ("body", "Tanned:extra")


# --- select_slice -----------------------------------------------------------


def test_select_slice_include_list_selects_named_styles():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Shortstack", "BODY_Pale"])
    result = select_slice(candidates, "body", "Tanned,Shortstack")
    assert [s["name"] for s in result] == ["BODY_Tanned", "BODY_Shortstack"]


def test_select_slice_exclude_entries_subtract_from_full_category():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Shortstack", "BODY_Pale"])
    result = select_slice(candidates, "body", "-Tanned")
    assert [s["name"] for s in result] == ["BODY_Shortstack", "BODY_Pale"]


def test_select_slice_glob_include_selects_every_name_under_root():
    candidates = _styles_from_names(["BODY_Male_A", "BODY_Male_BBC", "BODY_Female_A"])
    result = select_slice(candidates, "body", "Male_*")
    assert [s["name"] for s in result] == ["BODY_Male_A", "BODY_Male_BBC"]


def test_select_slice_glob_exclude_removes_every_name_under_root():
    candidates = _styles_from_names(["BODY_Male_A", "BODY_Male_BBC", "BODY_Female_A"])
    result = select_slice(candidates, "body", "-Male_*")
    assert [s["name"] for s in result] == ["BODY_Female_A"]


def test_select_slice_include_and_exclude_combined():
    candidates = _styles_from_names(
        ["BODY_Male_A", "BODY_Male_BBC", "BODY_Male_B", "BODY_Female_A"]
    )
    result = select_slice(candidates, "body", "Male_*,-Male_BBC")
    assert [s["name"] for s in result] == ["BODY_Male_A", "BODY_Male_B"]


def test_select_slice_matches_names_case_insensitively_without_category_prefix():
    candidates = _styles_from_names(["BODY_Tanned"])
    result = select_slice(candidates, "body", "tanned")
    assert [s["name"] for s in result] == ["BODY_Tanned"]


def test_select_slice_unknown_name_matches_nothing_and_does_not_raise():
    candidates = _styles_from_names(["BODY_Tanned"])
    result = select_slice(candidates, "body", "NoSuchStyle")
    assert result == []


# --- ComfyUI-specific resolve behaviour -------------------------------------


def test_resolve_field_negative_prompt_pulls_negative_side():
    styles_by = {
        "body": [
            {
                "name": "BODY_A",
                "prompt": "positive_text",
                "negative_prompt": "negative_text",
            }
        ]
    }
    result = resolve_sg_wildcards(
        "{sg:body}", styles_by, rng=_RecordingPicker(), field="negative_prompt"
    )
    assert result == "negative_text"


def test_injected_rng_produces_identical_picks_across_same_seed():
    styles_by = {"body": _styles_from_names(["BODY_A", "BODY_B", "BODY_C"])}
    a = resolve_sg_wildcards("{sg:body}", styles_by, rng=random.Random(42))
    b = resolve_sg_wildcards("{sg:body}", styles_by, rng=random.Random(42))
    assert a == b


def test_nested_sg_token_resolves_without_inheriting_outer_slice():
    """Outer slice must not constrain a nested {sg:other} pick's pool."""
    styles_by = {
        "body": [
            {
                "name": "BODY_Sliced",
                "prompt": "wrap {sg:accessory}",
                "negative_prompt": "",
            },
            {
                "name": "BODY_Other",
                "prompt": "unused",
                "negative_prompt": "",
            },
        ],
        "accessory": _styles_from_names(["ACCESSORY_X", "ACCESSORY_Y", "ACCESSORY_Z"]),
    }
    picker = _RecordingPicker()
    result = resolve_sg_wildcards("{sg:body:Sliced}", styles_by, rng=picker)

    assert len(picker.pools) == 2
    assert [s["name"] for s in picker.pools[0]] == ["BODY_Sliced"]
    # Nested token has no spec — pool is the full accessory category.
    assert [s["name"] for s in picker.pools[1]] == [
        "ACCESSORY_X",
        "ACCESSORY_Y",
        "ACCESSORY_Z",
    ]
    assert result == "wrap p::ACCESSORY_X"


def test_stale_slice_resolves_empty_with_warning():
    """Every name in the spec absent → empty string + warning; picker never called."""
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Pale"])
    styles_by = {"body": candidates}
    picker = _RecordingPicker()
    warnings: list[str] = []
    result, _ = resolve_sg_picks(
        "{sg:body:Ghost,Missing}", styles_by, rng=picker, warnings=warnings
    )

    assert result == ""
    assert picker.pools == []
    assert warnings == ["{sg:body:Ghost,Missing} matches no styles; resolved to empty"]


def test_sgd_empty_slice_resolves_empty_with_warning():
    styles_by = {"body": _styles_from_names(["BODY_Tanned", "BODY_Pale"])}
    warnings: list[str] = []
    result, _ = resolve_sg_picks(
        "{sgd:body:Missing}",
        styles_by,
        deck=DeckContext(1, 0),
        warnings=warnings,
    )
    assert result == ""
    assert warnings == ["{sgd:body:Missing} matches no styles; resolved to empty"]


def test_unknown_category_strips_raw_token_after_max_passes_with_warning(caplog):
    styles_by = {"animal": _styles_from_names(["ANIMAL_X"])}
    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        result = resolve_sg_wildcards("{sg:missing}", styles_by, rng=_RecordingPicker())

    assert result == ""
    assert any(
        "nested {sg:} unresolved after" in rec.message and "stripping leftovers" in rec.message
        for rec in caplog.records
    )


def test_unknown_category_warning_deduped_when_token_repeats():
    styles_by = {"animal": _styles_from_names(["ANIMAL_X"])}
    warnings: list[str] = []
    result, _ = resolve_sg_picks(
        "{sg:nope}{sg:nope}", styles_by, rng=_RecordingPicker(), warnings=warnings
    )
    assert result == ""
    assert warnings == [
        "{sg:nope} could not be resolved (unknown or empty category, or deck token without a deck); removed"
    ]


def test_resolve_pair_forwards_warnings_from_both_sides():
    styles_by = {
        "body": _styles_from_names(["BODY_Tanned"]),
        "hair": _styles_from_names(["HAIR_Red"]),
    }
    warnings: list[str] = []
    positive, negative = resolve_pair(
        "{sg:body:Ghost}",
        "{sg:nope}",
        styles_by,
        deck=DeckContext(0, 0),
        warnings=warnings,
    )
    assert positive == ""
    assert negative == ""
    assert warnings == [
        "{sg:body:Ghost} matches no styles; resolved to empty",
        "{sg:nope} could not be resolved (unknown or empty category, or deck token without a deck); removed",
    ]


# --- Golden fixture (R3 resolver contract) ----------------------------------


def test_max_passes_is_three():
    assert _MAX_PASSES == 3


def test_sg_wildcard_golden_fixture_is_well_formed():
    assert GOLDEN["cases"]
    required = {
        "id",
        "input",
        "field",
        "styles_fixture",
        "seed",
        "expected_output",
        "expected_warnings",
    }
    ids = []
    for case in GOLDEN["cases"]:
        assert required <= set(case)
        assert case["field"] in _FIELD_BY_CASE
        assert isinstance(case["styles_fixture"], dict)
        assert isinstance(case["seed"], int)
        assert isinstance(case["expected_output"], str)
        assert isinstance(case["expected_warnings"], list)
        ids.append(case["id"])
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "case",
    GOLDEN["cases"],
    ids=[case["id"] for case in GOLDEN["cases"]],
)
def test_sg_wildcard_golden_case(case, caplog):
    field = _FIELD_BY_CASE[case["field"]]
    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        result = resolve_sg_wildcards(
            case["input"],
            case["styles_fixture"],
            rng=random.Random(case["seed"]),
            field=field,
        )
    assert result == case["expected_output"]
    warnings = [rec.getMessage() for rec in caplog.records if rec.name == "StyleGrid"]
    assert warnings == case["expected_warnings"]
