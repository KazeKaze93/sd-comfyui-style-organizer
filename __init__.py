from .nodes.style_grid_node import StyleGridNode

NODE_CLASS_MAPPINGS = {
    "StyleGridNode": StyleGridNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StyleGridNode": "Style Grid",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
