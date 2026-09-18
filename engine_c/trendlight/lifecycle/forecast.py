"""TimesFM(zero-shot 시계열 파운데이션 모델)로 26주 뒤 검색량을 예측해 '유지 확률'을 만든다.

질문: 주 t까지의 곡선만 보고, 26주(≈6개월) 뒤 검색량이 지금(최근 4주 평균)의 keep_frac(기본 0.7) 이상 유지되는가?
  - 예측: TimesFM 분위수 예측(0.1~0.9)에서 h=23..26주 평균의 분위수로 P(ratio ≥ keep_frac)를 근사
  - 정답: 실제 t+23..t+26주 평균 / t-3..t 평균 ≥ keep_frac
백테스트는 rolling origin(4주 간격)으로 미래 정보 없이 수행. 라벨 키워드는 평가에만 쓴다.
"""
from __future__ import annotations

import logging
from functools import lru_cache

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

HORIZON = 26
KEEP_FRAC = 0.7
CONTEXT = 512
MODEL_ID = "google/timesfm-2.5-200m-pytorch"
QUANTILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


@lru_cache(maxsize=1)
def load_model():
    import timesfm
    m = timesfm.TimesFM_2p5_200M_torch.from_pretrained(MODEL_ID)
    m.compile(timesfm.ForecastConfig(max_context=CONTEXT, max_horizon=64, normalize_inputs=True,
                                     use_continuous_quantile_head=True, force_flip_invariance=True,
                                     infer_is_positive=True, fix_quantile_crossing=True))
    return m


def forecast_batch(histories: list[np.ndarray], horizon: int = HORIZON) -> tuple[np.ndarray, np.ndarray]:
    """(point[n,h], quantiles[n,h,10]) — quantiles[...,0]은 mean, 1..9가 0.1..0.9 분위수."""
    m = load_model()
    inputs = [np.asarray(h, dtype=np.float32)[-CONTEXT:] for h in histories]
    point, q = m.forecast(horizon=horizon, inputs=inputs)
    return np.asarray(point), np.asarray(q)


def keep_probability(q: np.ndarray, base: float, keep_frac: float = KEEP_FRAC, h_from: int = 22, h_to: int = 26) -> dict:
    """q: [h, 10] 분위수. 목표 구간 평균의 분위수 곡선에서 threshold=base*keep_frac 를 넘는 확률을 선형보간."""
    seg = q[h_from:h_to, 1:].mean(axis=0)  # 9 quantile levels
    thr = base * keep_frac
    levels = np.array(QUANTILES)
    # P(X >= thr) = 1 - F(thr); F는 분위수의 역함수
    if thr <= seg[0]:
        p = 1 - 0.05 * (thr / max(seg[0], 1e-9))  # 최소 분위수보다 작으면 ≥0.95
        p = max(p, 0.95) if thr <= seg[0] else p
    elif thr >= seg[-1]:
        p = 0.05
    else:
        f = float(np.interp(thr, seg, levels))
        p = 1 - f
    median_ratio = float(seg[4] / base) if base > 0 else np.nan
    return {"p_keep": float(np.clip(p, 0, 1)), "median_ratio": median_ratio,
            "q10_ratio": float(seg[0] / base) if base > 0 else np.nan, "q90_ratio": float(seg[-1] / base) if base > 0 else np.nan}


def backtest_curve(values: np.ndarray, weeks: list, keyword: str, step: int = 4, min_context: int = 52,
                   horizon: int = HORIZON, keep_frac: float = KEEP_FRAC) -> pd.DataFrame:
    v = np.asarray(values, dtype=float)
    origins = list(range(min_context, len(v) - horizon, step))
    if not origins:
        return pd.DataFrame()
    hist = [v[: t + 1] for t in origins]
    _, q = forecast_batch(hist, horizon)
    rows = []
    for k, t in enumerate(origins):
        base = v[t - 3: t + 1].mean()
        fut = v[t + horizon - 4: t + horizon].mean()
        actual_ratio = fut / base if base > 0 else np.nan
        r = keep_probability(q[k], base, keep_frac)
        rows.append({"keyword": keyword, "origin_week": weeks[t], "base": base, "actual_ratio": actual_ratio,
                     "actual_keep": bool(actual_ratio >= keep_frac), **r})
    return pd.DataFrame(rows)


def auc(y: np.ndarray, s: np.ndarray) -> float:
    from scipy.stats import rankdata
    y = np.asarray(y, bool); s = np.asarray(s, float)
    n1, n0 = y.sum(), (~y).sum()
    if n1 == 0 or n0 == 0:
        return np.nan
    r = rankdata(s)
    return float((r[y].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


# ---------- 파이프라인 통합 ----------
from ..common.paths import PROCESSED  # noqa: E402

FORECASTS_PARQUET = PROCESSED / "forecasts.parquet"
BACKTEST_PARQUET = PROCESSED / "timesfm_backtest.parquet"
GREEN_MIN = 0.9   # p_keep ≥ 0.9 → 초록
RED_MAX = 0.5     # p_keep < 0.5 → 빨강


def signal_from_p(p: float) -> str:
    if p is None or np.isnan(p):
        return "grey"
    return "green" if p >= GREEN_MIN else "red" if p < RED_MAX else "amber"


def forecast_all(curves: pd.DataFrame, horizon: int = HORIZON) -> pd.DataFrame:
    """모든 키워드(전체 세그먼트)의 현재 시점 26주 예측. 행: keyword, h(1..26), week, median, q10, q90 + 요약(p_keep 등)."""
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all")]
    kws, hists, metas = [], [], []
    for kw, g in base.groupby("keyword"):
        g = g.sort_values("week")
        v = g["value_norm"].to_numpy(dtype=float) * 100
        if len(v) < 16:
            continue
        kws.append(kw); hists.append(v); metas.append(g)
    _, q = forecast_batch(hists, horizon)
    rows = []
    for kw, v, g, qk in zip(kws, hists, metas, q):
        basev = v[-4:].mean()
        s = keep_probability(qk, basev)
        last = pd.Timestamp(g["week"].iloc[-1])
        for h in range(horizon):
            rows.append({"keyword": kw, "h": h + 1, "week": last + pd.Timedelta(weeks=h + 1),
                         "median": qk[h, 5] / 100, "q10": qk[h, 1] / 100, "q90": qk[h, 9] / 100,
                         "p_keep": s["p_keep"], "median_ratio": s["median_ratio"], "signal": signal_from_p(s["p_keep"]),
                         "industry": g["industry"].iloc[0], "source": g["source"].iloc[0]})
    out = pd.DataFrame(rows)
    out.to_parquet(FORECASTS_PARQUET, index=False)
    log.info("forecasts.parquet 저장: 키워드 %d개", out["keyword"].nunique() if len(out) else 0)
    return out


def backtest_all(curves: pd.DataFrame, min_context: int = 26) -> tuple[pd.DataFrame, dict]:
    """라벨·데모 키워드 롤링 백테스트 + 규칙 단계 비교. (표, 지표)"""
    from .stage import rolling_stages
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all") & (curves["source"].isin(["label", "demo"]))]
    parts = []
    for kw, g in base.groupby("keyword"):
        g = g.sort_values("week")
        bt = backtest_curve(g["value_norm"].to_numpy() * 100, list(g["week"].dt.strftime("%Y-%m-%d")), kw, min_context=min_context)
        if bt.empty:
            continue
        st = rolling_stages(g).set_index("week")["stage"]
        bt["rule_stage"] = [st.get(pd.Timestamp(w)) for w in bt["origin_week"]]
        parts.append(bt)
    bt = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
    if bt.empty:
        return bt, {}
    bt.to_parquet(BACKTEST_PARQUET, index=False)
    ok = bt.dropna(subset=["actual_ratio"])
    rs = ok["rule_stage"].map({"declining": 0, "peak": 0.25, "surging": 0.5, "stable": 0.75, "emerging": 1.0})
    red, grn = ok["p_keep"] < RED_MAX, ok["p_keep"] >= GREEN_MIN
    m = {"n": int(len(ok)), "keep_rate": float(ok["actual_keep"].mean()),
         "auc_timesfm": auc(ok["actual_keep"], ok["p_keep"]), "auc_rule": auc(ok["actual_keep"], rs),
         "mae_ratio_timesfm": float((ok["median_ratio"] - ok["actual_ratio"]).abs().median()),
         "mae_ratio_naive": float((1 - ok["actual_ratio"]).abs().median()),
         "red_share": float(red.mean()), "red_precision": float((~ok["actual_keep"][red]).mean()) if red.any() else np.nan,
         "green_share": float(grn.mean()), "green_precision": float(ok["actual_keep"][grn].mean()) if grn.any() else np.nan,
         "amber_share": float((~red & ~grn).mean()),
         "decline_recall_red": float((red & ~ok["actual_keep"]).sum() / max((~ok["actual_keep"]).sum(), 1))}
    return bt, m


def per_keyword_metrics(bt: pd.DataFrame) -> pd.DataFrame:
    ok = bt.dropna(subset=["actual_ratio"])
    rows = []
    for kw, g in ok.groupby("keyword"):
        rs = g["rule_stage"].map({"declining": 0, "peak": 0.25, "surging": 0.5, "stable": 0.75, "emerging": 1.0})
        rows.append({"키워드": kw, "표본": len(g), "실제 유지율": round(g["actual_keep"].mean(), 2),
                     "AUC TimesFM": round(auc(g["actual_keep"], g["p_keep"]), 2) if g["actual_keep"].nunique() > 1 else None,
                     "AUC 규칙": round(auc(g["actual_keep"], rs), 2) if g["actual_keep"].nunique() > 1 else None,
                     "비율 오차(중앙값) TimesFM": round((g["median_ratio"] - g["actual_ratio"]).abs().median(), 2),
                     "비율 오차 naive": round((1 - g["actual_ratio"]).abs().median(), 2)})
    return pd.DataFrame(rows)
