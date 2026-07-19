import hashlib

from ..stylegrid.cache import get_cached_styles
from ..stylegrid.csv_io import categorize_styles
from ..stylegrid.prompt_ops import build_styles_by_cat, resolve_and_pack


class StyleGridNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "negative_text": ("STRING", {"multiline": True, "default": ""}),
                "active_source": ("STRING", {"multiline": False, "default": ""}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "apply"
    CATEGORY = "Style Grid"

    @classmethod
    def IS_CHANGED(cls, text, negative_text, active_source):
        """Force re-execution only when a wildcard needs re-rolling."""
        if "{sg:" in text or "{sg:" in negative_text:
            return float("nan")
        payload = "\x00".join([text, negative_text, active_source])
        return hashlib.md5(payload.encode("utf-8")).hexdigest()

    def apply(self, text, negative_text, active_source):
        styles = list(get_cached_styles())
        categorize_styles(styles)
        by_cat = build_styles_by_cat(styles, active_source)
        positive = resolve_and_pack(text, by_cat)
        negative = resolve_and_pack(negative_text, by_cat, field="negative_prompt")
        return (positive, negative)
