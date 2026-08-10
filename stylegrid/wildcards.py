"""{sg:...} wildcard resolution in prompts."""

import random
import re

from .config import logger

_SG_TOKEN = re.compile(r"\{sg:([^}]+)\}", re.IGNORECASE)
_MAX_PASSES = 3


def resolve_sg_wildcards(prompt, styles_by_category, rng=None, field="prompt"):
    """Replace `{sg:CATEGORY}` tokens with a style's `field` value picked from that
    category map. field is "prompt" for positive-context resolution or "negative_prompt"
    for negative-context resolution — a wildcard always pulls the matching side of the
    picked style, never the positive prompt inside a negative field.
    rng is an optional random.Random for reproducible picks; falls back to the module RNG.
    Nested tokens resolve up to _MAX_PASSES; leftovers are stripped.
    """
    picker = rng or random

    def replacer(m):
        token = m.group(1).strip().lower()
        candidates = styles_by_category.get(token)
        if not candidates:
            return m.group(0)
        style = picker.choice(candidates)
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
