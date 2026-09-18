"""전처리: 평활 스플라인 + detrend.

Djorno, Santillana & Yang (2026, IJF) 의 접근을 참고: 검색 트렌드 곡선을 평활 스플라인으로 잡음을 줄이고
장기 추세(느린 성분)를 빼서 유행 성분만 남긴다. 원본과 전처리 곡선을 모두 보관한다.
- smooth : scipy UnivariateSpline (평활 계수 s = n * var(y) * lam)
- detrend: 52주 중심 롤링 중앙값(느린 추세)을 뺀다. 추세가 없으면 0에 가깝다.
반환 DataFrame: week, value(원본), smooth, trend, detrended(=smooth - trend), detrended_pos(음수 절단)
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.interpolate import UnivariateSpline


def smooth_spline(y: np.ndarray, lam: float = 0.05, k: int = 3) -> np.ndarray:
    n = len(y)
    if n <= k + 1:
        return y.astype(float)
    x = np.arange(n, dtype=float)
    var = float(np.var(y)) or 1e-9
    spl = UnivariateSpline(x, y, k=k, s=n * var * lam)
    return spl(x)


def detrend(y: np.ndarray, window: int = 52) -> tuple[np.ndarray, np.ndarray]:
    s = pd.Series(y)
    trend = s.rolling(window, center=True, min_periods=max(4, window // 4)).median().bfill().ffill().to_numpy()
    return y - trend, trend


def preprocess_curve(df: pd.DataFrame, value_col: str = "value_norm", lam: float = 0.05,
                     trend_window: int = 52) -> pd.DataFrame:
    """단일 키워드·세그먼트 곡선(week, value_col) → 전처리 열 추가."""
    d = df.sort_values("week").reset_index(drop=True)
    y = d[value_col].astype(float).to_numpy()
    sm = smooth_spline(y, lam)
    dt_, tr = detrend(sm, trend_window)
    out = pd.DataFrame({"week": d["week"], "value": y, "smooth": sm, "trend": tr,
                        "detrended": dt_, "detrended_pos": np.clip(dt_, 0, None)})
    return out
