"""웹(팀 React 앱 signal/)용 트렌드 데이터 내보내기.

python -m trendlight.export_web [출력경로]
기본 출력: ../BC-team/signal/src/trendData.json

내용: 키워드별 주간 곡선(전체·성별·연령·지역), 규칙 단계 이력과 현재 단계, 반감기, TimesFM 26주 예측과 6개월 유지 확률,
      업종별 급등 후보 목록, 검증 지표. 신호등 색은 예측 확률로 정하되, 규칙이 태동·급등인데 빨강이면 노랑으로 낮춘다
      (백테스트에서 빨강 오판이 급등 직전에 몰렸기 때문).
"""
from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .common.paths import CANDIDATES_PARQUET, CURVES_PARQUET, ROOT
from .config import label_keywords
from .lifecycle.forecast import BACKTEST_PARQUET, FORECASTS_PARQUET, GREEN_MIN, RED_MAX, auc, signal_history, forecast_batch, keep_probability
from .lifecycle.halflife import halflife_days
from .lifecycle.stage import rolling_stages

REGIONS = ["서울", "부산", "대구", "광주", "대전"]
DEFAULT_OUT = ROOT.parent / "BC-team" / "signal" / "src" / "trendData.json"


def _series(df: pd.DataFrame, widx: dict) -> list:
    arr = [None] * len(widx)
    for w, v in zip(df["week"], df["value_norm"]):
        arr[widx[w]] = round(float(v), 5)
    return arr


def adjusted_signal(p_keep: float | None, stage: str) -> str:
    if p_keep is None or np.isnan(p_keep):
        return "grey"
    sig = "green" if p_keep >= GREEN_MIN else "red" if p_keep < RED_MAX else "amber"
    if sig == "red" and stage in ("emerging", "surging"):
        sig = "amber"  # 급등 직전 비관 오판 보정
    return sig


def build(out_path: Path = DEFAULT_OUT) -> dict:
    curves = pd.read_parquet(CURVES_PARQUET)
    fc = pd.read_parquet(FORECASTS_PARQUET) if FORECASTS_PARQUET.exists() else pd.DataFrame()
    cands = pd.read_parquet(CANDIDATES_PARQUET) if CANDIDATES_PARQUET.exists() else pd.DataFrame()
    labels = label_keywords()
    weeks = sorted(curves["week"].unique())
    widx = {w: i for i, w in enumerate(weeks)}
    base_kws = sorted(curves[curves["source"].isin(["label", "demo", "candidate"])]["keyword"].unique())
    out = {"generated": dt.date.today().isoformat(),
           "weeks": [pd.Timestamp(w).strftime("%Y-%m-%d") for w in weeks], "keywords": {}, "candidates": [], "meta": {}}
    for kw in base_kws:
        g = curves[curves["keyword"] == kw]
        base = g[(g["gender"] == "all") & (g["age"] == "all")].sort_values("week")
        if len(base) < 16:
            continue
        st = rolling_stages(base)
        rle = []
        for s in st["stage"]:
            if rle and rle[-1][0] == s:
                rle[-1][1] += 1
            else:
                rle.append([s, 1])
        hl = halflife_days(base["week"], base["value_norm"].to_numpy())
        last = st.iloc[-1]
        k = {"industry": base["industry"].iloc[0], "source": base["source"].iloc[0],
             "polarity": labels.get(kw, {}).get("polarity", "candidate"),
             "all": _series(base, widx), "stages": rle,
             "current": {"stage": last["stage"], "growth": None if pd.isna(last["growth"]) else round(float(last["growth"]), 3),
                         "rel": None if pd.isna(last["rel"]) else round(float(last["rel"]), 3)},
             "peak_week": hl["peak_week"].strftime("%Y-%m-%d"), "peak_value": round(hl["peak_value"], 5),
             "halflife_days": hl["halflife_days"], "expected_halflife_days": labels.get(kw, {}).get("halflife_days"),
             "gender": {s: _series(g[(g["gender"] == s) & (g["age"] == "all")], widx) for s in ["m", "f"]},
             "age": {a: _series(g[(g["gender"] == "all") & (g["age"] == a)], widx) for a in "123456"},
             "region": {}}
        for r in REGIONS:
            rg = curves[(curves["keyword"] == f"{r} {kw}") & (curves["gender"] == "all") & (curves["age"] == "all")]
            if len(rg):
                k["region"][r] = _series(rg, widx)
        if len(fc):
            f = fc[fc["keyword"] == kw].sort_values("h")
            if len(f):
                p = float(f["p_keep"].iloc[0])
                k["forecast"] = {"weeks": [w.strftime("%Y-%m-%d") for w in f["week"]],
                                 "median": f["median"].round(5).tolist(), "q10": f["q10"].round(5).tolist(),
                                 "q90": f["q90"].round(5).tolist(), "p_keep": round(p, 3),
                                 "median_ratio": round(float(f["median_ratio"].iloc[0]), 3),
                                 "signal": adjusted_signal(p, last["stage"])}
        k["signal"] = k.get("forecast", {}).get("signal", "grey")
        # 지평별 유지 확률 (3·6·12개월) — 색은 6개월 기준, 숫자는 셋 다 보여준다
        vv = base["value_norm"].to_numpy() * 100
        _, q52 = forecast_batch([vv], 52)
        bv = vv[-4:].mean()
        k["horizons"] = {str(hz): round(float(keep_probability(q52[0], bv, h_from=hz - 4, h_to=hz)["p_keep"]), 3) for hz in (13, 26, 52)}
        # 타임머신: 4주 간격 과거 시점의 판정 (그 시점까지의 데이터만 사용)
        stages_by_idx = st["stage"].tolist()
        hist = signal_history(base["value_norm"].to_numpy() * 100, base["week"].dt.strftime("%Y-%m-%d").tolist())
        for h in hist:
            h["stage"] = stages_by_idx[h["idx"]]
            h["signal"] = adjusted_signal(h["p_keep"], h["stage"])
        k["history"] = hist
        out["keywords"][kw] = k
    if len(cands):
        for r in cands.sort_values(["industry", "max_z"], ascending=[True, False]).itertuples():
            out["candidates"].append({"phrase": r.phrase, "industry": r.industry,
                                      "burst_week": pd.Timestamp(r.burst_start_week).strftime("%Y-%m-%d"),
                                      "z": None if pd.isna(r.max_z) else round(float(r.max_z), 1),
                                      "has_curve": r.phrase in out["keywords"]})
    meta = {"model": "TimesFM 2.5 (200M, zero-shot)", "horizon_weeks": 26, "keep_frac": 0.7,
            "green_min": GREEN_MIN, "red_max": RED_MAX, "anchor": "쿠팡",
            "curve_source": "네이버 검색어 트렌드 (NAVER API HUB), 주간, 2020~", "candidate_source": "YouTube Data API v3 검색 결과 제목"}
    if BACKTEST_PARQUET.exists():
        bt = pd.read_parquet(BACKTEST_PARQUET).dropna(subset=["actual_ratio"])
        grn, red = bt["p_keep"] >= GREEN_MIN, bt["p_keep"] < RED_MAX
        meta["backtest"] = {"n": int(len(bt)), "auc": round(auc(bt["actual_keep"], bt["p_keep"]), 3),
                            "green_precision": round(float(bt["actual_keep"][grn].mean()), 3),
                            "red_precision": round(float((~bt["actual_keep"][red]).mean()), 3)}
    out["meta"] = meta
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{out_path} 저장: 키워드 {len(out['keywords'])}개, 후보 {len(out['candidates'])}개, {out_path.stat().st_size // 1024}KB")
    return out


if __name__ == "__main__":
    build(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT)
