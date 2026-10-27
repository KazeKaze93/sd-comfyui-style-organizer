"""{sg:...} / {sgd:...} wildcard resolution in prompts."""

from __future__ import annotations

import random
import re
from collections.abc import Sequence
from dataclasses import dataclass

from .config import logger
from .deck import deck_position

TOKEN_SG = "sg"
TOKEN_SGD = "sgd"
_SG_TOKEN = re.compile(r"\{(sgd?):([^}]+)\}", re.IGNORECASE)
SPEC_ENTRY_SEPARATOR = ","
DECK_ID_SEPARATOR = "|"
_MAX_PASSES = 3


@dataclass(frozen=True)
class DeckContext:
    base_seed: int
    image_index: int


@dataclass(frozen=True)
class Pick:
    """A resolved token. ``key`` is (kind, category, normalized spec)."""

    key: tuple[str, str, str]
    style: dict


def parse_sg_token(inner):
    """Parse text between ``{sg:`` and ``}`` into ``(category, spec)``.

    Split on the first ``:`` only. Category is lowercased and stripped.
    Spec is the remainder stripped, or ``None`` when absent/empty.
    """
    left, sep, right = inner.partition(":")
    category = left.strip().lower()
    if not sep:
        return category, None
    spec = right.strip()
    return category, spec or None


def _full_name(category, suffix):
    return f"{category.upper()}_{suffix}"


def _name_matches(candidate_name, pattern, is_glob):
    name = (candidate_name or "").lower()
    pat = pattern.lower()
    if is_glob:
        return name.startswith(pat)
    return name == pat


def select_slice(candidates, category, spec):
    """Filter ``candidates`` by a comma-separated include/exclude/glob ``spec``.

    Names in the spec omit the category prefix; comparison uses
    ``category.upper() + "_" + suffix`` (case-insensitive).

    If any include entries exist, start from their union; otherwise start from
    all candidates. Then remove everything matched by exclude entries.
    """
    if not spec:
        return list(candidates)

    includes = []
    excludes = []
    for raw in spec.split(SPEC_ENTRY_SEPARATOR):
        entry = raw.strip()
        if not entry:
            continue
        is_exclude = entry.startswith("-")
        body = entry[1:].strip() if is_exclude else entry
        if not body:
            continue
        is_glob = body.endswith("*")
        suffix = body[:-1] if is_glob else body
        pattern = _full_name(category, suffix)
        bucket = excludes if is_exclude else includes
        bucket.append((pattern, is_glob))

    if includes:
        selected = []
        seen = set()
        for c in candidates:
            cname = c.get("name", "")
            for pattern, is_glob in includes:
                if _name_matches(cname, pattern, is_glob):
                    ident = id(c)
                    if ident not in seen:
                        seen.add(ident)
                        selected.append(c)
                    break
    else:
        selected = list(candidates)

    if not excludes:
        return selected

    result = []
    for c in selected:
        cname = c.get("name", "")
        if any(_name_matches(cname, pattern, is_glob) for pattern, is_glob in excludes):
            continue
        result.append(c)
    return result


def normalize_deck_spec(spec: str | None) -> str:
    if spec is None:
        return ""
    parts = [p.strip() for p in spec.lower().split(SPEC_ENTRY_SEPARATOR)]
    parts = [p for p in parts if p]
    parts.sort()
    return SPEC_ENTRY_SEPARATOR.join(parts)


def build_deck_pool(pool: Sequence[dict]) -> list[dict]:
    """Dedupe by (prompt, negative_prompt), keep first, then sort by that key."""
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for entry in pool:
        key = (entry.get("prompt") or "", entry.get("negative_prompt") or "")
        if key in seen:
            continue
        seen.add(key)
        unique.append(entry)
    unique.sort(key=lambda e: (e.get("prompt") or "", e.get("negative_prompt") or ""))
    return unique


def _count_sgd_occurrences(prompt: str) -> dict[tuple[str, str], int]:
    totals: dict[tuple[str, str], int] = {}
    for m in _SG_TOKEN.finditer(prompt):
        if m.group(1).lower() != TOKEN_SGD:
            continue
        category, spec = parse_sg_token(m.group(2))
        key = (category, normalize_deck_spec(spec))
        totals[key] = totals.get(key, 0) + 1
    return totals


def _field_value(style: dict, field: str) -> str:
    # Empty field is a successful resolve to nothing; do not keep the raw token.
    return style.get(field, "") or ""


def resolve_sg_wildcards(
    prompt,
    styles_by_category,
    rng=None,
    field="prompt",
    *,
    deck: DeckContext | None = None,
):
    """Replace ``{sg:CATEGORY}`` / ``{sgd:CATEGORY}`` tokens with a style's ``field``.

    field is "prompt" for positive-context resolution or "negative_prompt" for
    negative-context resolution: a wildcard always pulls the matching side of the
    picked style, never the positive prompt inside a negative field.
    rng is an optional random.Random for reproducible ``{sg:...}`` picks; falls back
    to the module RNG. ``{sgd:...}`` never touches any RNG: with ``deck`` set it draws
    without replacement via ``deck_position``; without ``deck`` it stays unresolved.
    Nested tokens resolve up to ``_MAX_PASSES`` (3); leftovers are stripped with a warning.

    Optional slice: ``{sg:CATEGORY:spec}`` / ``{sgd:CATEGORY:spec}`` where ``spec`` is a
    comma-separated include/exclude/glob list (see ``select_slice``). A spec applies only
    to its own token; nested tokens resolve by their own specs (or none), the outer
    slice is not inherited. Empty slices resolve to an empty string with a warning.
    Unknown or empty categories keep the raw token through nested passes, then strip
    with a warning. An empty style field resolves to an empty string (token is not kept).
    """
    return resolve_sg_picks(prompt, styles_by_category, rng, field, deck=deck)[0]


def resolve_sg_picks(
    prompt,
    styles_by_category,
    rng=None,
    field="prompt",
    *,
    deck: DeckContext | None = None,
    paired: Sequence[Pick] = (),
    warnings: list[str] | None = None,
) -> tuple[str, list[Pick]]:
    """``resolve_sg_wildcards`` that also returns the picked styles in token order.

    ``paired`` are picks made for the other field of the same run (the positive
    text, when resolving the negative): the k-th token with the same kind,
    category and spec reuses the k-th paired style instead of drawing again.
    Tokens without a paired style draw as usual.
    """

    def _warn(msg: str) -> None:
        if warnings is not None and msg not in warnings:
            warnings.append(msg)

    picker = rng or random
    queues: dict[tuple[str, str, str], list[dict]] = {}
    for pick in paired:
        queues.setdefault(pick.key, []).append(pick.style)
    seen: dict[tuple[str, str, str], int] = {}
    picks: list[Pick] = []
    text = prompt
    for _ in range(_MAX_PASSES):
        if not _SG_TOKEN.search(text):
            return text, picks
        sgd_totals = _count_sgd_occurrences(text)
        sgd_running: dict[tuple[str, str], int] = {}

        def replacer(m):
            kind = m.group(1).lower()
            category, spec = parse_sg_token(m.group(2))
            candidates = styles_by_category.get(category)
            if not candidates or (kind == TOKEN_SGD and deck is None):
                return m.group(0)
            pool = select_slice(candidates, category, spec) if spec else candidates
            if spec and not pool:
                msg = f"{m.group(0)} matches no styles; resolved to empty"
                _warn(msg)
                logger.warning("[Style Grid] %s", msg)
                return ""
            key = (kind, category, normalize_deck_spec(spec))
            if kind == TOKEN_SGD:
                deck_key = key[1:]
                k = sgd_running.get(deck_key, 0)
                sgd_running[deck_key] = k + 1

            n = seen.get(key, 0)
            seen[key] = n + 1
            queue = queues.get(key, [])
            if n < len(queue):
                style = queue[n]
            elif kind == TOKEN_SG:
                style = picker.choice(pool)
            else:
                deck_pool = build_deck_pool(pool)
                deck_id = f"{category}{DECK_ID_SEPARATOR}{key[2]}"
                counter = deck.image_index * sgd_totals[deck_key] + k
                style = deck_pool[deck_position(len(deck_pool), deck.base_seed, deck_id, counter)]
            picks.append(Pick(key, style))
            return _field_value(style, field)

        text = _SG_TOKEN.sub(replacer, text)
    if _SG_TOKEN.search(text):
        logger.warning(
            "[Style Grid] nested {sg:} unresolved after %d passes; stripping leftovers",
            _MAX_PASSES,
        )
        leftover_seen: list[str] = []
        for m in _SG_TOKEN.finditer(text):
            token = m.group(0)
            if token not in leftover_seen:
                leftover_seen.append(token)
                _warn(
                    f"{token} could not be resolved (unknown or empty category, or deck token without a deck); removed"
                )
        text = _SG_TOKEN.sub("", text)
    return text, picks
