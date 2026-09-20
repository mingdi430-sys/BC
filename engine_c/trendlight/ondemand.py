"""풀에 없는 키워드를 즉석에서: 네이버 곡선 수집(전체·성별·연령·5개 도시) → 단계·반감기·TimesFM 예측 → 웹 항목 JSON.

python -m trendlight.ondemand "<키워드>" [업종]   → stdout 에 JSON 한 줄
수집 결과는 curves.parquet 에 합쳐 저장되고 API 응답은 캐시되므로 두 번째부터는 호출이 없다.
"""
from __future__ import annotations

import json
import logging
import sys

import pandas as pd

from .common.paths import CURVES_PARQUET
from .config import label_keywords
from .datalab.client import DatalabClient
from .datalab.collect import Collector, KeywordSpec, build_segments, probe_anchor
from .export_web import REGIONS, build_keyword_entry

log = logging.getLogger(__name__)


def fetch_and_build(keyword: str, industry: str | None = None, with_regions: bool = True) -> dict:
    curves = pd.read_parquet(CURVES_PARQUET) if CURVES_PARQUET.exists() else pd.DataFrame()
    have = set(curves[(curves["gender"] == "all") & (curves["age"] == "all")]["keyword"]) if len(curves) else set()
    need = [keyword] + ([f"{r} {keyword}" for r in REGIONS] if with_regions else [])
    if any(k not in have for k in need):
        c = Collector(DatalabClient.from_env())
        c.general_anchor = probe_anchor(c.client, c.start, c.end)
        specs = [KeywordSpec(keyword, industry, "demo")] + ([KeywordSpec(f"{r} {keyword}", industry, "demo_region", base_keyword=keyword) for r in REGIONS] if with_regions else [])
        new = pd.concat([c.collect_segment(specs, seg) for seg in build_segments()], ignore_index=True)
        new["source_client"] = c.client.name
        if len(curves):
            cols = list(curves.columns)
            key = ["keyword", "gender", "age"]
            done = new[key].drop_duplicates().assign(_n=1)
            old = curves.merge(done, on=key, how="left"); old = old[old["_n"].isna()].drop(columns="_n")
            curves = pd.concat([old[cols], new[cols]], ignore_index=True)
        else:
            curves = new
        curves.to_parquet(CURVES_PARQUET, index=False)
    weeks = sorted(curves["week"].unique()); widx = {w: i for i, w in enumerate(weeks)}
    entry = build_keyword_entry(keyword, curves, pd.DataFrame(), label_keywords(), weeks, widx)
    if entry is None:
        raise ValueError(f"'{keyword}' 곡선이 너무 짧거나 없음")
    return {"keyword": keyword, "weeks": [pd.Timestamp(w).strftime("%Y-%m-%d") for w in weeks], "entry": entry}


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    kw = sys.argv[1]; ind = sys.argv[2] if len(sys.argv) > 2 else None
    print(json.dumps(fetch_and_build(kw, ind), ensure_ascii=False))
