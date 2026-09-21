"""닮은 과거 유행 찾기.

곡선을 정점 기준으로 맞춰(−26 ~ +26주, 정점=100) 모양을 비교한다.
"이 아이템은 과거의 무엇과 닮았고, 그것은 그 뒤 어떻게 됐나"를 사례로 보여주기 위한 것이라
정점이 대상보다 앞서고 정점 후 6개월이 실제로 관측된 곡선만 후보로 쓴다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

PRE, POST = 26, 26
MIN_SIM = 0.80        # 이보다 낮으면 "닮은 사례 없음"
MIN_AMP = 3.0         # 정점/중앙값. 유행 모양이 아닌 평탄한 곡선은 비교 대상에서 제외
MIN_PEAK_GAP = 8      # 대상보다 최소 8주 앞선 정점만 "과거 사례"로 인정


def peak_shape(values: np.ndarray, pre: int = PRE, post: int = POST) -> dict | None:
    v = np.asarray(values, dtype=float)
    if len(v) < 40 or np.all(np.isnan(v)):
        return None
    p = int(np.nanargmax(v))
    if not v[p] > 0:
        return None
    idx = np.arange(p - pre, p + post + 1)
    out = np.full(len(idx), np.nan)
    ok = (idx >= 0) & (idx < len(v))
    out[ok] = v[idx[ok]] / v[p] * 100
    pos = v[v > 0]
    return {"peak_i": p, "n": len(v), "values": out,
            "amp": float(v[p] / (np.median(pos) if len(pos) else 1e-9)),
            "after6m": float(v[p + post] / v[p]) if len(v) > p + post else None}


def _sim(a: np.ndarray, b: np.ndarray) -> float:
    m = ~np.isnan(a) & ~np.isnan(b)
    if m.sum() < 30:
        return -1.0
    x, y = a[m], b[m]
    if x.std() < 1e-6 or y.std() < 1e-6:
        return -1.0
    return float(np.corrcoef(x, y)[0, 1])


def _same_item(a: str, b: str) -> bool:
    """버터떡 ↔ 상하이버터떡 처럼 한쪽이 다른 쪽을 포함하면 같은 아이템의 변형으로 본다."""
    x, y = a.replace(" ", ""), b.replace(" ", "")
    return x in y or y in x


def build_shapes(base: pd.DataFrame, keywords: list[str]) -> dict:
    shapes = {}
    for kw, g in base[base["keyword"].isin(keywords)].groupby("keyword"):
        g = g.sort_values("week")
        sh = peak_shape(g["value_norm"].to_numpy())
        if sh is None:
            continue
        sh["peak_week"] = str(g["week"].iloc[sh["peak_i"]].date())
        sh["weeks_since_peak"] = int(len(g) - 1 - sh["peak_i"])
        shapes[kw] = sh
    return shapes


def similar_to(target: str, shapes: dict, top: int = 3) -> list[dict]:
    t = shapes.get(target)
    if t is None or t["amp"] < MIN_AMP:
        return []
    out = []
    for kw, o in shapes.items():
        if kw == target or _same_item(kw, target) or o["after6m"] is None or o["amp"] < MIN_AMP:
            continue
        if o["peak_i"] - (o["n"] - 1) > t["peak_i"] - (t["n"] - 1) - MIN_PEAK_GAP:  # 대상보다 늦게 정점
            continue
        s = _sim(t["values"], o["values"])
        if s >= MIN_SIM:
            out.append({"keyword": kw, "sim": round(s, 3), "peak_week": o["peak_week"],
                        "after6m": round(o["after6m"], 3),
                        "values": [None if np.isnan(x) else round(float(x), 1) for x in o["values"]]})
    out.sort(key=lambda r: -r["sim"])
    return out[:top]
