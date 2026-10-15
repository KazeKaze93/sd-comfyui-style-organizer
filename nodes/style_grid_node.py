import hashlib
import random

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
from ..stylegrid.prompt_ops import build_styles_by_cat, resolve_pair
from ..stylegrid.wildcards import DeckContext

SEED_DEFAULT = 0
SEED_MAX = 0xFFFFFFFFFFFFFFFF


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
                "style_negatives": (
                    "BOOLEAN",
                    {
                        "default": False,
                        "tooltip": "Add the negative prompt of each style picked by {sg:...} / {sgd:...} "
                        "in the positive text to the negative output.",
                    },
                ),
                # Must stay the last input: older workflows restore widget values by position.
                "seed": (
                    "INT",
                    {
                        "default": SEED_DEFAULT,
                        "min": 0,
                        "max": SEED_MAX,
                        "control_after_generate": True,
                        "tooltip": "Random wildcards {sg:...}: the same seed and text give the same picks.",
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
        style_negatives=False,
        seed=SEED_DEFAULT,
    ):
        payload = "\x00".join(
            [
                text,
                negative_text,
                active_source,
                str(clamp_deck_seed(deck_seed)),
                str(clamp_deck_index(deck_index)),
                str(style_negatives),
                str(seed),
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
        style_negatives=False,
        seed=SEED_DEFAULT,
    ):
        styles = list(get_cached_styles())
        categorize_styles(styles)
        by_cat = build_styles_by_cat(styles, active_source)
        # One queue run = one draw: every image of a latent batch shares this conditioning.
        deck = DeckContext(clamp_deck_seed(deck_seed), clamp_deck_index(deck_index))
        return resolve_pair(
            text, negative_text, by_cat, rng=random.Random(seed), deck=deck, style_negatives=style_negatives
        )
