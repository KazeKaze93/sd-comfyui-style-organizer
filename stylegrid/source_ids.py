"""Stable relative source ids for style CSV packs (no aiohttp)."""

from __future__ import annotations

import os

from . import config

ID_PREFIXES: tuple[str, ...] = ("data", "imports", "samples")

_FORBIDDEN_LEAF_CHARS = frozenset({"/", "\\", ":", "\x00"})


def _roots() -> dict[str, str]:
    """Prefix -> abs root. Read config attrs at call time for monkeypatching."""
    return {
        "data": config.DATA_DIR,
        "imports": config.IMPORTS_DIR,
        "samples": config.SAMPLES_DIR,
    }


def _leaf_ok(leaf: str) -> bool:
    if not leaf or leaf in (".", ".."):
        return False
    if any(ch in leaf for ch in _FORBIDDEN_LEAF_CHARS):
        return False
    if not leaf.lower().endswith(".csv"):
        return False
    return True


def is_source_id(value: str) -> bool:
    """True when value looks like ``<prefix>/<leaf.csv>`` with a known prefix."""
    if not isinstance(value, str) or not value:
        return False
    if "/" not in value:
        return False
    prefix, leaf = value.split("/", 1)
    if prefix not in ID_PREFIXES:
        return False
    return _leaf_ok(leaf)


def to_source_id(path: str) -> str | None:
    """Map an absolute filesystem path to a public source id, or None."""
    if not path or not isinstance(path, str):
        return None
    abs_path = os.path.normpath(os.path.abspath(path))
    if not abs_path.lower().endswith(".csv"):
        return None
    base = os.path.basename(abs_path)
    parent = os.path.dirname(abs_path)
    parent_key = os.path.normcase(parent)
    for prefix, root in _roots().items():
        if os.path.normcase(os.path.normpath(os.path.abspath(root))) == parent_key:
            return f"{prefix}/{base}"
    return None


def resolve_source_id(source_id: str) -> str | None:
    """Map a public source id to an abs path under the matching root, or None.

    Existence is not required (save may create a new data/ file).
    """
    if not is_source_id(source_id):
        return None
    prefix, leaf = source_id.split("/", 1)
    root = _roots()[prefix]
    root_abs = os.path.normpath(os.path.abspath(root))
    joined = os.path.normpath(os.path.join(root_abs, leaf))
    if os.path.normcase(os.path.dirname(joined)) != os.path.normcase(root_abs):
        return None
    return joined


def coerce_source_ref(value: str) -> str | None:
    """Resolve a client or internal source ref to an abs path under a known root.

    Empty -> None. Source ids and absolute paths that map into a root are accepted.
    Bare basenames are left to callers (returns None here).
    """
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip()
    if is_source_id(raw):
        return resolve_source_id(raw)
    if os.path.isabs(raw):
        sid = to_source_id(raw)
        if sid is None:
            return None
        return resolve_source_id(sid)
    return None


def is_samples_ref(value: str) -> bool:
    """True when value coerces to a path under SAMPLES_DIR."""
    resolved = coerce_source_ref(value)
    if resolved is None:
        return False
    return os.path.normcase(os.path.dirname(resolved)) == os.path.normcase(
        os.path.normpath(os.path.abspath(config.SAMPLES_DIR))
    )
