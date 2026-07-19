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


def resolve_and_pack(prompt_str, styles_by_cat, rng=None, field="prompt"):
    """Expand {sg:...} wildcards from the given category map, then dedup tags. field
    selects which side of a picked style a wildcard pulls from (see resolve_sg_wildcards).
    """
    return dedup_prompt(resolve_sg_wildcards(prompt_str, styles_by_cat, rng, field))


def _merge_tags(base, additions):
    """Case-fold tag dedup against additions, first occurrence wins. Plain lowercase
    comparison only — not weight-aware, matches the original process() tag merge.
    """
    current_tags = [t.strip() for t in base.split(",") if t.strip()]
    seen = {t.lower() for t in current_tags}
    result = list(current_tags)
    for t in additions:
        if t.lower() not in seen:
            result.append(t)
            seen.add(t.lower())
    return ", ".join(result)


def merge_selected_styles(positive, negative, style_names, styles_by_name):
    """Layer explicitly selected styles onto already-resolved positive/negative text.

    A style's prompt/negative_prompt containing {prompt} wraps the existing text
    immediately, in selection order. Styles without a placeholder are collected and
    merged in afterward as new tags via _merge_tags.
    """
    prompts_add = []
    neg_add = []
    for name in style_names:
        s = styles_by_name.get(name)
        if not s:
            continue
        p = s.get("prompt") or ""
        if p:
            if "{prompt}" in p:
                positive = p.replace("{prompt}", positive)
            else:
                prompts_add.append(p)
        n = s.get("negative_prompt") or ""
        if n:
            if "{prompt}" in n:
                negative = n.replace("{prompt}", negative)
            else:
                neg_add.append(n)

    if prompts_add:
        style_tags = [t.strip() for grp in prompts_add for t in grp.split(",") if t.strip()]
        positive = _merge_tags(positive, style_tags)
    if neg_add:
        style_tags = [t.strip() for grp in neg_add for t in grp.split(",") if t.strip()]
        negative = _merge_tags(negative, style_tags)
    return positive, negative
