"""Prompt resolution: wildcard expansion, tag dedup, source scoping."""

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
    """Group styles by lowercased category. When active_source (a basename) is given,
    only styles from that pack are included; an unknown source falls back to all styles.
    """
    if active_source:
        pool = [s for s in styles if (s.get("source") or "") == active_source]
        if not pool:
            pool = styles
    else:
        pool = styles
    by_cat = {}
    for s in pool:
        key = (s.get("category") or "").lower()
        by_cat.setdefault(key, []).append(s)
    return by_cat


def resolve_and_pack(prompt_str, styles_by_cat, rng=None):
    """Expand {sg:...} wildcards from the given category map, then dedup tags."""
    return dedup_prompt(resolve_sg_wildcards(prompt_str, styles_by_cat, rng))
