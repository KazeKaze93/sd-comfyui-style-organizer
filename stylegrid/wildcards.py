"""{sg:...} wildcard resolution in prompts."""

import random
import re

from .config import logger

_SG_TOKEN = re.compile(r"\{sg:([^}]+)\}", re.IGNORECASE)
_MAX_PASSES = 3


def parse_sg_token(inner):
    """Parse text between ``{sg:`` and ``}`` into ``(category, spec)``.

    Split on the first ``:`` only. Category is lowercased and stripped.
    Spec is the remainder stripped, or ``None`` when absent/empty.
    """
    left, sep, right = inner.partition(":")
    category = left.strip().lower()
    if not sep:
        return category, None
    spec = right.strip()
    return category, spec or None


def _full_name(category, suffix):
    return f"{category.upper()}_{suffix}"


def _name_matches(candidate_name, pattern, is_glob):
    name = (candidate_name or "").lower()
    pat = pattern.lower()
    if is_glob:
        return name.startswith(pat)
    return name == pat


def select_slice(candidates, category, spec):
    """Filter ``candidates`` by a comma-separated include/exclude/glob ``spec``.

    Names in the spec omit the category prefix; comparison uses
    ``category.upper() + "_" + suffix`` (case-insensitive).

    If any include entries exist, start from their union; otherwise start from
    all candidates. Then remove everything matched by exclude entries.
    """
    if not spec:
        return list(candidates)

    includes = []
    excludes = []
    for raw in spec.split(","):
        entry = raw.strip()
        if not entry:
            continue
        is_exclude = entry.startswith("-")
        body = entry[1:].strip() if is_exclude else entry
        if not body:
            continue
        is_glob = body.endswith("*")
        suffix = body[:-1] if is_glob else body
        pattern = _full_name(category, suffix)
        bucket = excludes if is_exclude else includes
        bucket.append((pattern, is_glob))

    if includes:
        selected = []
        seen = set()
        for c in candidates:
            cname = c.get("name", "")
            for pattern, is_glob in includes:
                if _name_matches(cname, pattern, is_glob):
                    ident = id(c)
                    if ident not in seen:
                        seen.add(ident)
                        selected.append(c)
                    break
    else:
        selected = list(candidates)

    if not excludes:
        return selected

    result = []
    for c in selected:
        cname = c.get("name", "")
        if any(_name_matches(cname, pattern, is_glob) for pattern, is_glob in excludes):
            continue
        result.append(c)
    return result


def resolve_sg_wildcards(prompt, styles_by_category, rng=None, field="prompt"):
    """Replace `{sg:CATEGORY}` tokens with a style's `field` value picked from that
    category map. field is "prompt" for positive-context resolution or "negative_prompt"
    for negative-context resolution — a wildcard always pulls the matching side of the
    picked style, never the positive prompt inside a negative field.
    rng is an optional random.Random for reproducible picks; falls back to the module RNG.
    Nested tokens resolve up to _MAX_PASSES; leftovers are stripped.

    Optional slice: ``{sg:CATEGORY:spec}`` where ``spec`` is a comma-separated
    include/exclude/glob list (see ``select_slice``). A spec applies only to its own
    token — nested ``{sg:...}`` tokens resolve by their own specs (or none); the outer
    slice is not inherited. Empty slices fall back to the full category. Unknown
    categories leave the raw token unchanged.
    """
    picker = rng or random

    def replacer(m):
        category, spec = parse_sg_token(m.group(1))
        candidates = styles_by_category.get(category)
        if not candidates:
            return m.group(0)
        pool = select_slice(candidates, category, spec) if spec else candidates
        if not pool:
            pool = candidates
        style = picker.choice(pool)
        # Empty field is a successful resolve to nothing — do not keep the raw token.
        return style.get(field, "") or ""

    text = prompt
    for _ in range(_MAX_PASSES):
        if not _SG_TOKEN.search(text):
            return text
        text = _SG_TOKEN.sub(replacer, text)
    if _SG_TOKEN.search(text):
        logger.warning(
            "[Style Grid] nested {sg:} unresolved after %d passes; stripping leftovers",
            _MAX_PASSES,
        )
        text = _SG_TOKEN.sub("", text)
    return text
