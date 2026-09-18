"""반감기: 정점(최대값 주) 이후 값이 정점의 50% 이하로 처음 떨어지는 주까지의 일수.

라벨 4개(크로플 163, 탕후루 54, 두바이초콜릿 13, 두쫀쿠 17; 코리아헤럴드 2026-02-08, 원자료 네이버 데이터랩)와 비교해 MAE를 낸다.
재현이 안 되면 정의 차이 후보를 리포트:
  - 주간 vs 일간: 주간 곡선의 해상도는 7일이라 13일·17일짜리 반감기는 1~3주로만 표현된다.
  - 평활 여부: 스플라인은 정점을 깎고 넓혀 반감기를 늘린다.
  - 정점 정의: 전체 기간 최대 vs 국소 정점(재유행 포함).
  - 재정규화: 앵커 나눗셈은 비율이라 반감기에 영향 없음(mean 방식). weekly 방식이면 앵커 변동이 섞인다.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..config import labels as labels_cfg
from .preprocess import preprocess_curve

log = logging.getLogger(__name__)


def halflife_days(weeks: pd.Series | np.ndarray, values: np.ndarray, peak_idx: int | None = None,
                  frac: float = 0.5) -> dict:
    """정점과 반감기. 정점 이후 frac 이하로 안 떨어지면 halflife_days=None(우측 절단)."""
    w = pd.to_datetime(pd.Series(weeks)).reset_index(drop=True)
    v = np.asarray(values, dtype=float)
    if len(v) == 0:
        return {"peak_week": None, "peak_value": None, "halflife_days": None, "censored": True}
    p = int(np.nanargmax(v)) if peak_idx is None else int(peak_idx)
    thr = v[p] * frac
    after = np.where(v[p + 1:] <= thr)[0]
    if len(after) == 0:
        return {"peak_week": w[p], "peak_value": float(v[p]), "halflife_days": None, "censored": True}
    q = p + 1 + int(after[0])
    return {"peak_week": w[p], "peak_value": float(v[p]), "halflife_days": int((w[q] - w[p]).days),
            "half_week": w[q], "censored": False}


def halflife_variants(curve: pd.DataFrame, value_col: str = "value_norm") -> dict[str, dict]:
    """같은 곡선에 대해 정의 변형별 반감기."""
    d = curve.sort_values("week")
    out = {"weekly_raw": halflife_days(d["week"], d[value_col].to_numpy())}
    pp = preprocess_curve(d, value_col)
    out["weekly_smooth"] = halflife_days(pp["week"], pp["smooth"].to_numpy())
    out["weekly_detrended"] = halflife_days(pp["week"], pp["detrended_pos"].to_numpy())
    # 주간 → 일간 선형보간(해상도 차이 확인용)
    s = d.set_index("week")[value_col].astype(float)
    daily = s.resample("D").interpolate("linear")
    out["daily_interp"] = halflife_days(daily.index, daily.to_numpy())
    return out


VARIANTS = ["weekly_raw", "weekly_smooth", "weekly_detrended", "daily_interp", "daily_raw", "daily_smooth7"]


def evaluate(curves: pd.DataFrame, value_col: str = "value_norm",
             daily: pd.DataFrame | None = None) -> tuple[pd.DataFrame, dict]:
    """전체 세그먼트(gender=all, age=all) 곡선으로 라벨 반감기 재현. (표, 변형별 MAE)
    daily(curves_daily.parquet)가 있으면 실제 일간 곡선 변형(daily_raw, 7일 이동평균 daily_smooth7)도 비교."""
    lab = [p for p in labels_cfg()["positives"] if p.get("halflife_days")]
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all") & (curves["source"] == "label")]
    rows = []
    for p in lab:
        c = base[base["keyword"] == p["keyword"]]
        if c.empty:
            rows.append({"keyword": p["keyword"], "expected": p["halflife_days"], "missing": True})
            continue
        var = halflife_variants(c, value_col)
        row = {"keyword": p["keyword"], "expected": p["halflife_days"], "missing": False,
               "peak_week": var["weekly_raw"]["peak_week"]}
        for k, v in var.items():
            row[k] = v["halflife_days"]
        if daily is not None and len(daily):
            d = daily[daily["keyword"] == p["keyword"]].sort_values("date")
            if len(d):
                y = d[value_col].to_numpy(dtype=float)
                row["daily_raw"] = halflife_days(d["date"], y)["halflife_days"]
                y7 = pd.Series(y).rolling(7, center=True, min_periods=1).mean().to_numpy()
                row["daily_smooth7"] = halflife_days(d["date"], y7)["halflife_days"]
        rows.append(row)
    table = pd.DataFrame(rows)
    maes = {}
    for k in VARIANTS:
        if k in table:
            ok = table[k].notna() & ~table["missing"]
            maes[k] = float((table.loc[ok, k] - table.loc[ok, "expected"]).abs().mean()) if ok.any() else None
    return table, maes


def diagnosis(table: pd.DataFrame, maes: dict) -> list[str]:
    notes = []
    if table.empty or table["missing"].all():
        return ["라벨 곡선이 없어 반감기 재현 불가(curves.parquet에 라벨 키워드 없음)."]
    best = min((k for k in maes if maes[k] is not None), key=lambda k: maes[k], default=None)
    if best:
        notes.append(f"가장 근접한 정의: {best} (MAE {maes[best]:.1f}일).")
    short = table[(table["expected"] <= 21) & ~table["missing"]]
    if len(short) and "daily_raw" not in table:
        notes.append("기대값 13·17일은 주간 해상도(7일 격자)에서는 7/14/21일로만 나온다 → 기사 원자료는 일간 곡선일 가능성이 큼. "
                     "재현하려면 `collect-daily` 로 라벨 키워드 일간 곡선 수집 필요.")
    if "daily_raw" in table:
        notes.append("주간 원본은 7일 격자 때문에 짧은 반감기(13·17일)를 21일로 올림한다. 일간 원본(daily_raw)은 하루짜리 스파이크가 "
                     "정점이 돼 1~5일로 무너진다. 일간 + 7일 중심 이동평균(daily_smooth7)이 기사 정의에 가장 근접 → "
                     "반감기 산출은 일간·7일 이동평균으로 확정하고, 후보 곡선은 주간 수집 후 반감기용으로만 일간 추가 수집.")
    if maes.get("weekly_smooth") is not None and maes.get("weekly_raw") is not None and maes["weekly_smooth"] > maes["weekly_raw"]:
        notes.append("평활 스플라인은 정점을 깎고 넓혀 반감기를 과대추정한다 → 반감기 계산은 원본 곡선을 쓰고 평활은 단계 판정에만 사용.")
    if table.get("weekly_raw") is not None and table["weekly_raw"].isna().any():
        notes.append("일부 키워드는 정점 후 50% 이하로 떨어지지 않아(우측 절단) 반감기 미정의 → 관측 종료 시점 또는 재유행 영향.")
    return notes
