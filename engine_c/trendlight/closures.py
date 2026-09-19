"""지방행정인허가 데이터(localdata.go.kr)로 아이템별 개업·폐업 곡선을 만든다.

입력: data/raw/localdata/*.csv 또는 *.zip (일반음식점·휴게음식점·제과점 전체 CSV, 사이트에서 "전체 데이터" 내려받기)
      이 서버에서는 localdata.go.kr 접속이 안 되므로 PC에서 받아 올린다. 인코딩은 cp949/utf-8 자동 감지.
출력: data/processed/closures_by_item.parquet (item, month, opened, closed, active)
      reports/closures.md (검색 정점 ↔ 개업 정점 ↔ 폐업 정점 시차 표)

상호(사업장명)에 아이템명이 들어간 가게를 그 아이템 매장으로 본다(예: "탕후루"). 별칭은 config에 추가.
개업 = 인허가일자, 폐업 = 폐업일자(영업상태가 폐업인 행). 월 단위 집계.
"""
from __future__ import annotations

import io
import logging
import re
import zipfile
from pathlib import Path

import pandas as pd

from .common.paths import CURVES_PARQUET, PROCESSED, RAW, REPORTS
from .config import label_keywords

log = logging.getLogger(__name__)
LOCALDATA_RAW = RAW / "localdata"
OUT = PROCESSED / "closures_by_item.parquet"
REPORT = REPORTS / "closures.md"

COL = {"name": ["사업장명"], "open": ["인허가일자"], "close": ["폐업일자"], "status": ["영업상태명", "상세영업상태명"],
       "addr": ["소재지전체주소", "도로명전체주소"], "kind": ["업태구분명"], "service": ["개방서비스명"]}
ITEM_ALIASES = {"두바이 초콜릿": ["두바이초콜릿", "두바이 초콜릿"], "크로플": ["크로플"], "탕후루": ["탕후루"], "마라탕": ["마라탕"],
                "오마카세": ["오마카세"], "소금빵": ["소금빵"], "두쫀쿠": ["두쫀쿠"], "김밥": ["김밥"], "떡볶이": ["떡볶이"],
                "치킨": ["치킨"], "삼겹살": ["삼겹살"], "짜장면": ["짜장"], "라면": ["라면"], "우유": ["우유"], "비빔밥": ["비빔밥"]}
SIDO_PREFIX = {"서울": "서울", "부산": "부산", "대구": "대구", "광주": "광주", "대전": "대전"}


def _read_any(path: Path) -> pd.DataFrame:
    def read_bytes(b: bytes) -> pd.DataFrame:
        for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
            try:
                return pd.read_csv(io.BytesIO(b), encoding=enc, dtype=str, low_memory=False)
            except UnicodeDecodeError:
                continue
        raise ValueError(f"{path.name}: 인코딩 판별 실패")
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            frames = [read_bytes(z.read(n)) for n in z.namelist() if n.lower().endswith(".csv")]
        return pd.concat(frames, ignore_index=True)
    return read_bytes(path.read_bytes())


def _pick(df: pd.DataFrame, keys: list[str]) -> str | None:
    for k in keys:
        if k in df.columns:
            return k
    return None


def load_localdata() -> pd.DataFrame:
    files = sorted(list(LOCALDATA_RAW.glob("*.csv")) + list(LOCALDATA_RAW.glob("*.zip")))
    if not files:
        raise FileNotFoundError(f"{LOCALDATA_RAW} 에 인허가 CSV/ZIP이 없습니다.")
    parts = []
    for f in files:
        df = _read_any(f)
        c = {k: _pick(df, v) for k, v in COL.items()}
        if not c["name"] or not c["open"]:
            log.warning("%s: 사업장명/인허가일자 열 없음, 건너뜀 (열: %s)", f.name, list(df.columns)[:8])
            continue
        out = pd.DataFrame({
            "name": df[c["name"]].fillna(""),
            "opened": pd.to_datetime(df[c["open"]].str.slice(0, 10), errors="coerce"),
            "closed": pd.to_datetime(df[c["close"]].str.slice(0, 10), errors="coerce") if c["close"] else pd.NaT,
            "status": df[c["status"]].fillna("") if c["status"] else "",
            "addr": df[c["addr"]].fillna("") if c["addr"] else "",
            "kind": df[c["kind"]].fillna("") if c["kind"] else "",
            "service": df[c["service"]].fillna(f.stem) if c["service"] else f.stem,
        })
        parts.append(out)
        log.info("%s: %d행", f.name, len(out))
    return pd.concat(parts, ignore_index=True)


def item_events(df: pd.DataFrame, items: dict[str, list[str]] | None = None, start: str = "2018-01") -> pd.DataFrame:
    items = items or ITEM_ALIASES
    rows = []
    months = pd.period_range(start, pd.Timestamp.today().strftime("%Y-%m"), freq="M")
    for item, aliases in items.items():
        pat = "|".join(re.escape(a) for a in aliases)
        sub = df[df["name"].str.contains(pat, na=False)]
        if sub.empty:
            continue
        opened = sub["opened"].dt.to_period("M").value_counts()
        closed = sub["closed"].dropna().dt.to_period("M").value_counts()
        active = 0
        for m in months:
            o, cl = int(opened.get(m, 0)), int(closed.get(m, 0))
            active = int(((sub["opened"] <= m.end_time) & (sub["closed"].isna() | (sub["closed"] > m.end_time))).sum())
            rows.append({"item": item, "month": m.to_timestamp(), "opened": o, "closed": cl, "active": active, "n_total": len(sub)})
        for sido in SIDO_PREFIX:
            s2 = sub[sub["addr"].str.startswith(sido)]
            if s2.empty:
                continue
            op2 = s2["opened"].dt.to_period("M").value_counts(); cl2 = s2["closed"].dropna().dt.to_period("M").value_counts()
            for m in months:
                rows.append({"item": f"{sido} {item}", "month": m.to_timestamp(), "opened": int(op2.get(m, 0)), "closed": int(cl2.get(m, 0)),
                             "active": int(((s2["opened"] <= m.end_time) & (s2["closed"].isna() | (s2["closed"] > m.end_time))).sum()), "n_total": len(s2)})
    return pd.DataFrame(rows)


def lag_table(ev: pd.DataFrame) -> pd.DataFrame:
    """검색 정점(curves) ↔ 개업 정점 ↔ 폐업 정점 시차(월)."""
    curves = pd.read_parquet(CURVES_PARQUET) if CURVES_PARQUET.exists() else pd.DataFrame()
    rows = []
    for item, g in ev.groupby("item"):
        if " " in item:
            continue
        g = g.sort_values("month")
        if g["opened"].sum() < 20:
            continue
        op_peak = g.loc[g["opened"].idxmax(), "month"]; cl_peak = g.loc[g["closed"].idxmax(), "month"]
        row = {"item": item, "매장 수(누적)": int(g["n_total"].iloc[0]), "개업 정점": op_peak.strftime("%Y-%m"), "폐업 정점": cl_peak.strftime("%Y-%m"),
               "개업→폐업 정점(개월)": (cl_peak.year - op_peak.year) * 12 + cl_peak.month - op_peak.month}
        if len(curves):
            c = curves[(curves["keyword"] == item) & (curves["gender"] == "all") & (curves["age"] == "all")]
            if len(c):
                sp = c.loc[c["value_norm"].idxmax(), "week"]
                row["검색 정점"] = sp.strftime("%Y-%m")
                row["검색→개업 정점(개월)"] = (op_peak.year - sp.year) * 12 + op_peak.month - sp.month
                row["검색→폐업 정점(개월)"] = (cl_peak.year - sp.year) * 12 + cl_peak.month - sp.month
        # 12개월 생존율: 개업 정점 달에 연 가게 중 12개월 뒤 영업 중 비율은 원자료가 필요하므로 별도 계산
        rows.append(row)
    return pd.DataFrame(rows)


def survival_12m(df: pd.DataFrame, items: dict[str, list[str]] | None = None) -> pd.DataFrame:
    """아이템별, 개업 연도별 12개월 생존율(폐업일이 개업 후 365일 이내가 아닌 비율)."""
    items = items or ITEM_ALIASES
    rows = []
    cutoff = pd.Timestamp.today() - pd.Timedelta(days=365)
    for item, aliases in items.items():
        pat = "|".join(re.escape(a) for a in aliases)
        sub = df[df["name"].str.contains(pat, na=False) & (df["opened"] <= cutoff) & (df["opened"] >= "2018-01-01")]
        if len(sub) < 20:
            continue
        for y, g in sub.groupby(sub["opened"].dt.year):
            died = (g["closed"].notna()) & ((g["closed"] - g["opened"]).dt.days <= 365)
            rows.append({"item": item, "개업 연도": int(y), "개업 수": len(g), "12개월 내 폐업": int(died.sum()), "12개월 생존율": round(1 - died.mean(), 3)})
    return pd.DataFrame(rows)


def run() -> None:
    df = load_localdata()
    log.info("인허가 총 %d행, 폐업일 있는 행 %d", len(df), df["closed"].notna().sum())
    ev = item_events(df)
    ev.to_parquet(OUT, index=False)
    lag = lag_table(ev); surv = survival_12m(df)
    md = ["# 아이템별 개업·폐업 (지방행정인허가 데이터)", "", f"원자료 {len(df):,}행, 상호에 아이템명이 포함된 매장 기준. 별칭: {ITEM_ALIASES}", "",
          "## 검색 정점 → 개업 정점 → 폐업 정점 시차", "", lag.to_markdown(index=False) if len(lag) else "_(해당 없음)_", "",
          "## 개업 연도별 12개월 생존율", "", surv.to_markdown(index=False) if len(surv) else "_(해당 없음)_", ""]
    REPORT.write_text("\n".join(md), encoding="utf-8")
    print(f"{OUT} / {REPORT} 저장. 아이템 {ev['item'].nunique()}개")
    print(lag.to_string(index=False) if len(lag) else "시차 표 없음")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run()
