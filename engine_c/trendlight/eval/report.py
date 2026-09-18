"""1단계 평가 리포트 (reports/stage1_eval.md). 라벨은 여기(와 halflife 평가)서만 쓴다.

리포트 구성: 무엇을 묻는가 → 데이터가 어디서 어떻게 왔나 → 표 4개와 읽는 법
(a) 후보 생성기가 라벨 양성 7개를 급등 시점에 잡았는가
(b) 반감기 재현 MAE
(c) 롤링 단계 판정에서 declining 첫 판정 주 − 실제 정점 주 (리드타임)
(d) 음성 7개가 surging으로 오판된 횟수
함께 내보내는 파일: reports/label_curves_weekly.csv (주 × 키워드 wide), reports/label_summary.csv (키워드별 요약)
"""
from __future__ import annotations

import datetime as dt
import json
import logging

import numpy as np
import pandas as pd

from ..common.paths import CACHE, CANDIDATES_PARQUET, CURVES_PARQUET, PROCESSED, REPORTS, STATE, YOUTUBE_WEEKLY_PARQUET
from ..common.text import norm_kw
from ..config import anchors as anchors_cfg, labels as labels_cfg
from ..lifecycle.halflife import diagnosis, evaluate as hl_evaluate, halflife_days
from ..lifecycle.stage import rolling_stages

log = logging.getLogger(__name__)
REPORT = REPORTS / "stage1_eval.md"
CURVES_CSV = REPORTS / "label_curves_weekly.csv"
SUMMARY_CSV = REPORTS / "label_summary.csv"
CATCH_TOLERANCE_WEEKS = 8


# ---------- 분석 함수 ----------

def _base_curve(curves: pd.DataFrame, kw: str) -> pd.DataFrame:
    return curves[(curves["keyword"] == kw) & (curves["gender"] == "all") & (curves["age"] == "all")].sort_values("week")


def _rise_week(curve: pd.DataFrame, frac: float = 0.2) -> pd.Timestamp | None:
    """정점 전, 값이 정점의 frac를 처음 넘는 주 = 급등 시작 주(라벨 기준선)."""
    if curve.empty:
        return None
    v = curve["value_norm"].to_numpy(dtype=float)
    p = int(np.nanargmax(v))
    idx = np.where(v[: p + 1] >= v[p] * frac)[0]
    return curve["week"].iloc[int(idx[0])] if len(idx) else None


def candidate_recall(cands: pd.DataFrame, curves: pd.DataFrame) -> pd.DataFrame:
    rows = []
    cn = cands.assign(_n=cands["phrase"].map(norm_kw)) if len(cands) else cands
    for p in labels_cfg()["positives"]:
        kw = p["keyword"]
        names = {norm_kw(kw), *(norm_kw(a) for a in p.get("aliases", []))}
        hit = cn[cn["_n"].isin(names)] if len(cands) else cands
        rise = _rise_week(_base_curve(curves, kw)) if len(curves) else None
        row = {"키워드": kw, "후보에 포함": bool(len(hit)),
               "급등 시작 주(데이터랩 곡선)": rise.date() if rise is not None else None,
               "후보 급등 주(YouTube)": None, "차이(주)": None, "제때 잡음": False}
        if len(hit):
            bw = pd.Timestamp(hit["burst_start_week"].min())
            row["후보 급등 주(YouTube)"] = bw.date()
            if rise is not None:
                lag = (bw - pd.Timestamp(rise)).days / 7
                row["차이(주)"] = round(lag, 1)
                row["제때 잡음"] = abs(lag) <= CATCH_TOLERANCE_WEEKS
        rows.append(row)
    return pd.DataFrame(rows)


def lead_time(curves: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for p in labels_cfg()["positives"]:
        c = _base_curve(curves, p["keyword"])
        if c.empty:
            rows.append({"키워드": p["keyword"], "곡선 없음": True})
            continue
        hl = halflife_days(c["week"], c["value_norm"].to_numpy())
        st = rolling_stages(c)
        peak = pd.Timestamp(hl["peak_week"])
        after = st[(st["stage"] == "declining") & (st["week"] > peak - pd.Timedelta(weeks=8))]
        first_dec = pd.Timestamp(after["week"].iloc[0]) if len(after) else None
        rows.append({"키워드": p["keyword"], "실제 정점 주": peak.date(),
                     "declining 첫 판정 주": first_dec.date() if first_dec is not None else None,
                     "판정 지연(주)": None if first_dec is None else (first_dec - peak).days / 7,
                     "정점 전 surging 판정 주 수": int(((st["stage"] == "surging") & (st["week"] <= peak)).sum())})
    return pd.DataFrame(rows)


def negative_false_surging(curves: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for n in labels_cfg()["negatives"]:
        c = _base_curve(curves, n["keyword"])
        if c.empty:
            rows.append({"키워드": n["keyword"], "곡선 없음": True})
            continue
        st = rolling_stages(c)
        vc = st["stage"].value_counts()
        rows.append({"키워드": n["keyword"], "관측 주 수": len(st),
                     "surging(오판)": int(vc.get("surging", 0)), "emerging": int(vc.get("emerging", 0)),
                     "peak": int(vc.get("peak", 0)), "declining": int(vc.get("declining", 0)),
                     "stable": int(vc.get("stable", 0))})
    return pd.DataFrame(rows)


# ---------- 출처·요약 ----------

def _md(df: pd.DataFrame) -> str:
    if df is None or len(df) == 0:
        return "_(없음)_\n"
    return df.to_markdown(index=False) + "\n"


def _provenance(curves: pd.DataFrame, cands: pd.DataFrame) -> list[str]:
    acfg = anchors_cfg()
    lab = labels_cfg()
    n_cache = len(list((CACHE / "datalab").glob("*.json"))) if (CACHE / "datalab").exists() else 0
    prec_file = CACHE / "datalab_precision.json"
    prec = json.loads(prec_file.read_text(encoding="utf-8")) if prec_file.exists() else {}
    yt_prog = STATE / "youtube_progress.json"
    yt_done = len(json.loads(yt_prog.read_text())["done"]) if yt_prog.exists() else 0
    yt_weekly = pd.read_parquet(YOUTUBE_WEEKLY_PARQUET) if YOUTUBE_WEEKLY_PARQUET.exists() else pd.DataFrame()
    L = ["## 1. 데이터가 어디서 어떻게 왔나", ""]
    L += ["### 1-1. 키워드는 두 갈래다", "",
          "| 갈래 | 키워드 | 어떻게 정했나 | 용도 |", "|---|---|---|---|",
          f"| **라벨(정답)** | 양성 {len(lab['positives'])}개: " + ", ".join(p["keyword"] for p in lab["positives"]) +
          f"<br>음성 {len(lab['negatives'])}개: " + ", ".join(n["keyword"] for n in lab["negatives"]) +
          " | `trendlight/config/labels.yaml` 에 **사람이 적어 둔 것**. 양성은 이미 유행이 지난 것으로 알려진 아이템, 음성은 유행 없이 꾸준한 아이템 | 검증 전용. 후보 생성에는 쓰지 않음 |",
          f"| **후보(자동)** | 현재 {len(cands)}개 | YouTube에서 업종별 일반 쿼리(예: \"편의점 신상\")로 주 단위 검색 → 제목·설명에서 명사구 추출 → 주간 빈도가 직전 8주 대비 급등(z≥3 또는 ×3)한 명사구 | 실제 서비스가 쓸 아이템 목록 |", ""]
    L += [f"라벨 키워드에는 지역 시차 확인용으로 `서울/부산/대구/광주/대전 + 키워드` 조합 {len(lab['regions']) * (len(lab['positives']) + len(lab['negatives']))}개를 더했다 (예: \"서울 탕후루\").", ""]
    if len(curves):
        kw_all = sorted(curves["keyword"].unique())
        seg = curves.groupby(["gender", "age"]).size().reset_index(name="행 수")
        weeks = curves["week"]
        L += ["### 1-2. 검색 곡선 (`data/processed/curves.parquet`)", "",
              f"- 출처: **네이버 검색어 트렌드 API (NAVER API HUB)** `POST naverapihub.apigw.ntruss.com/search-trend/v1/search`, `timeUnit=week`",
              f"- 기간: {weeks.min().date()} ~ {weeks.max().date()} ({weeks.nunique()}주)",
              f"- 키워드 {len(kw_all)}개 × 세그먼트 {len(seg)}개(전체 1 + 성별 2 + 연령 6) = {len(curves):,}행",
              f"- 실제 호출 횟수: {n_cache}회 (요청마다 앵커 1 + 키워드 4). 원본 응답 JSON은 `data/cache/datalab/` 에 요청별로 저장돼 있어 재실행 시 재호출하지 않음",
              f"- 반환값 소수 자릿수(첫 호출 기록 `data/cache/datalab_precision.json`): 최대 {prec.get('max_decimals', '?')}자리, 예 {prec.get('sample', '')}", "",
              "**값의 의미**: 네이버는 한 요청 안의 최대값을 100으로 놓은 상대값(`value_raw`)만 준다. 요청이 다르면 100의 기준이 달라 비교가 안 되므로 "
              f"모든 요청에 앵커 키워드 **'{curves['anchor'].iloc[0].split('>')[0]}'** 를 같이 넣고, 앵커의 기간 평균으로 나눈 값을 `value_norm` 으로 저장했다. "
              "즉 `value_norm = 그 주 검색량 / 쿠팡 평균 검색량`. 예: 탕후루 0.079 = 쿠팡 평균의 7.9%.",
              "앵커 대비 너무 작아(요청 내 최대 raw < 1.0) 자릿수가 뭉개지는 키워드는 `쿠팡 → 업종앵커(예: 분식) → 키워드` 2단으로 다시 받아 곱으로 이었다. `anchor` 열이 `쿠팡>분식` 이면 그 경우다.", "",
              "세그먼트별 행 수:", "", _md(seg), ""]
        L += ["**예시 요청 1건** (앵커 + 키워드 4개):", "", "```json",
              json.dumps({"startDate": str(weeks.min().date()), "endDate": str(weeks.max().date()), "timeUnit": "week",
                          "keywordGroups": [{"groupName": "쿠팡", "keywords": ["쿠팡"]}, {"groupName": "탕후루", "keywords": ["탕후루"]}, "..."]},
                         ensure_ascii=False, indent=2), "```", ""]
        L += ["**예시 곡선** — 탕후루, 전체 세그먼트, 정점 전후:", ""]
        t = _base_curve(curves, "탕후루")
        if len(t):
            i = t.reset_index(drop=True)["value_norm"].idxmax()
            ex = t.reset_index(drop=True).iloc[max(0, i - 3): i + 5][["week", "value_raw", "value_norm", "anchor"]].copy()
            ex["week"] = ex["week"].dt.date
            L += [_md(ex.round(4)), ""]
        L += [f"사람이 열어볼 수 있는 표: `{CURVES_CSV.relative_to(REPORTS.parent)}` (주 × 키워드, value_norm, 전체 세그먼트), `{SUMMARY_CSV.relative_to(REPORTS.parent)}` (키워드별 정점·반감기 요약)", ""]
    L += ["### 1-3. 후보 원천 (`data/processed/youtube_weekly.parquet`)", "",
          f"- YouTube Data API v3 `search.list` (regionCode=KR, 주 단위 publishedAfter/Before). 완료 태스크(업종·쿼리·주) {yt_done}개, 하루 한도 100회",
          f"- 수집된 주: {sorted(yt_weekly['week'].dt.date.unique()) if len(yt_weekly) else '없음'}",
          f"- 명사구 {yt_weekly['phrase'].nunique() if len(yt_weekly) else 0}개, 급등 후보 {len(cands)}개",
          "- 급등 탐지는 직전 8주 기준선이 필요하므로 **최소 9주치가 쌓여야 첫 후보가 나온다.** 하루 100회로는 약 2주치/일 → 5일 뒤부터 후보 생성.", ""]
    return L


def _export_csvs(curves: pd.DataFrame) -> None:
    base = curves[(curves["gender"] == "all") & (curves["age"] == "all")]
    wide = base.pivot_table(index="week", columns="keyword", values="value_norm")
    wide.index = wide.index.date
    wide.round(5).to_csv(CURVES_CSV, encoding="utf-8-sig")
    rows = []
    labmeta = {p["keyword"]: p for p in labels_cfg()["positives"]}
    for kw, g in base.groupby("keyword"):
        hl = halflife_days(g["week"], g["value_norm"].to_numpy())
        rows.append({"keyword": kw, "source": g["source"].iloc[0], "industry": g["industry"].iloc[0],
                     "anchor": g["anchor"].iloc[0], "n_weeks": len(g), "mean_norm": g["value_norm"].mean(),
                     "peak_week": hl["peak_week"].date() if hl["peak_week"] is not None else None,
                     "peak_norm": hl["peak_value"], "halflife_days_weekly": hl["halflife_days"],
                     "expected_halflife_days": labmeta.get(kw, {}).get("halflife_days")})
    pd.DataFrame(rows).round(5).to_csv(SUMMARY_CSV, index=False, encoding="utf-8-sig")


def build_report() -> str:
    cands = pd.read_parquet(CANDIDATES_PARQUET) if CANDIDATES_PARQUET.exists() else pd.DataFrame()
    curves = pd.read_parquet(CURVES_PARQUET) if CURVES_PARQUET.exists() else pd.DataFrame()
    client = curves["source_client"].iloc[0] if len(curves) and "source_client" in curves else "none"
    if len(curves):
        _export_csvs(curves)
    L = ["# 유행 신호등 엔진 C — 1단계 평가 리포트", "",
         f"생성 {dt.datetime.now():%Y-%m-%d %H:%M} · 데이터 클라이언트 `{client}`", ""]
    if client == "synthetic":
        L += ["> **주의: curves.parquet가 합성 데이터(synthetic)입니다.** 파이프라인 배관 확인용이며 수치는 실제 검색 트렌드가 아닙니다.", ""]
    L += ["## 0. 이 리포트가 답하는 질문", "",
          "엔진 C는 \"이 아이템의 유행이 지금 어느 단계인가\"를 검색량 곡선으로 판정한다. 1단계에서는 그 판정 장치가 **정답을 아는 과거 사례**(라벨)에서 맞는지를 본다.", "",
          "| 절 | 질문 | 쓰는 데이터 |", "|---|---|---|",
          "| (a) | 후보 자동 생성기가 실제 유행했던 7개를 사람 개입 없이 찾아냈는가 | YouTube 후보 vs 라벨 |",
          "| (b) | 우리가 계산한 반감기가 기사(코리아헤럴드 2026-02-08)의 반감기와 맞는가 | 라벨 4개 검색 곡선 |",
          "| (c) | 단계 판정이 정점을 지난 뒤 얼마나 빨리 '하락'이라고 말하는가 | 라벨 양성 7개 검색 곡선 |",
          "| (d) | 유행이 아닌 안정 품목을 '급등'이라고 오판하는가 | 라벨 음성 7개 검색 곡선 |",
          "| (e) | 6개월 뒤에도 수요가 남는지를 예측 모델(TimesFM)이 맞히는가 | 라벨 14개 + 비빔밥 곡선 |", ""]
    L += _provenance(curves, cands)
    # (a)
    L += ["## 2. 결과", "", "### (a) 후보 생성 재현율 — 라벨 양성 7개", "",
          "**읽는 법**: '급등 시작 주'는 데이터랩 곡선에서 값이 정점의 20%를 처음 넘은 주. '후보 급등 주'는 YouTube 명사구 빈도가 급등한 주. "
          f"둘의 차이가 ±{CATCH_TOLERANCE_WEEKS}주 이내면 '제때 잡음'.", ""]
    rc = candidate_recall(cands, curves)
    L += [_md(rc), f"**후보 포함 {int(rc['후보에 포함'].sum())}/7, 제때 잡음 {int(rc['제때 잡음'].sum())}/7**", ""]
    if len(cands) == 0:
        L += ["→ 아직 후보가 0개라 전부 False다. YouTube 데이터가 9주 이상 쌓이면 다시 평가한다. "
              "또한 크로플(2020)·탕후루(2023) 등 과거 유행은 YouTube 수집 범위(최근 104주)에 들어오지 않을 수 있어, 그 경우 빅카인즈(뉴스) 원천이 필요하다.", ""]
    # (b)
    L += ["### (b) 반감기 재현", "",
          "**정의**: 정점(최대값 시점)에서 값이 정점의 50% 이하로 처음 떨어질 때까지의 일수. **기대값**은 기사에 실린 수치.", "",
          "**열 설명**: `weekly_raw` 주간 곡선 그대로 · `weekly_smooth` 주간+스플라인 평활 · `weekly_detrended` 평활 후 추세 제거 · "
          "`daily_interp` 주간을 일 단위로 선형보간 · `daily_raw` 일간 곡선 그대로(`collect-daily`로 별도 수집, `data/processed/curves_daily.parquet`) · `daily_smooth7` 일간+7일 이동평균", ""]
    if len(curves):
        from ..datalab.collect import CURVES_DAILY_PARQUET
        daily = pd.read_parquet(CURVES_DAILY_PARQUET) if CURVES_DAILY_PARQUET.exists() else None
        table, maes = hl_evaluate(curves, daily=daily)
        tb = table.drop(columns=["missing"]).rename(columns={"keyword": "키워드", "expected": "기대값(일)", "peak_week": "정점 주"})
        if "정점 주" in tb:
            tb["정점 주"] = pd.to_datetime(tb["정점 주"]).dt.date
        L += [_md(tb), "정의 변형별 MAE(일, 작을수록 좋음):", "",
              _md(pd.DataFrame([{"정의": k, "MAE(일)": v} for k, v in maes.items()])),
              "**해석**", "", *[f"- {n}" for n in diagnosis(table, maes)], ""]
    else:
        L += ["_curves.parquet 없음_", ""]
    # (c)
    L += ["### (c) 롤링 단계 판정 리드타임", "",
          "**읽는 법**: 각 주 t에서 t까지의 데이터만 보고 emerging/surging/peak/declining/stable 을 판정한다(미래 정보 없음). "
          "'판정 지연'은 실제 정점 주에서 declining 첫 판정 주까지 몇 주 걸렸는지. 작을수록 빨리 경고한 것이고 음수면 정점 전에 하락이라고 한 것.", ""]
    L += [_md(lead_time(curves)) if len(curves) else "_curves.parquet 없음_\n", ""]
    # (d)
    L += ["### (d) 음성 7개 surging 오판", "",
          "**읽는 법**: 유행이 없는 품목이므로 surging 판정은 모두 오판. 각 열은 350주 중 그 단계로 판정된 주 수.", ""]
    if len(curves):
        neg = negative_false_surging(curves)
        L += [_md(neg), f"**surging 오판 총 {int(neg['surging(오판)'].fillna(0).sum())}주 / 키워드 {int((neg['surging(오판)'].fillna(0) > 0).sum())}개**", ""]
    else:
        L += ["_curves.parquet 없음_", ""]
    # (e) TimesFM
    from ..lifecycle.forecast import BACKTEST_PARQUET, FORECASTS_PARQUET, GREEN_MIN, RED_MAX, auc, per_keyword_metrics
    L += ["### (e) 6개월 뒤 유지 확률 — TimesFM 백테스트", "",
          "**질문**: 어떤 주까지의 곡선만 보고 \"26주 뒤 검색량이 지금(최근 4주 평균)의 70% 이상인가\"를 맞히는가. 창업 준비 기간(3~6개월)을 고려한 질문이라 규칙의 '지금 단계'와 다르다.", "",
          "**방법**: Google TimesFM 2.5(200M, 사전학습 시계열 모델, 추가 학습 없음)에 곡선을 넣어 26주 분위수 예측을 받고, "
          "목표 구간(23~26주) 예측 분위수에서 P(유지)를 읽는다. 4주 간격 rolling origin, 미래 정보 없음. "
          f"신호등: P ≥ {GREEN_MIN} 초록, P < {RED_MAX} 빨강, 사이 노랑. 규칙 단계는 emerging=1 … declining=0 점수로 같은 AUC를 계산.", ""]
    if BACKTEST_PARQUET.exists():
        bt = pd.read_parquet(BACKTEST_PARQUET)
        ok = bt.dropna(subset=["actual_ratio"])
        rs = ok["rule_stage"].map({"declining": 0, "peak": 0.25, "surging": 0.5, "stable": 0.75, "emerging": 1.0})
        red, grn = ok["p_keep"] < RED_MAX, ok["p_keep"] >= GREEN_MIN
        summ = pd.DataFrame([
            {"지표": "표본 수 (origin)", "값": len(ok)},
            {"지표": "실제 유지 비율", "값": round(ok["actual_keep"].mean(), 2)},
            {"지표": "AUC — TimesFM P(유지)", "값": round(auc(ok["actual_keep"], ok["p_keep"]), 3)},
            {"지표": "AUC — 규칙 단계", "값": round(auc(ok["actual_keep"], rs), 3)},
            {"지표": f"빨강(P<{RED_MAX}) 비중 / 그중 실제 하락", "값": f"{red.mean():.2f} / {(~ok['actual_keep'][red]).mean():.2f}"},
            {"지표": f"초록(P≥{GREEN_MIN}) 비중 / 그중 실제 유지", "값": f"{grn.mean():.2f} / {ok['actual_keep'][grn].mean():.2f}"},
            {"지표": "실제 하락 중 빨강으로 잡은 비율", "값": round((red & ~ok["actual_keep"]).sum() / max((~ok["actual_keep"]).sum(), 1), 2)},
        ])
        L += [_md(summ), "키워드별:", "", _md(per_keyword_metrics(bt)),
              "**해석**: 표본 대부분이 '유지'라 안정 품목이 성적을 끌어올린다. 유행 곡선(크로플·소금빵)에서는 약하고, 급등 초기에 지나치게 비관적일 수 있다. "
              "규칙은 이 질문에 대해 무작위 수준이므로 '지금 단계' 설명용으로만 쓴다.", ""]
    else:
        L += ["_timesfm_backtest.parquet 없음 — `python -m trendlight forecast` 실행_", ""]
    if FORECASTS_PARQUET.exists():
        fc = pd.read_parquet(FORECASTS_PARQUET).groupby("keyword").first().reset_index()
        fc = fc[fc["source"].isin(["label", "demo"])][["keyword", "p_keep", "median_ratio", "signal"]].rename(
            columns={"keyword": "키워드", "p_keep": "P(6개월 뒤 유지)", "median_ratio": "예측 중앙값 / 현재", "signal": "신호"})
        L += ["현재 시점 예측 (라벨·데모 키워드):", "", _md(fc.round(3)), ""]
    L += ["## 3. 파일 위치", "", "| 파일 | 내용 |", "|---|---|",
          "| `data/processed/curves.parquet` | 주간 검색 곡선 전체 (keyword, week, value_raw, value_norm, gender, age, anchor, industry, source) |",
          "| `data/processed/curves_daily.parquet` | 반감기 라벨 4개 일간 곡선 |",
          "| `data/processed/youtube_docs.parquet` / `youtube_weekly.parquet` | YouTube 검색 결과 원문 / 명사구 주간 빈도 |",
          "| `data/processed/candidates.parquet` | 급등 후보 |",
          "| `data/processed/stages.parquet` | 키워드별 주간 단계 판정 |",
          "| `data/processed/forecasts.parquet` / `timesfm_backtest.parquet` | TimesFM 26주 예측 / 백테스트 |",
          "| `data/cache/datalab/*.json` | 데이터랩 원본 응답 (요청 바디 포함) |",
          "| `reports/label_curves_weekly.csv`, `reports/label_summary.csv` | 엑셀로 열어볼 수 있는 곡선·요약 |", ""]
    text = "\n".join(L)
    REPORT.write_text(text, encoding="utf-8")
    log.info("리포트 저장: %s", REPORT)
    return text
