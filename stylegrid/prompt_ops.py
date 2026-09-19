"""Prompt resolution: wildcard expansion, tag dedup, source scoping."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

from .wildcards import resolve_sg_wildcards

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
        key = seg.lower() if parsed is None else parsed[0].lower()
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


def resolve_and_pack(prompt_str, styles_by_cat, rng=None, field="prompt"):
    """Expand {sg:...} wildcards from the given category map, then dedup tags. field
    selects which side of a picked style a wildcard pulls from (see resolve_sg_wildcards).
    """
    return dedup_prompt(resolve_sg_wildcards(prompt_str, styles_by_cat, rng, field))
