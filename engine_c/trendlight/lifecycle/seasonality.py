"""월별 계절 지수.

유행으로 한 해가 통째로 높은 것과 "해마다 그 달에 오른다"는 것을 구분해야 하므로,
52주 중심 이동평균으로 추세를 나눈 뒤(detrend) 남은 성분을 월별로 평균한다.
지수 100 = 연평균 수준. 관측이 2년 미만이면 계절성을 말하지 않는다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

MIN_WEEKS = 156        # 3년. 단발 유행을 계절성으로 오인하지 않으려면 같은 달을 여러 해 봐야 한다
MIN_YEARS_PER_MONTH = 3
MIN_STRENGTH = 0.30    # (최고달 − 최저달) / 100. 이보다 작으면 계절성 없음으로 본다


def seasonal_index(weeks: pd.Series, values: np.ndarray) -> dict | None:
    s = pd.Series(np.asarray(values, dtype=float), index=pd.to_datetime(weeks)).dropna()
    s = s[s > 0]
    if len(s) < MIN_WEEKS:
        return None
    trend = s.rolling(52, center=True, min_periods=26).mean()
    ratio = (s / trend).replace([np.inf, -np.inf], np.nan).dropna()
    if len(ratio) < MIN_WEEKS:
        return None
    # 평균이 아니라 중앙값. 한 해의 유행 급등이 그 달 지수를 끌어올리는 것을 막는다.
    by_month = ratio.groupby(ratio.index.month).median() * 100
    years = ratio.groupby(ratio.index.month).apply(lambda x: x.index.year.nunique())
    if years.min() < MIN_YEARS_PER_MONTH:
        return None
    idx = [round(float(by_month.get(m, np.nan)), 1) if m in by_month.index else None for m in range(1, 13)]
    vals = [v for v in idx if v is not None]
    if len(vals) < 12:
        return None
    strength = (max(vals) - min(vals)) / 100
    return {"index": idx, "strength": round(float(strength), 3),
            "peak_month": int(np.argmax(vals) + 1), "low_month": int(np.argmin(vals) + 1),
            "n_years": round(len(ratio) / 52, 1), "seasonal": bool(strength >= MIN_STRENGTH)}
