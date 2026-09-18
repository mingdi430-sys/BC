"""API 키 없이 파이프라인 배관을 검증하기 위한 합성 클라이언트.

실제 데이터가 아니다. 리포트/parquet에 source_client='synthetic'으로 표시된다.
- 라벨 양성: approx_peak 부근에서 급등 후 halflife_days 기대값대로 지수 감쇠
- 라벨 음성: 평탄 + 노이즈
- 그 외 키워드: 키워드 해시로 정한 임의 시점의 작은 봉우리
- 앵커(범용/업종): 큰 상수 수준 → 아이템이 1.0 미만으로 눌리는 상황(2단 앵커 전환)도 재현
요청 안 최대값 = 100, 소수 5자리 반올림(문서 예시와 동일 자릿수).
"""
from __future__ import annotations

import hashlib
import logging

import numpy as np
import pandas as pd

from ..config import anchors as anchors_cfg, label_keywords
from .client import CACHE, BaseDatalabClient, record_precision

PRECISION_FILE_SYNTHETIC = CACHE / "datalab_precision_synthetic.json"

log = logging.getLogger(__name__)


def _h(s: str) -> float:
    return int(hashlib.md5(s.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


class SyntheticDatalabClient(BaseDatalabClient):
    name = "synthetic"

    def __init__(self):
        self.calls = 0
        acfg = anchors_cfg()
        self.general = set(acfg["general_anchors"])
        self.industry = set(acfg["two_stage"]["industry_anchors"].values())
        self.labels = label_keywords()

    def _series(self, kw: str, weeks: pd.DatetimeIndex, seg_scale: float) -> np.ndarray:
        n = len(weeks)
        t = np.arange(n, dtype=float)
        rng = np.random.default_rng(int(_h(kw) * 1e6))
        base_kw = kw
        for r in ["서울 ", "부산 ", "대구 ", "광주 ", "대전 "]:
            if kw.startswith(r):
                base_kw = kw[len(r):]
        if kw in self.general:
            level = 1000.0
            y = level * (1 + 0.05 * np.sin(t / 52 * 2 * np.pi)) + rng.normal(0, 5, n)
        elif kw in self.industry:
            level = 200.0
            y = level * (1 + 0.1 * np.sin(t / 52 * 2 * np.pi)) + rng.normal(0, 3, n)
        elif base_kw in self.labels and self.labels[base_kw]["polarity"] == "positive":
            lab = self.labels[base_kw]
            peak_ts = pd.Timestamp(lab.get("approx_peak") or "2022-06") + pd.Timedelta(days=14)
            p = int(np.argmin(np.abs(weeks - peak_ts)))
            hl_days = lab.get("halflife_days") or 90
            hl_w = hl_days / 7.0
            rise = 8.0
            y = np.where(t <= p, 40 * np.exp((t - p) / rise), 40 * 0.5 ** ((t - p) / hl_w))
            y = y + 1.0 + rng.normal(0, 0.3, n)
            if base_kw != kw:  # 지역 접두: 조금 늦고 작게
                y = np.roll(y, 2) * 0.3
        elif base_kw in self.labels:
            y = 30 + 3 * np.sin(t / 52 * 2 * np.pi) + rng.normal(0, 1.0, n)
        else:
            p = int(_h(kw + "peak") * (n - 20)) + 10
            amp = 0.5 + 5 * _h(kw + "amp")
            y = amp * np.exp(-0.5 * ((t - p) / 4) ** 2) + 0.2 + rng.normal(0, 0.05, n)
        return np.clip(y * seg_scale, 0, None)

    def search(self, keyword_groups, start, end, time_unit="week", gender=None, ages=None, device=None) -> dict:
        self.calls += 1
        weeks = pd.date_range(start, end, freq="W-MON")
        seg_scale = 1.0 if not gender and not ages else 0.9
        mat = {}
        for g in keyword_groups:
            mat[g["groupName"]] = self._series(g["groupName"], weeks, seg_scale)
        mx = max(v.max() for v in mat.values()) or 1.0
        results = []
        for g in keyword_groups:
            vals = mat[g["groupName"]] / mx * 100
            results.append({
                "title": g["groupName"],
                "keywords": list(g["keywords"]),
                "data": [{"period": w.strftime("%Y-%m-%d"), "ratio": round(float(v), 5)} for w, v in zip(weeks, vals)],
            })
        resp = {"startDate": start, "endDate": end, "timeUnit": time_unit, "results": results}
        record_precision(resp, context="synthetic", path=PRECISION_FILE_SYNTHETIC)
        return resp
