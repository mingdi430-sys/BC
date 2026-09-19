"""네이버 검색어 트렌드(데이터랩) API 래퍼 — NAVER API HUB(ncloud) 기준.

문서: https://api.ncloud-docs.com/docs/naver-api-hub-search-trend
  POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search
  헤더: X-NCP-APIGW-API-KEY-ID (Client ID), X-NCP-APIGW-API-KEY (Client Secret), Content-Type: application/json
  바디: startDate, endDate(yyyy-mm-dd, 2016-01-01 이후), timeUnit(date|week|month),
        keywordGroups[≤5]{groupName, keywords[≤20]}, device(pc|mo), gender(m|f), ages[1..11]
  응답: {startDate,endDate,timeUnit,results:[{title,keywords,data:[{period,ratio}]}]}, 최대값=100
개발자센터(openapi.naver.com)용 엔드포인트/헤더는 쓰지 않는다.

- 환경변수 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (API HUB의 Client ID / Client Secret)
- 요청당 키워드 그룹 최대 5개 (앵커 1 + 아이템 4)
- timeUnit=week, gender(m/f), ages 옵션
- 재시도·백오프, 일일 호출 카운터(기본 1000/일), 디스크 캐시
- 첫 실제 호출 후 반환값 소수 자릿수를 로그 + data/cache/datalab_precision.json 에 기록
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import time
from typing import Iterable

import pandas as pd
import requests

from ..common.cache import CACHE, cached
from ..common.quota import DailyQuota

log = logging.getLogger(__name__)

API_URL = "https://naverapihub.apigw.ntruss.com/search-trend/v1/search"
PRECISION_FILE = CACHE / "datalab_precision.json"
MAX_GROUPS = 5


class MissingCredentials(RuntimeError):
    pass


def _decimals(x: float) -> int:
    s = repr(float(x))
    if "e" in s or "." not in s:
        return 0
    frac = s.split(".")[1].rstrip("0")
    return len(frac)


def response_precision(resp: dict) -> dict:
    """응답 내 ratio 값들의 소수 자릿수 분포."""
    decs = [_decimals(d["ratio"]) for r in resp.get("results", []) for d in r.get("data", [])]
    if not decs:
        return {"n": 0}
    return {
        "n": len(decs),
        "max_decimals": max(decs),
        "min_decimals": min(decs),
        "unique_decimals": sorted(set(decs)),
        "sample": [d["ratio"] for d in resp["results"][0]["data"][:5]],
    }


def record_precision(resp: dict, context: str = "", path=PRECISION_FILE) -> dict:
    """첫 실제 응답의 소수 자릿수를 기록. 이미 기록돼 있으면 건너뛴다."""
    info = response_precision(resp)
    info["context"] = context
    info["recorded_at"] = dt.datetime.now().isoformat(timespec="seconds")
    if not path.exists():
        path.write_text(json.dumps(info, ensure_ascii=False, indent=2))
        log.info("[데이터랩 정밀도] 첫 응답 소수 자릿수: %s → %s", info, path.name)
    return info


class BaseDatalabClient:
    """공통 인터페이스. 실제/합성 클라이언트가 상속."""

    name = "base"

    def search(
        self,
        keyword_groups: list[dict],
        start: str,
        end: str,
        time_unit: str = "week",
        gender: str | None = None,
        ages: Iterable[str] | None = None,
        device: str | None = None,
    ) -> dict:
        raise NotImplementedError

    @staticmethod
    def to_frame(resp: dict) -> pd.DataFrame:
        rows = []
        for r in resp.get("results", []):
            for d in r.get("data", []):
                rows.append({"keyword": r["title"], "week": pd.Timestamp(d["period"]), "value_raw": float(d["ratio"])})
        return pd.DataFrame(rows, columns=["keyword", "week", "value_raw"])


class DatalabClient(BaseDatalabClient):
    name = "naver"

    def __init__(self, client_id: str, client_secret: str, daily_limit: int = 1000,
                 max_retries: int = 5, backoff: float = 1.5):
        self.client_id = client_id
        self.client_secret = client_secret
        self.quota = DailyQuota("naver_datalab", daily_limit)
        self.max_retries = max_retries
        self.backoff = backoff
        self.session = requests.Session()
        self.session.headers.update({
            "X-NCP-APIGW-API-KEY-ID": client_id,
            "X-NCP-APIGW-API-KEY": client_secret,
            "Content-Type": "application/json",
        })

    @classmethod
    def from_env(cls, **kw) -> "DatalabClient":
        cid, sec = os.getenv("NAVER_CLIENT_ID"), os.getenv("NAVER_CLIENT_SECRET")
        if not cid or not sec:
            raise MissingCredentials("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다.")
        return cls(cid, sec, **kw)

    def _post(self, body: dict) -> dict:
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            self.quota.check()
            try:
                r = self.session.post(API_URL, data=json.dumps(body, ensure_ascii=False).encode("utf-8"), timeout=30)
                self.quota.consume()
                if r.status_code == 200:
                    return r.json()
                if r.status_code == 429 or r.status_code >= 500:
                    last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
                else:
                    raise RuntimeError(f"데이터랩 오류 HTTP {r.status_code}: {r.text[:300]}")
            except requests.RequestException as e:
                last_err = e
            wait = self.backoff ** attempt
            log.warning("데이터랩 재시도 %d/%d (%s), %.1fs 대기", attempt + 1, self.max_retries, last_err, wait)
            time.sleep(wait)
        raise RuntimeError(f"데이터랩 호출 실패: {last_err}")

    def search(self, keyword_groups, start, end, time_unit="week", gender=None, ages=None, device=None) -> dict:
        if len(keyword_groups) > MAX_GROUPS:
            raise ValueError(f"키워드 그룹은 최대 {MAX_GROUPS}개")
        body = {
            "startDate": start,
            "endDate": end,
            "timeUnit": time_unit,
            "keywordGroups": [{"groupName": g["groupName"], "keywords": list(g["keywords"])} for g in keyword_groups],
        }
        if gender:
            body["gender"] = gender
        if ages:
            body["ages"] = [str(a) for a in ages]
        if device:
            body["device"] = device
        resp, hit = cached("datalab", body, lambda: self._post(body))
        if not hit:
            record_precision(resp, context=f"groups={[g['groupName'] for g in keyword_groups]}")
            log.info("데이터랩 호출 (오늘 %d/%d): %s", self.quota.used, self.quota.limit,
                     [g["groupName"] for g in keyword_groups])
        return resp
