"""앵커 재정규화.

데이터랩은 요청 안의 최대값을 100으로 놓기 때문에 요청이 다르면 척도가 다르다.
모든 요청에 같은 앵커를 넣고, 앵커의 척도(기간 평균 또는 주별 값)로 나눠 앵커=1.0 척도로 통일한다.

2단 앵커(범용 G → 업종 I → 아이템 X):
  요청1 (G, I, ...)   : link = scale(I)/scale(G)            # I를 G 척도로 표현
  요청2 (I, X, ...)   : x_I = X / scale(I)                   # X를 I 척도로 표현
  최종                : x_G = x_I * link                      # X를 G 척도로 표현
scale()은 method='mean'이면 기간 평균, 'weekly'면 주별 값.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def anchor_scale(df: pd.DataFrame, anchor: str, method: str = "mean") -> pd.Series | float:
    a = df[df["keyword"] == anchor]
    if a.empty:
        raise KeyError(f"앵커 '{anchor}'가 응답에 없습니다.")
    if method == "mean":
        m = float(a["value_raw"].mean())
        if m <= 0:
            raise ValueError(f"앵커 '{anchor}' 평균이 0입니다.")
        return m
    if method == "weekly":
        s = a.set_index("week")["value_raw"].replace(0, np.nan)
        return s
    raise ValueError(method)


def normalize_response(df: pd.DataFrame, anchor: str, method: str = "mean") -> pd.DataFrame:
    """value_norm 열 추가. 앵커 행도 남긴다(앵커의 value_norm 평균 = 1.0)."""
    out = df.copy()
    scale = anchor_scale(df, anchor, method)
    if isinstance(scale, pd.Series):
        out["value_norm"] = out["value_raw"] / out["week"].map(scale).astype(float)
    else:
        out["value_norm"] = out["value_raw"] / scale
    out["anchor"] = anchor
    return out


def link_factor(df_link: pd.DataFrame, general_anchor: str, industry_anchor: str,
                method: str = "mean") -> float | pd.Series:
    """요청1에서 업종 앵커를 범용 앵커 척도로 표현한 값."""
    g = anchor_scale(df_link, general_anchor, method)
    i = anchor_scale(df_link, industry_anchor, method)
    if isinstance(g, pd.Series) or isinstance(i, pd.Series):
        return (i / g).astype(float)
    return float(i) / float(g)


def apply_chain(df_norm_industry: pd.DataFrame, factor: float | pd.Series,
                general_anchor: str, industry_anchor: str) -> pd.DataFrame:
    """업종 앵커 척도의 value_norm을 범용 앵커 척도로 변환하고 anchor 열을 체인 문자열로 바꾼다."""
    out = df_norm_industry.copy()
    if isinstance(factor, pd.Series):
        out["value_norm"] = out["value_norm"] * out["week"].map(factor).astype(float)
    else:
        out["value_norm"] = out["value_norm"] * factor
    out["anchor"] = f"{general_anchor}>{industry_anchor}"
    return out


def item_max_raw(df: pd.DataFrame, keyword: str) -> float:
    v = df.loc[df["keyword"] == keyword, "value_raw"]
    return float(v.max()) if len(v) else 0.0
