"""팀원용 모델 실험 템플릿.

질문: 주 t까지의 검색 곡선만 보고, 26주 뒤 검색량이 지금(최근 4주 평균)의 70% 이상 남는가?
여기서 `predict()` 한 함수만 바꾸면 같은 잣대(rolling origin, 미래 정보 없음, AUC)로 비교된다.

실행:  python examples/backtest_template.py
입력:  data/processed/curves.parquet  (keyword, week, value_norm, gender, age, source ...)
출력:  키워드별·전체 AUC, 그리고 TimesFM(data/processed/timesfm_backtest.parquet)과의 비교
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from trendlight.lifecycle.forecast import auc  # noqa: E402

HORIZON = 26      # 예측 지평(주)
KEEP_FRAC = 0.7   # 유지 기준
STEP = 4          # origin 간격(주)
MIN_CONTEXT = 26  # 최소 과거 길이(주)


# ---------------------------------------------------------------------------
# 여기만 바꾸면 된다: 과거 곡선(1차원 numpy, 오래된→최근)을 받아 "유지 확률"(0~1)을 돌려준다.
# 예시는 단순 규칙: 최근 4주 평균 / 직전 12주 평균 이 1 이상이면 낙관.
# ---------------------------------------------------------------------------
def predict(history: np.ndarray) -> float:
    recent = history[-4:].mean()
    prev = history[-16:-4].mean() if len(history) >= 16 else history[:-4].mean()
    ratio = recent / (prev + 1e-9)
    return float(1 / (1 + np.exp(-4 * (ratio - 0.9))))  # 로지스틱으로 0~1 압축


def backtest(curves: pd.DataFrame, keywords: list[str] | None = None) -> pd.DataFrame:
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all")]
    if keywords:
        base = base[base["keyword"].isin(keywords)]
    rows = []
    for kw, g in base.groupby("keyword"):
        v = g.sort_values("week")["value_norm"].to_numpy(dtype=float) * 100
        weeks = g.sort_values("week")["week"].tolist()
        for t in range(MIN_CONTEXT, len(v) - HORIZON, STEP):
            basev = v[t - 3: t + 1].mean()
            fut = v[t + HORIZON - 4: t + HORIZON].mean()
            if basev <= 0:
                continue
            rows.append({"keyword": kw, "origin_week": weeks[t], "p_keep": predict(v[: t + 1]),
                         "actual_ratio": fut / basev, "actual_keep": fut / basev >= KEEP_FRAC})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    curves = pd.read_parquet(ROOT / "data/processed/curves.parquet")
    labels = ["크로플", "탕후루", "두바이 초콜릿", "두쫀쿠", "마라탕", "오마카세", "소금빵",
              "김밥", "떡볶이", "치킨", "삼겹살", "짜장면", "라면", "우유", "비빔밥"]
    bt = backtest(curves, labels)
    print(f"표본 {len(bt)}개, 실제 유지 비율 {bt.actual_keep.mean():.2f}")
    print(f"내 모델 AUC: {auc(bt.actual_keep, bt.p_keep):.3f}")
    ref = ROOT / "data/processed/timesfm_backtest.parquet"
    if ref.exists():
        r = pd.read_parquet(ref).dropna(subset=["actual_ratio"])
        print(f"TimesFM AUC (같은 질문, 참고): {auc(r.actual_keep, r.p_keep):.3f}")
    print("\n키워드별 AUC (하락 사례가 없는 안정 품목은 NaN):")
    for kw, g in bt.groupby("keyword"):
        a = auc(g.actual_keep, g.p_keep) if g.actual_keep.nunique() > 1 else float("nan")
        print(f"  {kw:8s} n={len(g):3d} keep={g.actual_keep.mean():.2f} auc={a:.2f}")
