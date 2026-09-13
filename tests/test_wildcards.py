"""Tests for stylegrid.wildcards (parse/select + ComfyUI resolve behaviour)."""

import logging
import random

from stylegrid.wildcards import parse_sg_token, resolve_sg_wildcards, select_slice


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


def test_stale_slice_falls_back_to_full_category():
    """Every name in the spec absent → fall back to the FULL category.

    This matters more here than in the WebUI sibling: after ``_MAX_PASSES``,
    leftover ``{sg:}`` tokens are stripped with a warning. Without the
    empty-slice fallback a stale include list would leave an unresolved token
    that then vanishes silently instead of degrading to a normal category pick.
    """
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Pale"])
    styles_by = {"body": candidates}
    picker = _RecordingPicker()
    result = resolve_sg_wildcards("{sg:body:Ghost,Missing}", styles_by, rng=picker)

    assert picker.pools[0] is candidates
    assert result == "p::BODY_Tanned"


def test_unknown_category_strips_raw_token_after_max_passes_with_warning(caplog):
    styles_by = {"animal": _styles_from_names(["ANIMAL_X"])}
    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        result = resolve_sg_wildcards("{sg:missing}", styles_by, rng=_RecordingPicker())

    assert result == ""
    assert any(
        "nested {sg:} unresolved after" in rec.message and "stripping leftovers" in rec.message
        for rec in caplog.records
    )
