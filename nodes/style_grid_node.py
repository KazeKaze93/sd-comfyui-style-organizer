import hashlib
import re

from ..stylegrid.cache import get_cached_styles
from ..stylegrid.csv_io import categorize_styles
from ..stylegrid.prompt_ops import build_styles_by_cat, resolve_and_pack
from ..stylegrid.wildcards import DeckContext

# Dice tokens re-roll on every queue; deck tokens are a pure function of the inputs.
_DICE_TOKEN = re.compile(r"\{sg:", re.IGNORECASE)
DECK_SEED_DEFAULT = 0
DECK_SEED_MAX = 0xFFFFFFFFFFFFFFFF
DECK_INDEX_DEFAULT = 0
# deck_position rebuilds the seam-fixed epoch chain, so cost grows linearly with the
# index (~0.05 s at 9_999 for a 2-card deck, ~5 s at 999_999). deck.py must stay
# byte-identical to WebUI, so the bound lives here. Change deck_seed for a fresh deck.
DECK_INDEX_MAX = 9_999


def _clamp_deck_index(value) -> int:
    return min(max(int(value), 0), DECK_INDEX_MAX)


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
            [text, negative_text, active_source, str(deck_seed), str(_clamp_deck_index(deck_index))]
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
        deck = DeckContext(int(deck_seed), _clamp_deck_index(deck_index))
        positive = resolve_and_pack(text, by_cat, deck=deck)
        negative = resolve_and_pack(negative_text, by_cat, field="negative_prompt", deck=deck)
        return (positive, negative)
