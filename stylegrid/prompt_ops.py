"""Prompt resolution: wildcard expansion, tag dedup, source scoping."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from .config import logger
from .wildcards import DeckContext, resolve_sg_picks

BREAK_TOKEN = "BREAK"
NEUTRAL_WEIGHT = 1.0
_EXPLICIT_WEIGHT = re.compile(r"^\((?P<tag>[^():]+):(?P<weight>\d+(?:\.\d+)?)\)$")
_BRACKET_PAIRS: tuple[tuple[str, str], ...] = (("(", ")"), ("[", "]"), ("<", ">"), ("{", "}"))
_SYNTAX_CHARS = "()[]<>{}:"


@dataclass
class _Slot:
    text: str
    tag: str | None
    weight: float


def _is_balanced(segment: str) -> bool:
    return all(segment.count(o) == segment.count(c) for o, c in _BRACKET_PAIRS)


def _parse(segment: str) -> tuple[str, float] | None:
    """Return (tag_text, weight) for a bare tag or (tag:w). None means opaque."""
    if not _is_balanced(segment):
        return None
    match = _EXPLICIT_WEIGHT.match(segment)
    if match:
        return match.group("tag").strip(), float(match.group("weight"))
    if any(ch in segment for ch in _SYNTAX_CHARS):
        return None
    return segment, NEUTRAL_WEIGHT


def _tag_key(segment: str, parsed: tuple[str, float] | None) -> str:
    return segment.lower() if parsed is None else parsed[0].lower()


def drop_shared_tags(prompt: str, other: str) -> tuple[str, list[str]]:
    """Remove tags of ``prompt`` that also occur in ``other``.

    Tag identity is the one ``dedup_prompt`` uses. BREAK is always kept.
    Returns the kept prompt and the dropped segments.
    """
    other_keys = set()
    for raw in other.split(","):
        seg = raw.strip()
        if seg:
            other_keys.add(_tag_key(seg, _parse(seg)))
    kept: list[str] = []
    dropped: list[str] = []
    for raw in prompt.split(","):
        seg = raw.strip()
        if not seg:
            continue
        if seg.upper() != BREAK_TOKEN and _tag_key(seg, _parse(seg)) in other_keys:
            dropped.append(seg)
        else:
            kept.append(seg)
    return ", ".join(kept), dropped


def dedup_prompt(prompt: str) -> str:
    """Collapse duplicate comma-separated tags.

    Identity: bare `tag` and `(tag:w)` share one case-insensitive key.
    Position: the first occurrence keeps its place and original text.
    Weight: if all occurrences are >= neutral, the highest weight wins and the
    first slot is re-rendered as (tag:w). If any occurrence is a de-emphasis
    (< neutral), the first occurrence wins unchanged: down-weighting is
    deliberate and max() would silently undo it.
    Opaque segments (LoRA, nested emphasis, unbalanced groups) dedup by exact
    case-insensitive text only. BREAK is always kept.
    """
    slots: list[_Slot] = []
    index: dict[str, int] = {}
    for raw in prompt.split(","):
        seg = raw.strip()
        if not seg:
            continue
        if seg.upper() == BREAK_TOKEN:
            slots.append(_Slot(seg, None, NEUTRAL_WEIGHT))
            continue
        parsed = _parse(seg)
        key = _tag_key(seg, parsed)
        if key not in index:
            index[key] = len(slots)
            tag, weight = (None, NEUTRAL_WEIGHT) if parsed is None else parsed
            slots.append(_Slot(seg, tag, weight))
            continue
        kept = slots[index[key]]
        if parsed is None or kept.tag is None:
            continue
        new_weight = parsed[1]
        if min(kept.weight, new_weight) < NEUTRAL_WEIGHT or new_weight <= kept.weight:
            continue
        kept.weight = new_weight
        kept.text = f"({kept.tag}:{new_weight:g})"
    return ", ".join(slot.text for slot in slots)


def build_styles_by_cat(styles, active_source=""):
    """Group styles by lowercased category. When active_source is set, only styles
    whose basename source matches are included (UI may pass an abs path). No silent
    fallback to the full library when the filter matches nothing.
    """
    normalized_source = os.path.basename(active_source) if active_source else None
    if normalized_source:
        pool = [s for s in styles if (s.get("source") or "") == normalized_source]
    else:
        pool = styles
    by_cat = {}
    for s in pool:
        key = (s.get("category") or "").lower()
        by_cat.setdefault(key, []).append(s)
    return by_cat


def resolve_and_pack(
    prompt_str,
    styles_by_cat,
    rng=None,
    field="prompt",
    *,
    deck: DeckContext | None = None,
    paired=(),
):
    """Expand {sg:...} / {sgd:...} wildcards from the given category map, then dedup
    tags. field selects which side of a picked style a wildcard pulls from; deck enables
    {sgd:...} draws; paired reuses picks of the other field (see resolve_sg_picks).
    """
    return dedup_prompt(resolve_sg_picks(prompt_str, styles_by_cat, rng, field, deck=deck, paired=paired)[0])


def resolve_pair(text, negative_text, styles_by_cat, *, rng=None, deck: DeckContext, style_negatives=True):
    """Resolve the node's positive and negative text; returns (positive, negative).

    rng draws the {sg:...} picks of the positive, then of negative tokens without a positive pick.
    Negative tokens reuse the positive picks. With style_negatives, every style picked in
    the positive also adds its negative_prompt after negative_text, in token order, and
    negative tags that also occur in the expanded positive are dropped.
    """
    resolved, picks = resolve_sg_picks(text, styles_by_cat, rng, deck=deck)
    positive = dedup_prompt(resolved)
    if style_negatives:
        parts = [negative_text, *(pick.style.get("negative_prompt") or "" for pick in picks)]
        negative_text = ", ".join(part for part in parts if part)
    negative = resolve_and_pack(negative_text, styles_by_cat, rng, field="negative_prompt", deck=deck, paired=picks)
    if style_negatives and picks:
        negative, dropped = drop_shared_tags(negative, positive)
        if dropped:
            logger.info("[Style Grid] dropped from negative, also in positive: %s", ", ".join(dropped))
    return positive, negative
