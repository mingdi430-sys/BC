from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
BIGKINDS_RAW = RAW / "bigkinds"
CACHE = DATA / "cache"
PROCESSED = DATA / "processed"
STATE = DATA / "state"
REPORTS = ROOT / "reports"
CONFIG = ROOT / "trendlight" / "config"

for _p in (BIGKINDS_RAW, CACHE, PROCESSED, STATE, REPORTS):
    _p.mkdir(parents=True, exist_ok=True)

CANDIDATES_PARQUET = PROCESSED / "candidates.parquet"
CURVES_PARQUET = PROCESSED / "curves.parquet"
YOUTUBE_WEEKLY_PARQUET = PROCESSED / "youtube_weekly.parquet"
BIGKINDS_WEEKLY_PARQUET = PROCESSED / "bigkinds_weekly.parquet"
