# pip install pytest
"""Pytest bootstrap for this ComfyUI custom node.

Findings:
- ``stylegrid.config`` only uses ``logging`` + ``os`` (and creates ``data/`` dirs).
  It does **not** import ``folder_paths``, ``server``, or ``PromptServer``.
  No stubs are required for ``from stylegrid import ...``.
- The custom-node **root** ``__init__.py`` *does* import ``PromptServer`` and
  registers routes. Pytest treats that directory as a ``Package`` (it has
  ``__init__.py`` and contains ``tests/``), then ``Package.setup`` imports it.
  The directory name is hyphenated, so that import also fails with
  ``attempted relative import with no known parent package`` even if
  ``server``/``aiohttp`` are mocked.
- Fix: skip importing the custom-node entrypoint during ``Package.setup``.
  Do not stub ComfyUI modules — they are never loaded for these tests.
"""
import os
import sys
import types
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
_ROOT_STR = str(_ROOT)
if _ROOT_STR not in sys.path:
    sys.path.insert(0, _ROOT_STR)

import _pytest.python as _pytest_python

_orig_package_setup = _pytest_python.Package.setup


def _package_setup(self):
    if Path(self.path).resolve() == _ROOT:
        # Placeholder so pytest's package chain is satisfied without loading
        # the ComfyUI entrypoint (PromptServer / relative imports).
        name = "sd_comfyui_style_organizer"
        mod = types.ModuleType(name)
        mod.__file__ = str(_ROOT / "__init__.py")
        mod.__path__ = [_ROOT_STR]
        sys.modules[name] = mod
        self.obj = mod
        return
    return _orig_package_setup(self)


_pytest_python.Package.setup = _package_setup
