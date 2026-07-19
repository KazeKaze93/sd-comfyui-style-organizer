"""{sg:...} wildcard resolution in prompts."""

import random
import re


def resolve_sg_wildcards(prompt, styles_by_category, rng=None, field="prompt"):
    """Replace `{sg:CATEGORY}` tokens with a style's `field` value picked from that
    category map. field is "prompt" for positive-context resolution or "negative_prompt"
    for negative-context resolution — a wildcard always pulls the matching side of the
    picked style, never the positive prompt inside a negative field.
    rng is an optional random.Random for reproducible picks; falls back to the module RNG.
    """
    picker = rng or random

    def replacer(m):
        token = m.group(1).strip().lower()
        candidates = styles_by_category.get(token)
        if not candidates:
            return m.group(0)
        style = picker.choice(candidates)
        return style.get(field, "") or m.group(0)

    return re.sub(r"\{sg:([^}]+)\}", replacer, prompt)
