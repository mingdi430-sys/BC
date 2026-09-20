"""명사구 주간 빈도에서 급등 탐지 → candidates.parquet

기준선: 직전 8주 이동평균(현재 주 제외). 급등: z ≥ 3 또는 전주 대비 ×3 이상.
z = (x_t - mean_{t-8..t-1}) / std_{t-8..t-1}. std가 0이면 z는 계산 불가 → 비율 조건만 적용.
잡음 억제: 급등 주 count ≥ min_count (기본 5), 관측 주 수 ≥ 6, z 분모에 +0.5 보정. 한글 없는 구·지명·일반명사는 phrases.py에서 제외.
후보 수: 업종당 max z 상위 20개. 라벨 키워드는 절대 개입시키지 않는다(필터도 하지 않는다).
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..common.paths import BIGKINDS_WEEKLY_PARQUET, CANDIDATES_PARQUET, YOUTUBE_WEEKLY_PARQUET

log = logging.getLogger(__name__)

BASELINE_WEEKS = 8
Z_THRESH = 3.0
RATIO_THRESH = 3.0
MIN_COUNT = 5
TOP_PER_INDUSTRY = 20


def detect_bursts(weekly: pd.DataFrame, baseline_weeks: int = BASELINE_WEEKS, z_thresh: float = Z_THRESH,
                  ratio_thresh: float = RATIO_THRESH, min_count: int = MIN_COUNT) -> pd.DataFrame:
    """weekly: industry, phrase, week, count, source → 급등 이벤트 행 (phrase, industry, week, z, ratio, source)."""
    if weekly.empty:
        return pd.DataFrame(columns=["phrase", "industry", "burst_week", "z", "ratio", "count", "source"])
    weekly = weekly.copy()
    weekly["week"] = pd.to_datetime(weekly["week"])
    weekly = weekly.groupby(["industry", "phrase", "source", "week"], as_index=False, dropna=False)["count"].sum()
    events = []
    gmin, gmax = weekly["week"].min(), weekly["week"].max()   # 기준선은 전체 수집 기간 기준 (처음 등장한 명사구도 앞 주는 0으로 센다)
    for (ind, ph, src), g in weekly.groupby(["industry", "phrase", "source"], dropna=False):
        g = g.set_index("week")["count"].sort_index()
        full = pd.date_range(gmin, gmax, freq="7D")  # 주간 격자 고정
        s = g.reindex(full, fill_value=0).astype(float)
        if len(s) < 6:
            continue
        prev = s.shift(1)
        mean = prev.rolling(baseline_weeks, min_periods=4).mean()
        std = prev.rolling(baseline_weeks, min_periods=4).std(ddof=0)
        z = (s - mean) / (std + 0.5)   # 분산 0인 짧은 기준선에서 z 폭주 방지 (연속성 보정)
        ratio = s / (prev + 1.0)       # 전주가 0이어도 정의되게 (+1 보정)
        hit = ((z >= z_thresh) | (ratio >= ratio_thresh)) & (s >= min_count)
        for w in s.index[hit]:
            events.append({"phrase": ph, "industry": ind, "burst_week": w, "z": float(z.get(w, np.nan)),
                           "ratio": float(ratio.get(w, np.nan)), "count": int(s[w]), "source": src})
    return pd.DataFrame(events, columns=["phrase", "industry", "burst_week", "z", "ratio", "count", "source"])


def select_candidates(events: pd.DataFrame, top: int = TOP_PER_INDUSTRY) -> pd.DataFrame:
    """명사구·업종별 첫 급등 주와 최대 z를 요약하고 업종당 상위 top개."""
    if events.empty:
        return pd.DataFrame(columns=["phrase", "industry", "burst_start_week", "max_z", "max_ratio", "sources", "n_bursts"])
    ev = events.copy()
    # 점수 = 급등 규모(건수) × 배율, z는 보조. z만 쓰면 기준선 분산이 0에 가까운 잡음어("하트")가 상위를 차지한다.
    ev["score"] = np.log1p(ev["count"]) * np.log1p(ev["ratio"].fillna(1).clip(lower=1, upper=20)) + ev["z"].fillna(0).clip(lower=0, upper=10) / 10
    agg = ev.groupby(["phrase", "industry"], dropna=False).agg(
        burst_start_week=("burst_week", "min"), max_z=("z", "max"), max_ratio=("ratio", "max"),
        score=("score", "max"), n_bursts=("burst_week", "size"),
        sources=("source", lambda s: ",".join(sorted(set(s)))),
    ).reset_index()
    agg = agg.sort_values(["industry", "score"], ascending=[True, False])
    out = agg.groupby("industry", dropna=False).head(top).reset_index(drop=True)
    return out.drop(columns=["score"])


def run(top: int = TOP_PER_INDUSTRY) -> pd.DataFrame:
    parts = []
    for p in (YOUTUBE_WEEKLY_PARQUET, BIGKINDS_WEEKLY_PARQUET):
        if p.exists():
            df = pd.read_parquet(p)
            if "kind" in df.columns:
                df = df[df["kind"] == "phrase"]
            if len(df):
                parts.append(df[["industry", "phrase", "week", "count", "source"]])
    weekly = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame(columns=["industry", "phrase", "week", "count", "source"])
    events = detect_bursts(weekly)
    cands = select_candidates(events, top)
    cands.to_parquet(CANDIDATES_PARQUET, index=False)
    log.info("candidates.parquet 저장: 급등 이벤트 %d → 후보 %d개 (업종 %d)", len(events), len(cands),
             cands["industry"].nunique() if len(cands) else 0)
    return cands


# ---------- 완만한 상승 탐지 ("지금 뜨는 것") ----------
RISE_RECENT = 4      # 최근 주 수
RISE_BASE = 8        # 비교 기준 주 수
RISE_RATIO = 2.0     # 최근 4주 평균 / 직전 8주 평균
RISE_MIN_SUM = 10    # 최근 4주 합 최소


def detect_rising(weekly: pd.DataFrame, recent: int = RISE_RECENT, base: int = RISE_BASE,
                  ratio_min: float = RISE_RATIO, min_sum: int = RISE_MIN_SUM, asof: pd.Timestamp | None = None) -> pd.DataFrame:
    """급등(z·×3)과 달리 몇 주에 걸쳐 서서히 오르는 명사구. 최근 recent주 평균이 직전 base주 평균의 ratio_min배 이상.
    반환: phrase, industry, recent_sum, base_mean, ratio, last_week, spark(최근 12주 건수)"""
    if weekly.empty:
        return pd.DataFrame(columns=["phrase", "industry", "recent_sum", "base_mean", "ratio", "last_week", "spark"])
    weekly = weekly.copy(); weekly["week"] = pd.to_datetime(weekly["week"])
    asof = asof or weekly["week"].max()
    grid = pd.date_range(asof - pd.Timedelta(weeks=recent + base - 1), asof, freq="7D")
    agg = weekly.groupby(["phrase", "week"], as_index=False)["count"].sum()
    ind_of = weekly.groupby(["phrase", "industry"])["count"].sum().reset_index().sort_values("count", ascending=False).drop_duplicates("phrase").set_index("phrase")["industry"]
    rows = []
    for ph, g in agg.groupby("phrase"):
        s = g.set_index("week")["count"].reindex(grid, fill_value=0).astype(float)
        rec, bas = s.iloc[-recent:], s.iloc[:-recent]
        if rec.sum() < min_sum or rec.iloc[-1] == 0:
            continue
        r = rec.mean() / (bas.mean() + 0.25)
        if r >= ratio_min and (rec.diff().dropna() >= 0).sum() >= recent - 2:  # 대체로 오르는 모양
            rows.append({"phrase": ph, "industry": ind_of.get(ph), "recent_sum": int(rec.sum()), "base_mean": round(float(bas.mean()), 2),
                         "ratio": round(float(r), 2), "last_week": asof.strftime("%Y-%m-%d"), "spark": [int(x) for x in s.iloc[-12:]]})
    return pd.DataFrame(rows).sort_values(["ratio", "recent_sum"], ascending=False).reset_index(drop=True)
