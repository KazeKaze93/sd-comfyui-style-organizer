"""CSV parsing and categorization (read path)."""

import csv
import os

from stylegrid.config import get_all_styles_file_paths, logger


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
                })
            except (IndexError, AttributeError):
                logger.warning("[Style Grid] %s:%d skipped malformed row", base, reader.line_num)
                continue
    return styles


def load_all_styles():
    """Merge CSVs from data/. Uniqueness key is (source_file, name).
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
