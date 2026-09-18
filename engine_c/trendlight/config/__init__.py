import functools
from pathlib import Path

import yaml

CONFIG_DIR = Path(__file__).resolve().parent


@functools.lru_cache(maxsize=None)
def _load(name: str) -> dict:
    with (CONFIG_DIR / name).open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def industries() -> dict:
    return _load("industries.yaml")


def anchors() -> dict:
    return _load("anchors.yaml")


def labels() -> dict:
    return _load("labels.yaml")


def industry_names() -> list[str]:
    return list(industries()["industries"].keys())


def label_keywords() -> dict[str, dict]:
    """키워드 → 라벨 메타 (positives + negatives)."""
    lab = labels()
    out = {}
    for p in lab["positives"]:
        out[p["keyword"]] = {**p, "polarity": "positive"}
    for n in lab["negatives"]:
        out[n["keyword"]] = {**n, "polarity": "negative"}
    return out
