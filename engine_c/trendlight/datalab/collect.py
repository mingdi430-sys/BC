"""곡선 수집: candidates.parquet 후보 + labels.yaml 라벨 → curves.parquet

세그먼트: 전체 / 성별(m,f) / 연령대(카드 AGE_CD 1~6 → 데이터랩 ages 묶음) 각각.
앵커: 범용 앵커 1개를 모든 요청에 포함. 아이템 max raw < min_item_max 이면 2단 앵커로 자동 전환.
캐시: client가 요청 단위로 캐시하므로 재실행 시 재호출 없음. 쿼터 초과 시 부분 결과를 저장하고 종료.
"""
from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass, field

import pandas as pd

from ..common.paths import CANDIDATES_PARQUET, CURVES_PARQUET
from ..common.quota import QuotaExceeded
from ..config import anchors as anchors_cfg, industries as industries_cfg, labels as labels_cfg
from .client import BaseDatalabClient
from .normalize import apply_chain, item_max_raw, link_factor, normalize_response

log = logging.getLogger(__name__)


@dataclass
class KeywordSpec:
    keyword: str
    industry: str | None
    source: str            # candidate | label | label_region
    base_keyword: str | None = None
    query_keywords: list[str] = field(default_factory=list)

    def group(self) -> dict:
        kws = self.query_keywords or [self.keyword]
        return {"groupName": self.keyword, "keywords": kws[:20]}


def build_segments() -> list[dict]:
    icfg = industries_cfg()
    segs = [{"gender": "all", "age": "all", "params": {}}]
    for g_card, g_dl in icfg["gender_map_card_to_datalab"].items():
        segs.append({"gender": g_dl, "age": "all", "params": {"gender": g_dl}})
    for a_card, a_dl in icfg["age_map_card_to_datalab"].items():
        segs.append({"gender": "all", "age": a_card, "params": {"ages": a_dl}})
    return segs


def build_keyword_specs(include_candidates: bool = True, variants: bool = False) -> list[KeywordSpec]:
    specs: dict[str, KeywordSpec] = {}
    lab = labels_cfg()
    icfg = industries_cfg()

    def add(spec: KeywordSpec):
        if spec.keyword not in specs:
            specs[spec.keyword] = spec

    if include_candidates and CANDIDATES_PARQUET.exists():
        cand = pd.read_parquet(CANDIDATES_PARQUET)
        for _, r in cand.iterrows():
            ind = r["industry"]
            rules = icfg["industries"].get(ind, {}).get("suffix_rules") or \
                icfg["default_suffix_rules"][icfg["industries"][ind]["group"]]
            vs = rules["variants"] if variants else rules["variants"][:1]
            for v in vs:
                add(KeywordSpec(v.format(item=r["phrase"]), ind, "candidate", base_keyword=r["phrase"]))
    else:
        log.warning("candidates.parquet 없음 → 라벨 키워드만 수집")

    for p in lab["positives"] + lab["negatives"]:
        kw = p["keyword"]
        add(KeywordSpec(kw, p.get("industry"), "label", query_keywords=[kw, *p.get("aliases", [])]))
        for region in lab.get("regions", []):
            add(KeywordSpec(f"{region} {kw}", p.get("industry"), "label_region", base_keyword=kw))
    return list(specs.values())


def probe_anchor(client: BaseDatalabClient, start: str, end: str) -> str:
    """범용 앵커 후보를 한 요청에 넣어 결측(0) 없는 첫 후보를 채택. 정밀도 로그는 client가 남긴다."""
    acfg = anchors_cfg()
    cands = acfg["general_anchors"][:5]
    resp = client.search([{"groupName": a, "keywords": [a]} for a in cands], start, end)
    df = client.to_frame(resp)
    for a in cands:
        s = df[df["keyword"] == a]["value_raw"]
        if len(s) and (s > 0).all():
            log.info("범용 앵커 채택: %s (평균 %.3f, 최소 %.3f)", a, s.mean(), s.min())
            return a
    log.warning("결측 없는 앵커가 없어 첫 후보 사용: %s", cands[0])
    return cands[0]


class Collector:
    def __init__(self, client: BaseDatalabClient, start: str | None = None, end: str | None = None):
        self.client = client
        acfg = anchors_cfg()
        self.acfg = acfg
        self.method = acfg.get("normalize_method", "mean")
        self.start = start or acfg["request"]["start_date"]
        self.end = end or dt.date.today().isoformat()
        self.max_items = acfg["request"]["max_groups"] - 1
        self.min_item_max = acfg["two_stage"]["min_item_max"]
        self.ind_anchor = acfg["two_stage"]["industry_anchors"]
        self.fallback_ind_anchor = acfg["two_stage"]["fallback_industry_anchor"]
        self.general_anchor: str | None = None
        self._link_cache: dict[tuple, float | pd.Series] = {}

    def _search_df(self, groups: list[dict], params: dict) -> pd.DataFrame:
        resp = self.client.search(groups, self.start, self.end, time_unit="week", **params)
        return self.client.to_frame(resp)

    def _link(self, ind_anchor: str, params: dict, seg_key: tuple) -> float | pd.Series:
        key = (ind_anchor, seg_key)
        if key not in self._link_cache:
            df = self._search_df([{"groupName": self.general_anchor, "keywords": [self.general_anchor]},
                                  {"groupName": ind_anchor, "keywords": [ind_anchor]}], params)
            self._link_cache[key] = link_factor(df, self.general_anchor, ind_anchor, self.method)
        return self._link_cache[key]

    def collect_segment(self, specs: list[KeywordSpec], seg: dict) -> pd.DataFrame:
        params, seg_key = seg["params"], (seg["gender"], seg["age"])
        ga = self.general_anchor
        frames = []
        stage2: dict[str, list[KeywordSpec]] = {}
        for i in range(0, len(specs), self.max_items):
            batch = specs[i:i + self.max_items]
            groups = [{"groupName": ga, "keywords": [ga]}] + [s.group() for s in batch]
            df = self._search_df(groups, params)
            dfn = normalize_response(df, ga, self.method)
            for s in batch:
                if item_max_raw(df, s.keyword) < self.min_item_max:
                    ia = self.ind_anchor.get(s.industry or "", self.fallback_ind_anchor)
                    stage2.setdefault(ia, []).append(s)
                    log.info("2단 앵커 전환: %s (max raw %.4f < %.2f) → %s>%s", s.keyword,
                             item_max_raw(df, s.keyword), self.min_item_max, ga, ia)
                else:
                    part = dfn[dfn["keyword"] == s.keyword].copy()
                    part["value_raw_stage1"] = part["value_raw"]
                    frames.append(self._tag(part, s, seg))
        for ia, s2 in stage2.items():
            factor = self._link(ia, params, seg_key)
            for i in range(0, len(s2), self.max_items):
                batch = s2[i:i + self.max_items]
                groups = [{"groupName": ia, "keywords": [ia]}] + [s.group() for s in batch]
                df = self._search_df(groups, params)
                dfn = apply_chain(normalize_response(df, ia, self.method), factor, ga, ia)
                for s in batch:
                    part = dfn[dfn["keyword"] == s.keyword].copy()
                    frames.append(self._tag(part, s, seg))
        return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()

    @staticmethod
    def _tag(part: pd.DataFrame, s: KeywordSpec, seg: dict) -> pd.DataFrame:
        part["gender"] = seg["gender"]
        part["age"] = seg["age"]
        part["industry"] = s.industry
        part["source"] = s.source
        part["base_keyword"] = s.base_keyword or s.keyword
        return part

    def run(self, specs: list[KeywordSpec], segments: list[dict] | None = None) -> pd.DataFrame:
        segments = segments or build_segments()
        self.general_anchor = probe_anchor(self.client, self.start, self.end)
        frames = []
        try:
            for seg in segments:
                log.info("세그먼트 %s/%s: 키워드 %d개", seg["gender"], seg["age"], len(specs))
                frames.append(self.collect_segment(specs, seg))
        except QuotaExceeded as e:
            log.error("쿼터 초과로 중단: %s — 부분 결과 저장 후 종료. 내일 같은 명령을 다시 실행하면 캐시에서 이어간다.", e)
        out = pd.concat([f for f in frames if len(f)], ignore_index=True) if frames else pd.DataFrame()
        if len(out):
            out["source_client"] = self.client.name
            cols = ["keyword", "base_keyword", "week", "value_raw", "value_norm", "gender", "age", "anchor",
                    "industry", "source", "source_client"]
            out = out[cols]
            if CURVES_PARQUET.exists():  # 기존 파일과 합친다 (같은 키워드·세그먼트는 이번 결과로 교체, 나머지는 유지)
                old = pd.read_parquet(CURVES_PARQUET)
                key = ["keyword", "gender", "age"]
                done = out[key].drop_duplicates()
                old = old.merge(done.assign(_new=1), on=key, how="left")
                old = old[old["_new"].isna()].drop(columns="_new")
                out = pd.concat([old[cols], out], ignore_index=True)
            out = out.sort_values(["keyword", "gender", "age", "week"]).reset_index(drop=True)
            out.to_parquet(CURVES_PARQUET, index=False)
            log.info("curves.parquet 저장: %d행, 키워드 %d개", len(out), out["keyword"].nunique())
        return out


CURVES_DAILY_PARQUET = CURVES_PARQUET.with_name("curves_daily.parquet")


def collect_daily_labels(client: BaseDatalabClient, start: str | None = None, end: str | None = None) -> pd.DataFrame:
    """반감기 기대값이 있는 라벨 키워드만 timeUnit=date 로 수집 (앵커 1 + 아이템 4 = 1회 호출).
    기사 원자료(일간)와의 정의 차이를 확인하는 용도. 결과: curves_daily.parquet"""
    acfg = anchors_cfg()
    start = start or acfg["request"]["start_date"]
    end = end or dt.date.today().isoformat()
    lab = [p for p in labels_cfg()["positives"] if p.get("halflife_days")]
    ga = probe_anchor(client, start, end)
    frames = []
    for i in range(0, len(lab), acfg["request"]["max_groups"] - 1):
        batch = lab[i:i + acfg["request"]["max_groups"] - 1]
        groups = [{"groupName": ga, "keywords": [ga]}] + [
            {"groupName": p["keyword"], "keywords": [p["keyword"], *p.get("aliases", [])]} for p in batch]
        resp = client.search(groups, start, end, time_unit="date")
        df = normalize_response(client.to_frame(resp), ga, acfg.get("normalize_method", "mean"))
        frames.append(df[df["keyword"] != ga])
    out = pd.concat(frames, ignore_index=True).rename(columns={"week": "date"})
    out["source_client"] = client.name
    out.to_parquet(CURVES_DAILY_PARQUET, index=False)
    log.info("curves_daily.parquet 저장: %d행, 키워드 %d개", len(out), out["keyword"].nunique())
    return out
