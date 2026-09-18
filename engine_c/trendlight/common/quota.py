"""일일 API 호출 카운터. 한도를 넘기면 QuotaExceeded를 던져 파이프라인이 상태를 저장하고 멈추게 한다."""
import datetime as dt
import json
import logging
from pathlib import Path

from .paths import STATE

log = logging.getLogger(__name__)


class QuotaExceeded(RuntimeError):
    pass


class DailyQuota:
    def __init__(self, service: str, limit: int, unit_cost: int = 1):
        self.service = service
        self.limit = limit
        self.unit_cost = unit_cost
        self.path: Path = STATE / f"quota_{service}.json"

    def _today(self) -> str:
        return dt.date.today().isoformat()

    def _load(self) -> dict:
        if self.path.exists():
            d = json.loads(self.path.read_text())
            if d.get("date") == self._today():
                return d
        return {"date": self._today(), "used": 0}

    @property
    def used(self) -> int:
        return self._load()["used"]

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)

    def check(self, cost: int | None = None) -> None:
        cost = self.unit_cost if cost is None else cost
        if self.used + cost > self.limit:
            raise QuotaExceeded(
                f"{self.service}: 일일 한도 {self.limit} 도달 (사용 {self.used}, 요청 {cost})"
            )

    def consume(self, cost: int | None = None) -> int:
        cost = self.unit_cost if cost is None else cost
        self.check(cost)
        d = self._load()
        d["used"] += cost
        self.path.write_text(json.dumps(d))
        return d["used"]
