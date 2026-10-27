"""enrich_style / categorize_styles purity and single catalog load via cache."""

from __future__ import annotations

from pathlib import Path

from stylegrid import cache as sg_cache
from stylegrid import csv_io
from stylegrid import data_files as sg_data
from stylegrid.prompt_ops import build_styles_by_cat

# Golden captured with the pre-change node path
# (list(get_cached_styles()); categorize_styles(styles); build_styles_by_cat(styles))
# against the three-pack fixture below. Values are (source basename, name).
GOLDEN_BY_CAT = {
    "base": [
        ("pack_a.csv", "BASE_Alpha"),
        ("pack_b.csv", "BASE_Beta"),
        ("pack_b.csv", "BASE_Alpha"),
        ("pack_c.csv", "BASE_Gamma"),
    ],
    "mood": [("pack_a.csv", "mood-calm")],
    "pack_a": [("pack_a.csv", "plainone")],
    "pack_b": [("pack_b.csv", "plainone")],
    "explicit": [("pack_c.csv", "CustomName")],
}


def _write_golden_packs(tmp_path: Path) -> list[str]:
    a = tmp_path / "pack_a.csv"
    b = tmp_path / "pack_b.csv"
    c = tmp_path / "pack_c.csv"
    a.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "BASE_Alpha,p_a1,n_a1,d,BASE\n"
        "mood-calm,p_a2,n_a2,d,\n"
        "plainone,p_a3,n_a3,d,\n",
        encoding="utf-8-sig",
    )
    b.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "BASE_Beta,p_b1,n_b1,d,BASE\n"
        "BASE_Alpha,p_b_dup,n_b_dup,d,BASE\n"
        "plainone,p_b3,n_b3,d,\n",
        encoding="utf-8-sig",
    )
    c.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "CustomName,p_c1,n_c1,d,EXPLICIT\n"
        "BASE_Gamma,p_c2,n_c2,d,BASE\n",
        encoding="utf-8-sig",
    )
    return [str(a), str(b), str(c)]


def _patch_style_paths(monkeypatch, paths: list[str]) -> None:
    monkeypatch.setattr(csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: paths)
    sg_cache._file_hashes.clear()
    sg_cache.invalidate_styles_cache()


def _by_cat_fingerprint(by_cat: dict) -> dict[str, list[tuple[str, str]]]:
    return {
        cat: [
            ((s.get("source_file") or "").rsplit("/", 1)[-1], s["name"])
            for s in rows
        ]
        for cat, rows in by_cat.items()
    }


def test_node_path_by_cat_matches_prechange_golden(tmp_path, monkeypatch):
    from stylegrid import config as sg_config

    paths = _write_golden_packs(tmp_path)
    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    _patch_style_paths(monkeypatch, paths)

    enriched = [csv_io.enrich_style(s) for s in sg_cache.get_cached_styles()]
    by_cat = build_styles_by_cat(enriched, "")
    assert list(by_cat.keys()) == list(GOLDEN_BY_CAT.keys())
    assert _by_cat_fingerprint(by_cat) == GOLDEN_BY_CAT


def test_enrich_and_categorize_do_not_mutate_input():
    underscore = {
        "name": "BASE_Alpha",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack.csv",
        "source_file": "/tmp/pack.csv",
        "category_explicit": "",
    }
    hyphen = {
        "name": "mood-calm",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack.csv",
        "source_file": "/tmp/pack.csv",
        "category_explicit": "",
    }
    plain = {
        "name": "plainone",
        "prompt": "p",
        "negative_prompt": "",
        "source": "pack_a.csv",
        "source_file": "/tmp/pack_a.csv",
        "category_explicit": "",
    }
    explicit = {
        "name": "CustomName",
        "prompt": "{prompt}, x",
        "negative_prompt": "",
        "source": "pack_c.csv",
        "source_file": "/tmp/pack_c.csv",
        "category_explicit": "EXPLICIT",
    }
    samples = [underscore, hyphen, plain, explicit]
    snapshots = [dict(s) for s in samples]

    enriched = [csv_io.enrich_style(s) for s in samples]
    categories = csv_io.categorize_styles(samples)

    for original, after in zip(snapshots, samples):
        assert after == original
        assert "category" not in after
        assert "display_name" not in after
        assert "has_placeholder" not in after

    assert enriched[0]["category"] == "BASE"
    assert enriched[0]["display_name"] == "Alpha"
    assert enriched[0]["has_placeholder"] is False
    assert enriched[1]["category"] == "mood"
    assert enriched[1]["display_name"] == "calm"
    assert enriched[2]["category"] == "Pack_a"
    assert enriched[2]["display_name"] == "plainone"
    assert enriched[3]["category"] == "EXPLICIT"
    assert enriched[3]["display_name"] == "CustomName"
    assert enriched[3]["has_placeholder"] is True

    assert set(categories) == {"BASE", "mood", "Pack_a", "EXPLICIT"}
    assert categories["BASE"][0]["name"] == "BASE_Alpha"
    assert categories["BASE"][0]["display_name"] == "Alpha"
    assert categories["mood"][0]["name"] == "mood-calm"
    assert categories["mood"][0]["display_name"] == "calm"
    assert categories["Pack_a"][0]["name"] == "plainone"
    assert categories["EXPLICIT"][0]["name"] == "CustomName"
    assert categories["EXPLICIT"][0]["has_placeholder"] is True


def test_normalize_presets_reuses_styles_cache(tmp_path, monkeypatch):
    from stylegrid import config as sg_config

    paths = _write_golden_packs(tmp_path)
    monkeypatch.setattr(sg_config, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(sg_config, "IMPORTS_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr(sg_config, "SAMPLES_DIR", str(tmp_path / "samples"))
    _patch_style_paths(monkeypatch, paths)

    calls = {"n": 0}
    real = csv_io.parse_styles_csv

    def counting(filepath):
        calls["n"] += 1
        return real(filepath)

    monkeypatch.setattr(csv_io, "parse_styles_csv", counting)

    sg_cache.get_cached_styles()
    sg_data.normalize_presets({})
    sg_data.normalize_presets({"P": {"styles": ["BASE_Alpha"], "created": "2026-01-01T00:00:00"}})
    # One full catalog load = one parse per fixture CSV; cache must serve both normalize_presets.
    assert calls["n"] == len(paths)
