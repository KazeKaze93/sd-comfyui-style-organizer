import os

from ..stylegrid.cache import get_cached_styles
from ..stylegrid.config import get_all_styles_file_paths
from ..stylegrid.csv_io import categorize_styles
from ..stylegrid.prompt_ops import build_styles_by_cat, resolve_and_pack

ALL_SOURCES = "All Sources"


class StyleGridNode:
    @classmethod
    def INPUT_TYPES(cls):
        sources = [ALL_SOURCES] + [os.path.basename(p) for p in get_all_styles_file_paths()]
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "source": (sources, {"default": ALL_SOURCES}),
            }
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("positive", "negative")
    FUNCTION = "apply"
    CATEGORY = "Style Grid"

    def apply(self, text, source):
        styles = list(get_cached_styles())
        categorize_styles(styles)
        active = "" if source == ALL_SOURCES else source
        by_cat = build_styles_by_cat(styles, active)
        positive = resolve_and_pack(text, by_cat)
        return (positive, "")
