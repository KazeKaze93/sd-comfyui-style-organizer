"""Prompt resolution: wildcard expansion, tag dedup, source scoping."""

import os
import re

from .wildcards import resolve_sg_wildcards

_WEIGHTED = re.compile(r"^\((.+?):\d+\.?\d*\)$")


def dedup_prompt(prompt_str):
    """Remove duplicate comma-separated tags, first occurrence wins.
    Weighted (tag:1.3) and bare tag share one identity via normalized key.
    BREAK is preserved and never deduplicated.
    """
    out = []
    seen = set()
    for seg in prompt_str.split(","):
        s = seg.strip()
        if not s:
            continue
        if s.upper() == "BREAK":
            out.append(s)
            continue
        m = _WEIGHTED.match(s)
        key = m.group(1).strip().lower() if m else s.lower()
        if key not in seen:
            seen.add(key)
            out.append(s)
    return ", ".join(out)


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
