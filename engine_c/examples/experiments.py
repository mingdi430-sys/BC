"""모델 실험: 같은 잣대(26주 뒤 70% 유지, 4주 간격 rolling origin, AUC)로 여러 모델을 비교한다.

학습 모델은 키워드 단위 leave-one-keyword-out 교차검증(LOKO)으로 평가한다.
같은 키워드의 시점들은 서로 강하게 상관돼 있어서 시점 단위로 나누면 성적이 부풀려지기 때문이다.

모델
  naive_trend  : 최근 4주 / 직전 12주 비율 (규칙 한 줄, 참고선)
  logreg       : 규칙 특징 7개 → 로지스틱 회귀 (계수 해석 가능)
  hgb          : 같은 특징 → HistGradientBoosting
  timesfm      : TimesFM 분위수 → 유지 확률 (zero-shot, 학습 없음)
  stack        : TimesFM 확률 + 규칙 특징 → 로지스틱 회귀 (보정)

실행: python examples/experiments.py   (TimesFM 백테스트 결과 timesfm_backtest.parquet 가 있어야 stack 가능)
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from trendlight.lifecycle.forecast import auc  # noqa: E402
from trendlight.lifecycle.stage import features_at  # noqa: E402

HORIZON, KEEP_FRAC, STEP, MIN_CONTEXT = 26, 0.7, 4, 26
LABELS = ["크로플", "탕후루", "두바이 초콜릿", "두쫀쿠", "마라탕", "오마카세", "소금빵",
          "김밥", "떡볶이", "치킨", "삼겹살", "짜장면", "라면", "우유", "비빔밥"]
FEATS = ["growth", "accel", "rel", "snr", "vol12", "weeks_since_peak", "log_level"]


def make_samples(curves: pd.DataFrame) -> pd.DataFrame:
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all") & (curves["keyword"].isin(LABELS))]
    rows = []
    for kw, g in base.groupby("keyword"):
        g = g.sort_values("week")
        v = g["value_norm"].to_numpy(dtype=float) * 100
        weeks = g["week"].dt.strftime("%Y-%m-%d").tolist()
        for t in range(MIN_CONTEXT, len(v) - HORIZON, STEP):
            basev = v[t - 3: t + 1].mean(); fut = v[t + HORIZON - 4: t + HORIZON].mean()
            if basev <= 0:
                continue
            f = features_at(v, t)
            hist = v[: t + 1]
            rows.append({"keyword": kw, "origin_week": weeks[t], "actual_keep": fut / basev >= KEEP_FRAC,
                         "growth": f["growth"], "accel": f["accel"], "rel": f["rel"], "snr": f["snr"],
                         "vol12": float(np.std(np.diff(hist[-13:])) / (hist[-13:].mean() + 1e-9)),
                         "weeks_since_peak": float(t - int(np.argmax(hist))),
                         "log_level": float(np.log1p(basev)),
                         "naive_trend": float(1 / (1 + np.exp(-4 * (hist[-4:].mean() / (hist[-16:-4].mean() + 1e-9) - 0.9))))})
    df = pd.DataFrame(rows).replace([np.inf, -np.inf], np.nan)
    df[FEATS] = df[FEATS].fillna(0.0)
    return df


def loko(df: pd.DataFrame, make_model, feats: list[str]) -> np.ndarray:
    """leave-one-keyword-out 예측 확률."""
    pred = np.full(len(df), np.nan)
    for kw in df["keyword"].unique():
        tr, te = df["keyword"] != kw, df["keyword"] == kw
        if df.loc[tr, "actual_keep"].nunique() < 2:
            continue
        m = make_model().fit(df.loc[tr, feats].to_numpy(), df.loc[tr, "actual_keep"].to_numpy())
        pred[te.to_numpy()] = m.predict_proba(df.loc[te, feats].to_numpy())[:, 1]
    return pred


def main():
    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    curves = pd.read_parquet(ROOT / "data/processed/curves.parquet")
    df = make_samples(curves)
    bt = ROOT / "data/processed/timesfm_backtest.parquet"
    if bt.exists():
        fm = pd.read_parquet(bt)[["keyword", "origin_week", "p_keep"]].rename(columns={"p_keep": "timesfm"})
        fm["origin_week"] = pd.to_datetime(fm["origin_week"]).dt.strftime("%Y-%m-%d")
        df = df.merge(fm, on=["keyword", "origin_week"], how="left")
    print(f"표본 {len(df)}개 · 키워드 {df.keyword.nunique()}개 · 실제 유지 {df.actual_keep.mean():.2f}")

    logreg = lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=2000))  # noqa: E731
    hgb = lambda: HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, l2_regularization=1.0)  # noqa: E731
    df["logreg"] = loko(df, logreg, FEATS)
    df["hgb"] = loko(df, hgb, FEATS)
    if "timesfm" in df:
        d2 = df.dropna(subset=["timesfm"]).copy()
        d2["stack"] = loko(d2, logreg, FEATS + ["timesfm"])
        df = df.merge(d2[["keyword", "origin_week", "stack"]], on=["keyword", "origin_week"], how="left")

    models = [m for m in ["naive_trend", "logreg", "hgb", "timesfm", "stack"] if m in df]
    print("\n전체 AUC (학습 모델은 leave-one-keyword-out):")
    for m in models:
        ok = df.dropna(subset=[m])
        print(f"  {m:12s} AUC {auc(ok.actual_keep, ok[m]):.3f}  (n={len(ok)})")
    print("\n유행 키워드만 (양성 7 + 비빔밥):")
    pos = df[df.keyword.isin(LABELS[:7] + ["비빔밥"])]
    for m in models:
        ok = pos.dropna(subset=[m])
        print(f"  {m:12s} AUC {auc(ok.actual_keep, ok[m]):.3f}  (n={len(ok)})")
    print("\n키워드별 AUC:")
    hdr = "  " + "키워드".ljust(9) + "".join(m.rjust(12) for m in models)
    print(hdr)
    for kw, g in df.groupby("keyword"):
        if g.actual_keep.nunique() < 2:
            continue
        print("  " + kw.ljust(9) + "".join(f"{auc(g.dropna(subset=[m]).actual_keep, g.dropna(subset=[m])[m]):12.2f}" if g.dropna(subset=[m]).actual_keep.nunique() > 1 else "           –" for m in models))
    # 로지스틱 계수 (전체 학습, 해석용)
    m = logreg().fit(df[FEATS].to_numpy(), df["actual_keep"].to_numpy())
    coef = m.named_steps["logisticregression"].coef_[0]
    print("\n로지스틱 회귀 계수 (표준화 특징, +면 유지 확률 ↑):")
    for f, c in sorted(zip(FEATS, coef), key=lambda x: -abs(x[1])):
        print(f"  {f:18s} {c:+.2f}")
    df.to_parquet(ROOT / "data/processed/experiments_loko.parquet", index=False)


if __name__ == "__main__":
    main()
