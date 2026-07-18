import json
import os
import random

from ..stylegrid.cache import get_cached_styles
from ..stylegrid.config import get_all_styles_file_paths, logger
from ..stylegrid.csv_io import categorize_styles
from ..stylegrid.data_files import increment_usage
from ..stylegrid.prompt_ops import build_styles_by_cat, merge_selected_styles, resolve_and_pack

ALL_SOURCES = "All Sources"


class StyleGridNode:
    @classmethod
    def INPUT_TYPES(cls):
        sources = [ALL_SOURCES] + [os.path.basename(p) for p in get_all_styles_file_paths()]
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "source": (sources, {"default": ALL_SOURCES}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": True}),
                "applied_styles": ("STRING", {"multiline": False, "default": "[]"}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "apply"
    CATEGORY = "Style Grid"

    def apply(self, text, source, seed, applied_styles):
        styles = list(get_cached_styles())
        categorize_styles(styles)
        active = "" if source == ALL_SOURCES else source
        by_cat = build_styles_by_cat(styles, active)
        positive = resolve_and_pack(text, by_cat, random.Random(seed))
        negative = ""

        try:
            style_names = json.loads(applied_styles) if applied_styles else []
        except json.JSONDecodeError:
            logger.warning("[Style Grid] applied_styles is not valid JSON, ignoring: %r", applied_styles)
            style_names = []

        if style_names:
            styles_by_name = {s["name"]: s for s in styles}
            positive, negative = merge_selected_styles(positive, negative, style_names, styles_by_name)
            increment_usage(style_names)

        return (positive, negative)
