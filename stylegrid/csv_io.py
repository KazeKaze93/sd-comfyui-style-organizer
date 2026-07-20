"""CSV parsing, categorization, and style CRUD (read + write path)."""

import csv
import os

from .cache import invalidate_styles_cache
from .config import DATA_DIR, SAMPLES_DIR, get_all_styles_file_paths, logger

FIELDNAMES = ["name", "prompt", "negative_prompt", "description", "category"]


def _sanitize_csv_cell(value):
    """Prevent CSV injection when opening in spreadsheet apps."""
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def parse_styles_csv(filepath):
    """
    Parse one styles CSV as UTF-8/UTF-8-BOM into normalized style dicts.

    Keys: name, prompt, negative_prompt, description, category_explicit,
    source (basename), source_file (absolute path). Malformed rows are skipped
    and logged; they never abort the rest of the file.
    """
    styles = []
    if not os.path.isfile(filepath):
        return styles
    base = os.path.basename(filepath)
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
                name = row[0].strip() if len(row) > 0 else ""
                if not name:
                    continue
                styles.append({
                    "name": name,
                    "prompt": row[1].strip() if len(row) > 1 else "",
                    "negative_prompt": row[2].strip() if len(row) > 2 else "",
                    "description": row[3].strip() if len(row) > 3 else "",
                    "category_explicit": row[4].strip() if len(row) > 4 else "",
                    "source": base,
                    "source_file": os.path.abspath(filepath),
                    "read_only": os.path.dirname(filepath) == SAMPLES_DIR,
                })
            except (IndexError, AttributeError):
                logger.warning("[Style Grid] %s:%d skipped malformed row", base, reader.line_num)
                continue
    return styles


def load_all_styles():
    """Merge CSVs from data/ and samples/. Uniqueness key is (source_file, name).
    Warns on the same name appearing in different packs (thumbnail hash collision risk).
    """
    all_styles = []
    seen_keys = set()
    name_owner = {}
    for filepath in get_all_styles_file_paths():
        for s in parse_styles_csv(filepath):
            key = (s["source_file"], s["name"])
            if key in seen_keys:
                continue
            seen_keys.add(key)
            prior = name_owner.get(s["name"])
            if prior and prior != s["source"]:
                logger.warning(
                    "[Style Grid] duplicate style name %r in %s and %s "
                    "(names must be globally unique)", s["name"], prior, s["source"])
            else:
                name_owner[s["name"]] = s["source"]
            all_styles.append(s)
    return all_styles


def _category_from_filename(source):
    if not source or not isinstance(source, str):
        return ""
    base = os.path.splitext(source.strip())[0].strip()
    if not base:
        return ""
    return base[0].upper() + base[1:]


def categorize_styles(styles):
    categories = {}
    for s in styles:
        name = s["name"]
        source = s.get("source") or ""
        explicit_cat = s.get("category_explicit", "").strip()
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
        s["category"] = cat
        s["display_name"] = display
        s["has_placeholder"] = "{prompt}" in (s.get("prompt") or "") or "{prompt}" in (s.get("negative_prompt") or "")
        categories.setdefault(cat, []).append(s)
    for cat in categories:
        categories[cat].sort(key=lambda x: (x.get("display_name") or x["name"] or "").lower())
    return categories


def _resolve_write_target(source_file):
    """Resolve a CSV path for writes. Only matches files under DATA_DIR — samples/ is
    never a write target, even if a same-named file exists there.
    """
    if source_file:
        source_file = os.path.basename(source_file)
        if not source_file.lower().endswith(".csv"):
            source_file += ".csv"
    if not source_file:
        source_file = "styles.csv"
    for fp in get_all_styles_file_paths():
        if os.path.dirname(fp) == DATA_DIR and os.path.basename(fp) == source_file:
            return fp
    return os.path.join(DATA_DIR, source_file)


def save_style_to_csv(name, prompt, negative_prompt, description="", source_file=None, category=None):
    """Upsert a style row in a data/ CSV: replace the first matching name row, or append."""
    target_path = _resolve_write_target(source_file)
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
        return [name, prompt, negative_prompt, _sanitize_csv_cell(description), cat_cell]

    found = False
    for i, row in enumerate(rows):
        if row and row[0].strip() == name:
            rows[i] = make_row(rows[i])
            found = True
            break
    if not found:
        rows.append(make_row())

    with open(target_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
    invalidate_styles_cache()
    return True


def delete_style_from_csv(name, source_file=None):
    """Delete a style row by name from a data/ CSV. Returns False if the style is not
    found under data/ (including when it only exists in the read-only samples/ pack).
    """
    if not source_file:
        for s in load_all_styles():
            if s["name"] == name:
                source_file = s.get("source", "")
                break
    if not source_file:
        return False
    source_file = os.path.basename(source_file)
    if not source_file.lower().endswith(".csv"):
        source_file += ".csv"
    target_path = None
    for fp in get_all_styles_file_paths():
        if os.path.dirname(fp) == DATA_DIR and os.path.basename(fp) == source_file:
            target_path = fp
            break
    if not target_path:
        return False
    rows = []
    header = None
    with open(target_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if header is None and row and row[0].strip().lower() == "name":
                header = row
                continue
            if row and row[0].strip() != name:
                rows.append(row)
    with open(target_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            row_dict = {
                fn: (row[i].strip() if i < len(row) and row[i] is not None else "")
                for i, fn in enumerate(FIELDNAMES)
            }
            writer.writerow(row_dict)
    invalidate_styles_cache()
    return True
