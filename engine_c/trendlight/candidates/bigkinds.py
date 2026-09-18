"""빅카인즈 웹 다운로드 엑셀 파서 (API 승인제이므로 파일 기반).

data/raw/bigkinds/*.xlsx 를 읽어 키워드별 일별 뉴스 건수 → 주간 집계.
파일명 규칙: "{키워드}__{아무거나}.xlsx" 또는 "{키워드}.xlsx" (키워드 = 빅카인즈 검색어).
  예) 편의점 신상__20240101-20241231.xlsx
빅카인즈 엑셀의 표준 열: 뉴스 식별자, 일자, 언론사, 기고자, 제목, ... 키워드, 특성추출(가중치순 상위 50개), 본문, URL
검색어 자체의 일별 건수 외에, 제목에서 명사구를 뽑아 burst 입력으로도 넘긴다.
파일이 없으면 빈 테이블을 돌려주고 경고만 남긴다(스텁 동작).
"""
from __future__ import annotations

import logging
from collections import Counter
from pathlib import Path

import pandas as pd

from ..common.paths import BIGKINDS_RAW, BIGKINDS_WEEKLY_PARQUET
from ..config import industries as industries_cfg
from .phrases import extract_phrases

log = logging.getLogger(__name__)

DATE_COLS = ["일자", "date", "DATE"]
TITLE_COLS = ["제목", "title", "TITLE"]


def _keyword_from_name(p: Path) -> str:
    return p.stem.split("__")[0].strip()


def _guess_industry(keyword: str) -> str | None:
    icfg = industries_cfg()["industries"]
    for ind, c in icfg.items():
        if keyword in c["queries"] or keyword == ind or keyword == c.get("anchor"):
            return ind
    for ind, c in icfg.items():
        if any(tok in keyword for tok in ind.replace("음식", "").split()):
            return ind
    return None


def parse_file(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path)
    dcol = next((c for c in DATE_COLS if c in df.columns), None)
    tcol = next((c for c in TITLE_COLS if c in df.columns), None)
    if dcol is None:
        raise ValueError(f"{path.name}: 일자 열을 찾을 수 없음 (열: {list(df.columns)[:10]})")
    dates = pd.to_datetime(df[dcol].astype(str).str.slice(0, 8), format="%Y%m%d", errors="coerce")
    dates = dates.fillna(pd.to_datetime(df[dcol], errors="coerce"))
    week = dates.dt.to_period("W-SUN").dt.start_time
    kw = _keyword_from_name(path)
    ind = _guess_industry(kw)
    rows = []
    daily = pd.DataFrame({"week": week}).dropna().groupby("week").size()
    for w, n in daily.items():
        rows.append({"industry": ind, "phrase": kw, "week": w, "count": int(n), "kind": "query"})
    if tcol is not None:
        cnt: Counter = Counter()
        for w, t in zip(week, df[tcol].astype(str)):
            if pd.isna(w):
                continue
            for ph in extract_phrases(t):
                cnt[(ph, w)] += 1
        rows += [{"industry": ind, "phrase": ph, "week": w, "count": n, "kind": "phrase"} for (ph, w), n in cnt.items()]
    return pd.DataFrame(rows)


def run() -> pd.DataFrame:
    files = sorted(BIGKINDS_RAW.glob("*.xlsx"))
    cols = ["industry", "phrase", "week", "count", "kind", "source"]
    if not files:
        log.warning("빅카인즈 엑셀 없음 (%s) → 스텁: 빈 테이블", BIGKINDS_RAW)
        out = pd.DataFrame(columns=cols)
    else:
        parts = []
        for f in files:
            try:
                parts.append(parse_file(f))
                log.info("빅카인즈 파싱: %s", f.name)
            except Exception as e:  # noqa: BLE001
                log.error("빅카인즈 파싱 실패 %s: %s", f.name, e)
        out = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=cols[:-1])
        out["source"] = "bigkinds"
    out.to_parquet(BIGKINDS_WEEKLY_PARQUET, index=False)
    return out
