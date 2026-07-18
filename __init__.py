from server import PromptServer

from .nodes.style_grid_node import StyleGridNode
from .stylegrid.routes import register_api

NODE_CLASS_MAPPINGS = {
    "StyleGridNode": StyleGridNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "StyleGridNode": "Style Grid",
}

WEB_DIRECTORY = "./web"

register_api(PromptServer.instance.routes)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
