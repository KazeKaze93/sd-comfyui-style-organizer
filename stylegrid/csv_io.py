"""CSV parsing, categorization, and style CRUD (read + write path)."""

import csv
import io
import os

from .cache import invalidate_styles_cache
from .config import (
    DATA_DIR,
    IMPORTS_DIR,
    SAMPLES_DIR,
    get_all_styles_file_paths,
    logger,
)
from .safe_persistence import locked_path, write_atomic
from .source_ids import coerce_source_ref, is_source_id, to_source_id

FIELDNAMES = ["name", "prompt", "negative_prompt", "description", "category"]

# Count-only debug when the same style name appears in more than one CSV pack.
CROSS_FILE_NAME_OVERLAP_MSG = (
    "[Style Grid] %d style name(s) appear in more than one file"
)


def _write_csv_atomic(target_path, header, rows):
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerow(header)
    for row in rows:
        writer.writerow(row)
    write_atomic(target_path, buf.getvalue().encode("utf-8-sig"))


_LEGACY_FORMULA_CHARS = ("=", "+", "-", "@", "\t", "\r")


def _sanitize_csv_cell(value):
    """Identity on write — do not prepend apostrophes (breaks names like -_- / +_+)."""
    return value


def _unsanitize_legacy_csv_cell(value):
    """In-memory migration: strip a leading ' that older builds prepended before =+-@."""
    if (
        isinstance(value, str)
        and len(value) >= 2
        and value[0] == "'"
        and value[1] in _LEGACY_FORMULA_CHARS
    ):
        return value[1:]
    return value


def parse_styles_csv(filepath):
    """
    Parse one styles CSV as UTF-8/UTF-8-BOM into normalized style dicts.

    Keys: name, prompt, negative_prompt, description, category_explicit,
    source (basename), source_file (stable relative id). Malformed rows are skipped
    and logged; they never abort the rest of the file.

    Legacy apostrophe-escaped formula prefixes are stripped in memory only;
    this function never writes the file.
    """
    styles = []
    if not os.path.isfile(filepath):
        return styles
    base = os.path.basename(filepath)
    source_id = to_source_id(filepath)
    if source_id is None:
        logger.warning(
            "[Style Grid] skip CSV outside known roots (no source id): %s",
            base,
        )
        return styles
    try:
        f = open(filepath, "r", encoding="utf-8-sig")
    except OSError as e:
        logger.warning("[Style Grid] cannot open %s: %s", base, e)
        return styles
    with f:
        reader = csv.reader(f)
        header = None
        for row in reader:
            try:
                if not row or all(c.strip() == "" for c in row):
                    continue
                if header is None and row[0].strip().lower() == "name":
                    header = row
                    continue
                if header is None:
                    header = ["name", "prompt", "negative_prompt"]
                name = _unsanitize_legacy_csv_cell(
                    row[0].strip() if len(row) > 0 else ""
                )
                if not name:
                    continue
                styles.append({
                    "name": name,
                    "prompt": _unsanitize_legacy_csv_cell(
                        row[1].strip() if len(row) > 1 else ""
                    ),
                    "negative_prompt": _unsanitize_legacy_csv_cell(
                        row[2].strip() if len(row) > 2 else ""
                    ),
                    "description": _unsanitize_legacy_csv_cell(
                        row[3].strip() if len(row) > 3 else ""
                    ),
                    "category_explicit": _unsanitize_legacy_csv_cell(
                        row[4].strip() if len(row) > 4 else ""
                    ),
                    "source": base,
                    "source_file": source_id,
                    "read_only": os.path.normcase(
                        os.path.dirname(os.path.abspath(filepath))
                    ) == os.path.normcase(os.path.abspath(SAMPLES_DIR)),
                })
            except (IndexError, AttributeError):
                logger.warning("[Style Grid] %s:%d skipped malformed row", base, reader.line_num)
                continue
    return styles


def load_all_styles():
    """Merge CSVs from data/ and samples/. Uniqueness key is (source_file, name)."""
    all_styles = []
    seen_keys = set()
    name_owner = {}
    multi_file_names = set()
    for filepath in get_all_styles_file_paths():
        for s in parse_styles_csv(filepath):
            key = (s["source_file"], s["name"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            prior = name_owner.get(s["name"])
            if prior and prior != s["source"]:
                multi_file_names.add(s["name"])
            else:
                name_owner[s["name"]] = s["source"]
            all_styles.append(s)
    if multi_file_names:
        logger.debug(CROSS_FILE_NAME_OVERLAP_MSG, len(multi_file_names))
    return all_styles


def _category_from_filename(source):
    if not source or not isinstance(source, str):
        return ""
    base = os.path.splitext(source.strip())[0].strip()
    if not base:
        return ""
    return base[0].upper() + base[1:]


def enrich_style(s: dict) -> dict:
    """Return a shallow copy with category, display_name, and has_placeholder set."""
    out = dict(s)
    name = out["name"]
    source = out.get("source") or ""
    explicit_cat = (out.get("category_explicit") or "").strip()
    if explicit_cat:
        cat = explicit_cat
        display = name.split("_", 1)[1].replace("_", " ") if "_" in name else name
    elif "_" in name:
        before, rest = name.split("_", 1)
        cat = before.upper()
        display = rest.replace("_", " ")
    elif "-" in name:
        before, rest = name.split("-", 1)
        cat = before
        display = rest.replace("-", " ")
    else:
        cat = _category_from_filename(source) or "OTHER"
        display = name.replace("_", " ")
    out["category"] = cat
    out["display_name"] = display
    out["has_placeholder"] = "{prompt}" in (out.get("prompt") or "") or "{prompt}" in (
        out.get("negative_prompt") or ""
    )
    return out


def categorize_styles(styles):
    categories = {}
    for s in styles:
        row = enrich_style(s)
        categories.setdefault(row["category"], []).append(row)
    for cat in categories:
        categories[cat].sort(key=lambda x: (x.get("display_name") or x["name"] or "").lower())
    return categories


def _resolve_write_target(source_file):
    """Resolve a CSV path for writes under DATA_DIR or IMPORTS_DIR.

    Source ids and absolute paths go through coerce_source_ref (samples -> None).
    Bare basenames keep the legacy first-match-under-data/imports behavior.
    Returns None when the ref is refused (samples, unmappable abs/id, bad shape).
    """
    raw = ""
    if isinstance(source_file, str):
        raw = source_file.strip()

    if raw and (is_source_id(raw) or os.path.isabs(raw)):
        resolved = coerce_source_ref(raw)
        if resolved is None:
            return None
        samples_abs = os.path.normcase(os.path.abspath(SAMPLES_DIR))
        if os.path.normcase(os.path.dirname(resolved)) == samples_abs:
            return None
        return resolved

    if raw and ("/" in raw or "\\" in raw):
        return None

    if raw:
        basename = os.path.basename(raw)
        if not basename.lower().endswith(".csv"):
            basename += ".csv"
    else:
        basename = "styles.csv"

    data_abs = os.path.normcase(os.path.abspath(DATA_DIR))
    imports_abs = os.path.normcase(os.path.abspath(IMPORTS_DIR))
    for fp in get_all_styles_file_paths():
        parent = os.path.normcase(os.path.dirname(os.path.abspath(fp)))
        if parent in (data_abs, imports_abs) and os.path.basename(fp) == basename:
            return fp
    return os.path.join(DATA_DIR, basename)


def save_style_to_csv(name, prompt, negative_prompt, description="", source_file=None, category=None):
    """Upsert a style row in a data/ CSV: replace the first matching name row, or append."""
    target_path = _resolve_write_target(source_file)
    if not target_path:
        return False
    with locked_path(target_path):
        rows = []
        header = None
        if os.path.isfile(target_path):
            with open(target_path, "r", encoding="utf-8-sig") as f:
                reader = csv.reader(f)
                for row in reader:
                    if header is None and row and row[0].strip().lower() == "name":
                        header = row
                        continue
                    rows.append(row)
        if not header:
            header = FIELDNAMES

        def make_row(existing_row=None):
            existing_cat = existing_row[4].strip() if (existing_row and len(existing_row) > 4) else ""
            if category is None:
                cat_cell = existing_cat
            else:
                cat_cell = str(category).strip()
                cat_cell = _sanitize_csv_cell(cat_cell) if cat_cell else ""
            base = [name, prompt, negative_prompt, description, cat_cell]
            extra = list(existing_row[5:]) if existing_row and len(existing_row) > 5 else []
            while len(base) + len(extra) < len(header):
                extra.append("")
            return base + extra

        # Match plain name, or legacy apostrophe-escaped name from older builds.
        legacy_name = "'" + name if name and name[0] in _LEGACY_FORMULA_CHARS else name
        found = False
        for i, row in enumerate(rows):
            if not row:
                continue
            cell = row[0].strip()
            if cell == name or cell == legacy_name:
                rows[i] = make_row(rows[i])
                found = True
                break
        if not found:
            rows.append(make_row())

        _write_csv_atomic(target_path, header, rows)
    invalidate_styles_cache()
    return True


def delete_style_from_csv(name, source_file=None):
    """Delete a style row by name from a data/ or imports/ CSV. Returns False if the
    style is not found there (including when it only exists in the read-only samples/
    pack).
    """
    if not source_file:
        for s in load_all_styles():
            if s["name"] == name:
                source_file = s.get("source_file") or s.get("source", "")
                break
    if not source_file:
        return False
    target_path = _resolve_write_target(source_file)
    if not target_path or not os.path.isfile(target_path):
        return False
    with locked_path(target_path):
        rows = []
        header = None
        removed = False
        with open(target_path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                if header is None and row and row[0].strip().lower() == "name":
                    header = row
                    continue
                if row and row[0].strip() == name:
                    removed = True
                    continue
                if row:
                    rows.append(row)
        if not removed:
            return False
        _write_csv_atomic(target_path, header or FIELDNAMES, rows)
    invalidate_styles_cache()
    return True
