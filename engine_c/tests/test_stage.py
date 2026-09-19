import numpy as np
import pandas as pd

from trendlight.lifecycle.stage import classify, features_at, rolling_stages


def _curve(n=80, seed=0):
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    v = 5 + 40 * np.exp(-0.5 * ((t - 45) / 8) ** 2) + rng.normal(0, 0.5, n)
    return pd.DataFrame({"week": pd.date_range("2022-01-03", periods=n, freq="7D"), "value_norm": v})


def test_no_future_leakage():
    """t 시점 판정은 t 이후 데이터를 바꿔도 변하지 않아야 한다."""
    c = _curve()
    full = rolling_stages(c)
    for t in [15, 30, 45, 60]:
        trunc = rolling_stages(c.iloc[: t + 1])
        assert trunc["stage"].iloc[t] == full["stage"].iloc[t]
        tampered = c.copy()
        tampered.loc[t + 1:, "value_norm"] = 1000.0  # 미래를 극단적으로 바꿈
        assert rolling_stages(tampered)["stage"].iloc[t] == full["stage"].iloc[t]


def test_features_use_only_past():
    v = np.arange(100, dtype=float)
    f1 = features_at(v, 30)
    v2 = v.copy(); v2[31:] = -999
    f2 = features_at(v2, 30)
    assert f1 == f2


def test_sequence_rise_then_fall():
    c = _curve()
    st = rolling_stages(c)
    stages = st["stage"].tolist()
    first_surge = stages.index("surging")
    first_dec = stages.index("declining")
    assert first_surge < first_dec
    assert "declining" in stages[45:60]


def test_flat_curve_never_surging():
    rng = np.random.default_rng(1)
    c = pd.DataFrame({"week": pd.date_range("2022-01-03", periods=100, freq="7D"),
                      "value_norm": 30 + rng.normal(0, 0.5, 100)})
    assert (rolling_stages(c)["stage"] != "surging").all()


def test_classify_rules():
    assert classify({"growth": -0.3, "accel": 0, "rel": 1}) == "declining"
    assert classify({"growth": 0.8, "accel": 0.1, "rel": 0.5}) == "surging"
    assert classify({"growth": 0.2, "accel": 0.05, "rel": 0.3}) == "emerging"
    assert classify({"growth": 0.02, "accel": -0.2, "rel": 0.9}) == "peak"
    assert classify({"growth": np.nan, "accel": np.nan, "rel": np.nan}) == "stable"
