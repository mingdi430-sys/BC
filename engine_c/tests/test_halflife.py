import numpy as np
import pandas as pd
import pytest

from trendlight.lifecycle.halflife import halflife_days, halflife_variants


def _synthetic(peak_idx=20, hl_weeks=4.0, n=60):
    weeks = pd.date_range("2023-01-02", periods=n, freq="7D")
    t = np.arange(n)
    v = np.where(t <= peak_idx, np.exp((t - peak_idx) / 3.0), 0.5 ** ((t - peak_idx) / hl_weeks)) * 100
    return weeks, v


def test_halflife_exact_on_grid():
    weeks, v = _synthetic(peak_idx=20, hl_weeks=4.0)
    r = halflife_days(weeks, v)
    assert r["peak_week"] == weeks[20]
    assert r["halflife_days"] == 28  # 4주 = 28일
    assert not r["censored"]


def test_halflife_rounds_up_to_next_week():
    # 반감기 2.5주 → 주간 격자에서 50% 이하로 처음 떨어지는 건 3주째(21일)
    weeks, v = _synthetic(peak_idx=10, hl_weeks=2.5)
    assert halflife_days(weeks, v)["halflife_days"] == 21


def test_censored_when_no_decay():
    weeks = pd.date_range("2023-01-02", periods=10, freq="7D")
    v = np.linspace(1, 10, 10)
    r = halflife_days(weeks, v)
    assert r["halflife_days"] is None and r["censored"]


def test_variants_daily_interp_finer():
    weeks, v = _synthetic(peak_idx=20, hl_weeks=2.5)
    df = pd.DataFrame({"week": weeks, "value_norm": v})
    var = halflife_variants(df)
    assert var["weekly_raw"]["halflife_days"] == 21
    assert 14 < var["daily_interp"]["halflife_days"] <= 21
