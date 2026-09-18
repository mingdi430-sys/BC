"""디스크 JSON 캐시. 모든 외부 API 호출은 이 캐시를 거쳐 재실행 시 재호출하지 않는다."""
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Callable

from .paths import CACHE

log = logging.getLogger(__name__)


def _key(namespace: str, params: Any) -> str:
    raw = json.dumps(params, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def cache_path(namespace: str, params: Any) -> Path:
    d = CACHE / namespace
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{_key(namespace, params)}.json"


def cached(namespace: str, params: Any, fn: Callable[[], Any]) -> tuple[Any, bool]:
    """(결과, 캐시히트여부). fn은 캐시 미스일 때만 실행된다."""
    p = cache_path(namespace, params)
    if p.exists():
        with p.open(encoding="utf-8") as f:
            return json.load(f)["result"], True
    result = fn()
    with p.open("w", encoding="utf-8") as f:
        json.dump({"params": params, "result": result}, f, ensure_ascii=False)
    return result, False
