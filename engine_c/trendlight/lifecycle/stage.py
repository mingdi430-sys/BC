"""규칙 기반 단계 판정 (롤링, 누수 없음).

각 주 t에서 t 이전(포함) 데이터만 사용한다. 정점 위치는 절대 넘기지 않는다.
특징(주 t 기준, 최근 window=4주):
  level_t   = mean(v[t-3..t])
  growth_t  = level_t / mean(v[t-7..t-4]) - 1          # 최근 4주 vs 직전 4주 성장률
  accel_t   = growth_t - growth_{t-4}                    # 성장률의 변화(2차 미분 근사)
  rel_t     = level_t / max(v[..t])                      # 지금까지의 최대 대비 수준 (미래 정점 아님)
  snr_t     = |level_t − prev_level_t| / sqrt((s_recent² + s_prev²)/window)   # 두 창 평균 차이의 t-통계량
              (평탄+잡음 곡선에서 snr ≥ 3 은 약 2%만 발생. 낮은 수준의 잡음을 성장/하락으로 오판하는 것을 막는다)
규칙(위에서 아래로 첫 매치; declining/surging/emerging 은 snr ≥ 3 필요):
  declining : growth ≤ -g_low
  peak      : |growth| < g_low and accel < 0 and rel ≥ 0.7
  surging   : growth ≥ g_high
  emerging  : g_low ≤ growth < g_high and accel > 0
  stable    : 그 외 (4단계에 속하지 않는 기본값)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

WINDOW = 4
G_LOW = 0.10
G_HIGH = 0.50
SNR_MIN = 3.0
STAGES = ["emerging", "surging", "peak", "declining", "stable"]


def features_at(values: np.ndarray, t: int, window: int = WINDOW) -> dict:
    """values[:t+1] 만 사용한다."""
    v = np.asarray(values[: t + 1], dtype=float)
    if len(v) < 3 * window:  # growth 와 accel 모두 계산하려면 3*window 필요
        return {"level": np.nan, "growth": np.nan, "accel": np.nan, "rel": np.nan, "snr": np.nan}
    eps = 1e-9

    def growth_at(k: int) -> float:
        recent = v[k - window + 1: k + 1].mean()
        prev = v[k - 2 * window + 1: k - window + 1].mean()
        return recent / (prev + eps) - 1

    level = v[-window:].mean()
    recent, prev = v[-window:], v[-2 * window:-window]
    se = np.sqrt((recent.std(ddof=1) ** 2 + prev.std(ddof=1) ** 2) / window) + eps
    g = growth_at(len(v) - 1)
    g_prev = growth_at(len(v) - 1 - window)
    return {"level": level, "growth": g, "accel": g - g_prev, "rel": level / (v.max() + eps),
            "snr": abs(recent.mean() - prev.mean()) / se}


def classify(f: dict, g_low: float = G_LOW, g_high: float = G_HIGH, snr_min: float = SNR_MIN) -> str:
    g, a, rel = f["growth"], f["accel"], f["rel"]
    snr = f.get("snr", np.inf)
    if np.isnan(g):
        return "stable"
    significant = np.isnan(snr) or snr >= snr_min
    if g <= -g_low and significant:
        return "declining"
    if abs(g) < g_low and a < 0 and rel >= 0.7:
        return "peak"
    if g >= g_high and significant:
        return "surging"
    if g >= g_low and a > 0 and significant:
        return "emerging"
    return "stable"


def rolling_stages(curve: pd.DataFrame, value_col: str = "value_norm", g_low: float = G_LOW,
                   g_high: float = G_HIGH, window: int = WINDOW) -> pd.DataFrame:
    """week, stage, growth, accel, rel. 각 행은 그 주까지의 데이터만으로 계산됨."""
    d = curve.sort_values("week").reset_index(drop=True)
    vals = d[value_col].astype(float).to_numpy()
    rows = []
    for t in range(len(vals)):
        f = features_at(vals, t, window)
        rows.append({"week": d["week"][t], "stage": classify(f, g_low, g_high), **f})
    return pd.DataFrame(rows)
