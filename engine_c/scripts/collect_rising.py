"""지금 뜨는 것(완만 상승) 상위 12개 중 곡선 없는 것을 즉석 수집. 자정 갱신 스크립트가 호출한다."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from trendlight.candidates.burst import detect_rising  # noqa: E402
from trendlight.common.paths import CURVES_PARQUET, YOUTUBE_WEEKLY_PARQUET  # noqa: E402
from trendlight.ondemand import fetch_and_build  # noqa: E402

r = detect_rising(pd.read_parquet(YOUTUBE_WEEKLY_PARQUET)).head(12)
have = set(pd.read_parquet(CURVES_PARQUET)["keyword"])
for row in r.itertuples():
    if row.phrase in have:
        continue
    try:
        fetch_and_build(row.phrase, row.industry)
        print("뜨는 것 수집:", row.phrase)
    except Exception as e:  # noqa: BLE001
        print("뜨는 것 수집 실패:", row.phrase, e)
        break
