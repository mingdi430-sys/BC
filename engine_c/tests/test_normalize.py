import numpy as np
import pandas as pd
import pytest

from trendlight.datalab.normalize import anchor_scale, apply_chain, link_factor, normalize_response


def _df(**series):
    weeks = pd.date_range("2024-01-01", periods=len(next(iter(series.values()))), freq="7D")
    rows = []
    for kw, vals in series.items():
        rows += [{"keyword": kw, "week": w, "value_raw": float(v)} for w, v in zip(weeks, vals)]
    return pd.DataFrame(rows)


def test_anchor_mean_scale_is_one():
    df = _df(쿠팡=[100, 80, 120], 아이템=[10, 20, 30])
    out = normalize_response(df, "쿠팡", "mean")
    assert out[out.keyword == "쿠팡"].value_norm.mean() == pytest.approx(1.0)
    assert out[out.keyword == "아이템"].value_norm.tolist() == pytest.approx([0.1, 0.2, 0.3])
    assert (out.anchor == "쿠팡").all()


def test_weekly_scale():
    df = _df(쿠팡=[100, 50], 아이템=[10, 10])
    out = normalize_response(df, "쿠팡", "weekly")
    assert out[out.keyword == "아이템"].value_norm.tolist() == pytest.approx([0.1, 0.2])


def test_chain_recovers_general_scale():
    """G 척도에서 X의 진짜 값 = 0.02 (X/G). 2단 체인으로 같은 값이 나와야 한다."""
    # 진짜 검색량: G=1000, I=100, X=20 (상수)
    # 요청1 (G, I): 최대=100 → G=100, I=10
    req1 = _df(G=[100, 100, 100], I=[10, 10, 10])
    # 요청2 (I, X): 최대=100 → I=100, X=20
    req2 = _df(I=[100, 100, 100], X=[20, 20, 20])
    link = link_factor(req1, "G", "I", "mean")
    assert link == pytest.approx(0.1)
    x_i = normalize_response(req2, "I", "mean")
    x_g = apply_chain(x_i, link, "G", "I")
    assert x_g[x_g.keyword == "X"].value_norm.tolist() == pytest.approx([0.02] * 3)
    assert (x_g.anchor == "G>I").all()


def test_chain_weekly_series_factor():
    req1 = _df(G=[100, 50], I=[10, 10])
    req2 = _df(I=[100, 100], X=[20, 20])
    link = link_factor(req1, "G", "I", "weekly")
    x_g = apply_chain(normalize_response(req2, "I", "weekly"), link, "G", "I")
    assert x_g[x_g.keyword == "X"].value_norm.tolist() == pytest.approx([0.02, 0.04])


def test_missing_anchor_raises():
    with pytest.raises(KeyError):
        anchor_scale(_df(A=[1, 2]), "B")
