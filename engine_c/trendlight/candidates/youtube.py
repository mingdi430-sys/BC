"""YouTube Data API v3 로 업종별 일반 쿼리를 주 단위로 검색해 명사구 주간 출현 빈도 테이블을 만든다.

쿼터: 하루 10,000 유닛, search.list = 100 유닛 → 하루 100회.
업종별 균등 배분(라운드로빈), 최근 주부터 과거로. 진행 상태는 data/state/youtube_progress.json 에 저장해
다음 날 이어서 돈다. 응답은 data/cache/youtube/ 에 캐시.
출력: data/processed/youtube_weekly.parquet (industry, phrase, week, count, source='youtube')
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import time
from collections import Counter

import pandas as pd

from ..common.cache import cached
from ..common.paths import STATE, YOUTUBE_WEEKLY_PARQUET
from ..common.quota import DailyQuota, QuotaExceeded
from ..config import industries as industries_cfg
from .phrases import extract_phrases, is_domestic

log = logging.getLogger(__name__)

SEARCH_COST = 100
DAILY_UNITS = 10_000
PROGRESS = STATE / "youtube_progress.json"
DOCS_PARQUET = YOUTUBE_WEEKLY_PARQUET.with_name("youtube_docs.parquet")


class MissingCredentials(RuntimeError):
    pass


def load_keys() -> list[str]:
    """YOUTUBE_API_KEYS (쉼표 구분, 팀원 키 로테이션) 우선, 없으면 YOUTUBE_API_KEY."""
    multi = os.getenv("YOUTUBE_API_KEYS", "")
    keys = [k.strip() for k in multi.split(",") if k.strip()]
    single = os.getenv("YOUTUBE_API_KEY", "").strip()
    if single and single not in keys:
        keys.insert(0, single)
    return keys


def week_windows(weeks_back: int, end: dt.date | None = None) -> list[tuple[str, str]]:
    """최근 주부터 과거로 (publishedAfter, publishedBefore) RFC3339 쌍."""
    end = end or dt.date.today()
    monday = end - dt.timedelta(days=end.weekday())
    out = []
    for k in range(weeks_back):
        b = monday - dt.timedelta(weeks=k)
        a = b - dt.timedelta(weeks=1)
        out.append((f"{a.isoformat()}T00:00:00Z", f"{b.isoformat()}T00:00:00Z"))
    return out


def plan_tasks(weeks_back: int) -> list[dict]:
    """(업종, 쿼리, 주) 태스크를 업종 라운드로빈 + 최근 주 우선으로 정렬."""
    icfg = industries_cfg()["industries"]
    windows = week_windows(weeks_back)
    per_ind = {ind: [(q, a, b) for (a, b) in windows for q in c["queries"]] for ind, c in icfg.items()}
    tasks = []
    while any(per_ind.values()):
        for ind in icfg:
            if per_ind[ind]:
                q, a, b = per_ind[ind].pop(0)
                tasks.append({"industry": ind, "q": q, "after": a, "before": b})
    return tasks


def _load_progress() -> dict:
    return json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {"done": []}


def _save_progress(p: dict) -> None:
    PROGRESS.write_text(json.dumps(p, ensure_ascii=False))


def _task_key(t: dict) -> str:
    return f"{t['industry']}|{t['q']}|{t['after']}"


class _Key:
    def __init__(self, idx: int, key: str):
        self.idx, self.key = idx, key
        # 첫 키는 기존 상태 파일(quota_youtube.json)을 그대로 이어 쓴다
        self.quota = DailyQuota("youtube" if idx == 0 else f"youtube_{idx + 1}", DAILY_UNITS, SEARCH_COST)
        self.exhausted = False
        self._svc = None

    def service(self):
        if self._svc is None:
            from googleapiclient.discovery import build
            self._svc = build("youtube", "v3", developerKey=self.key, cache_discovery=False)
        return self._svc

    @property
    def remaining_calls(self) -> int:
        return 0 if self.exhausted else self.quota.remaining // SEARCH_COST


class YouTubeCollector:
    """여러 API 키(팀원 각자의 Google Cloud 프로젝트)를 돌려 쓴다. 쿼터는 프로젝트 단위이므로
    같은 프로젝트에서 만든 키 여러 개는 의미가 없다."""

    def __init__(self, api_keys: list[str] | None = None, max_results: int = 50, pace_seconds: float = 1.0):
        keys = api_keys if api_keys is not None else load_keys()
        self.keys = [_Key(i, k) for i, k in enumerate(keys)]
        self.max_results = max_results
        self.pace_seconds = pace_seconds  # 분당 한도(rateLimitExceeded) 회피용 호출 간격

    def _pick_key(self) -> _Key:
        if not self.keys:
            raise MissingCredentials("YOUTUBE_API_KEY 또는 YOUTUBE_API_KEYS 환경변수가 없습니다.")
        for k in self.keys:
            if k.remaining_calls > 0:
                return k
        raise QuotaExceeded("youtube: 모든 키의 일일 쿼터 소진 (" + ", ".join(
            f"키{k.idx + 1} {k.quota.used}/{k.quota.limit}" for k in self.keys) + ")")

    @property
    def remaining_calls_today(self) -> int:
        return sum(k.remaining_calls for k in self.keys)

    def search(self, q: str, after: str, before: str) -> list[dict]:
        params = {"q": q, "publishedAfter": after, "publishedBefore": before, "type": "video",
                  "regionCode": "KR", "relevanceLanguage": "ko", "maxResults": self.max_results, "part": "snippet"}

        def call():
            from googleapiclient.errors import HttpError
            while True:
                key = self._pick_key()
                for attempt in range(6):
                    try:
                        resp = key.service().search().list(**params).execute()
                        break
                    except HttpError as e:
                        reason = ""
                        try:
                            reason = e.error_details[0].get("reason", "") if e.error_details else ""
                        except Exception:  # noqa: BLE001
                            pass
                        if e.resp.status == 403 and reason in ("quotaExceeded", "dailyLimitExceeded"):
                            key.exhausted = True
                            log.warning("YouTube 키%d 쿼터 소진(API 응답 %s) → 다음 키로", key.idx + 1, reason)
                            break
                        if e.resp.status in (429, 500, 503) or reason == "rateLimitExceeded":
                            wait = min(60, 5 * 2 ** attempt)
                            log.warning("YouTube %s (%s) — %ds 대기 후 재시도 %d/6", e.resp.status, reason, wait, attempt + 1)
                            time.sleep(wait)
                            continue
                        raise
                    except (TimeoutError, OSError, ConnectionError) as e:  # 네트워크 일시 오류(SSL read timeout 등)
                        wait = min(60, 5 * 2 ** attempt)
                        log.warning("YouTube 네트워크 오류 %s — %ds 대기 후 재시도 %d/6", type(e).__name__, wait, attempt + 1)
                        time.sleep(wait)
                        continue
                else:
                    raise RuntimeError("YouTube 재시도 초과")
                if key.exhausted:
                    continue
                key.quota.consume()
                time.sleep(self.pace_seconds)
                return [{"videoId": it["id"].get("videoId"), "title": it["snippet"]["title"],
                         "description": it["snippet"].get("description", ""),
                         "publishedAt": it["snippet"]["publishedAt"],
                         "channelId": it["snippet"].get("channelId", ""),
                         "channelTitle": it["snippet"].get("channelTitle", "")} for it in resp.get("items", [])]

        items, hit = cached("youtube", params, call)
        if not hit:
            log.info("YouTube 호출 (오늘 남은 %d회): %s %s", self.remaining_calls_today, q, after[:10])
        return items

    def run(self, weeks_back: int = 52, max_calls: int | None = None) -> pd.DataFrame:
        tasks = plan_tasks(weeks_back)
        prog = _load_progress()
        done = set(prog["done"])
        todo = [t for t in tasks if _task_key(t) not in done]
        log.info("YouTube 태스크 %d개 중 남은 %d개 (주 %d, 업종 11, 키 %d개, 오늘 가능 %d회)",
                 len(tasks), len(todo), weeks_back, len(self.keys), self.remaining_calls_today)
        calls = 0
        try:
            for t in todo:
                if max_calls is not None and calls >= max_calls:
                    break
                items = self.search(t["q"], t["after"], t["before"])
                self._append_docs(t, items)
                done.add(_task_key(t))
                prog["done"] = sorted(done)
                _save_progress(prog)
                calls += 1
        except QuotaExceeded as e:
            log.error("YouTube 쿼터 초과: %s — 진행 상태 저장. 내일 다시 실행하면 이어서 돈다.", e)
        except MissingCredentials as e:
            log.error("%s — YouTube 수집 건너뜀.", e)
        return build_weekly_table()

    @staticmethod
    def _append_docs(t: dict, items: list[dict]) -> None:
        if not items:
            return
        df = pd.DataFrame(items)
        df["industry"] = t["industry"]
        df["q"] = t["q"]
        df["week"] = pd.Timestamp(t["after"][:10])
        if DOCS_PARQUET.exists():
            old = pd.read_parquet(DOCS_PARQUET)
            df = pd.concat([old, df], ignore_index=True).drop_duplicates(["videoId", "industry", "q"])
        df.to_parquet(DOCS_PARQUET, index=False)


def plan_summary(weeks_back: int, n_keys: int) -> dict:
    tasks = plan_tasks(weeks_back)
    done = set(_load_progress()["done"])
    remaining = sum(1 for t in tasks if _task_key(t) not in done)
    per_day = max(1, n_keys) * (DAILY_UNITS // SEARCH_COST)
    return {"weeks": weeks_back, "tasks": len(tasks), "remaining": remaining, "keys": n_keys,
            "calls_per_day": per_day, "days": -(-remaining // per_day)}


def build_weekly_table(titles_only: bool = True) -> pd.DataFrame:
    """youtube_docs.parquet → 명사구 주간 빈도.

    titles_only: 제목만 사용(기본). 설명란은 채널 고정 문구(구독 안내·협찬 고지)가 많아 한 채널이 한 주에 영상을
    몰아 올리면 그 문구가 '급등'으로 잡힌다. 채널 ID가 있는 문서는 (채널, 명사구, 주)당 1회만 센다."""
    if not DOCS_PARQUET.exists():
        log.warning("youtube_docs.parquet 없음 → 빈 테이블")
        return pd.DataFrame(columns=["industry", "phrase", "week", "count", "source"])
    docs = pd.read_parquet(DOCS_PARQUET)
    n0 = len(docs)
    docs = docs[docs["title"].map(is_domestic)]
    log.info("해외·여행 영상 제외: %d → %d 문서", n0, len(docs))
    counter: Counter = Counter()
    seen: set = set()
    has_ch = "channelId" in docs.columns
    for r in docs.itertuples(index=False):
        text = r.title if titles_only else f"{r.title}\n{r.description}"
        ch = (getattr(r, "channelId", "") or "") if has_ch else ""
        for ph in extract_phrases(text):
            if ch:
                key = (ch, r.industry, ph, r.week)
                if key in seen:
                    continue
                seen.add(key)
            counter[(r.industry, ph, r.week)] += 1
    rows = [{"industry": k[0], "phrase": k[1], "week": k[2], "count": v} for k, v in counter.items()]
    out = pd.DataFrame(rows, columns=["industry", "phrase", "week", "count"])
    out["source"] = "youtube"
    out.to_parquet(YOUTUBE_WEEKLY_PARQUET, index=False)
    log.info("youtube_weekly.parquet 저장: %d행", len(out))
    return out
