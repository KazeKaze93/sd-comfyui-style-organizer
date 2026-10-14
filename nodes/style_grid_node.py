import hashlib
import re

from ..stylegrid.cache import get_cached_styles
from ..stylegrid.csv_io import categorize_styles
from ..stylegrid.deck_limits import (
    DECK_INDEX_DEFAULT,
    DECK_INDEX_MAX,
    DECK_SEED_DEFAULT,
    DECK_SEED_MAX,
    clamp_deck_index,
    clamp_deck_seed,
)
from ..stylegrid.prompt_ops import build_styles_by_cat, resolve_and_pack
from ..stylegrid.wildcards import DeckContext

# Dice tokens re-roll on every queue; deck tokens are a pure function of the inputs.
_DICE_TOKEN = re.compile(r"\{sg:", re.IGNORECASE)


class StyleGridNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "negative_text": ("STRING", {"multiline": True, "default": ""}),
                "active_source": ("STRING", {"multiline": False, "default": ""}),
            },
            "optional": {
                "deck_seed": (
                    "INT",
                    {
                        "default": DECK_SEED_DEFAULT,
                        "min": 0,
                        "max": DECK_SEED_MAX,
                        "control_after_generate": "fixed",
                        "tooltip": "Shuffle wildcards {sgd:...}: which deck. Change it for a new shuffle order.",
                    },
                ),
                "deck_index": (
                    "INT",
                    {
                        "default": DECK_INDEX_DEFAULT,
                        "min": 0,
                        "max": DECK_INDEX_MAX,
                        "control_after_generate": "increment",
                        "tooltip": "Shuffle wildcards {sgd:...}: position in the deck. Keep on increment: "
                        "no repeats until every style in the category has been drawn.",
                    },
                ),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "apply"
    CATEGORY = "Style Grid"

    @classmethod
    def IS_CHANGED(
        cls,
        text,
        negative_text,
        active_source,
        deck_seed=DECK_SEED_DEFAULT,
        deck_index=DECK_INDEX_DEFAULT,
    ):
        """Force re-execution only when a dice wildcard needs re-rolling."""
        if _DICE_TOKEN.search(text) or _DICE_TOKEN.search(negative_text):
            return float("nan")
        payload = "\x00".join(
            [
                text,
                negative_text,
                active_source,
                str(clamp_deck_seed(deck_seed)),
                str(clamp_deck_index(deck_index)),
            ]
        )
        return hashlib.md5(payload.encode("utf-8")).hexdigest()

    def apply(
        self,
        text,
        negative_text,
        active_source,
        deck_seed=DECK_SEED_DEFAULT,
        deck_index=DECK_INDEX_DEFAULT,
    ):
        styles = list(get_cached_styles())
        categorize_styles(styles)
        by_cat = build_styles_by_cat(styles, active_source)
        # One queue run = one draw: every image of a latent batch shares this conditioning.
        deck = DeckContext(clamp_deck_seed(deck_seed), clamp_deck_index(deck_index))
        positive = resolve_and_pack(text, by_cat, deck=deck)
        negative = resolve_and_pack(negative_text, by_cat, field="negative_prompt", deck=deck)
        return (positive, negative)
