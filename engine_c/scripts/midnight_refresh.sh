#!/bin/bash
# 자정(네이버 일일 한도 초기화) 직후: 후보 곡선 수집 → 예측 → 웹 내보내기 → 빌드 → 푸시
set -u
cd /disk1/shinji/BC || exit 1
set -a; source .env; set +a
LOG=data/state/midnight_refresh.log
echo "=== $(date '+%F %T') 시작 ===" >> "$LOG"
# 자정까지 대기
while [ "$(date +%F)" = "$1" ]; do sleep 60; done
echo "$(date '+%F %T') 날짜 바뀜, 수집 시작" >> "$LOG"
.venv/bin/python -m trendlight collect >> "$LOG" 2>&1
# 데모·후보 지역 조합 복구 (캐시)
.venv/bin/python - >> "$LOG" 2>&1 <<'EOF'
import pandas as pd
from trendlight.datalab.client import DatalabClient
from trendlight.datalab.collect import Collector, KeywordSpec, build_segments, probe_anchor
from trendlight.common.paths import CURVES_PARQUET
c = Collector(DatalabClient.from_env()); c.general_anchor = probe_anchor(c.client, c.start, c.end)
frames = []
for kw, ind, src in [("비빔밥", "한정식", "demo"), ("버터떡", "제과점", "candidate"), ("황치즈", "슈퍼마켓", "candidate"), ("초코바게트", "제과점", "demo")]:
    specs = [KeywordSpec(kw, ind, src)] + [KeywordSpec(f"{r} {kw}", ind, src + "_region", base_keyword=kw) for r in ["서울", "부산", "대구", "광주", "대전"]]
    try:
        frames += [c.collect_segment(specs, seg) for seg in build_segments()]
    except Exception as e:
        print("지역 복구 실패:", kw, e)
if frames:
    new = pd.concat(frames, ignore_index=True); new["source_client"] = "naver"
    old = pd.read_parquet(CURVES_PARQUET); cols = list(old.columns)
    key = ["keyword", "gender", "age"]; done = new[key].drop_duplicates().assign(_n=1)
    old = old.merge(done, on=key, how="left"); old = old[old._n.isna()].drop(columns="_n")
    pd.concat([old[cols], new[cols]], ignore_index=True).to_parquet(CURVES_PARQUET, index=False)
    print("복구", new.keyword.nunique(), "키워드")
EOF
.venv/bin/python scripts/collect_rising.py >> "$LOG" 2>&1
.venv/bin/python -m trendlight forecast --no-backtest >> "$LOG" 2>&1
.venv/bin/python -m trendlight.export_web >> "$LOG" 2>&1
# 모델 비교 갱신 (전체 곡선 백테스트 → 실험 표)
.venv/bin/python -c "import pandas as pd; from trendlight.lifecycle.forecast import backtest_all; backtest_all(pd.read_parquet('data/processed/curves.parquet'))" >> "$LOG" 2>&1
.venv/bin/python examples/experiments.py > reports/experiments_latest.txt 2>/dev/null
export PATH=/disk1/shinji/tools/node/bin:$PATH
cd /disk1/shinji/BC-team/signal && npx vite build --base ./ --outDir /tmp/claude-1000/-disk1/c9a05dce-5b4f-4987-a598-1df90fa387bb/scratchpad/team-dist --emptyOutDir >> "/disk1/shinji/BC/$LOG" 2>&1
cd /disk1/shinji/BC-team && cp /disk1/shinji/BC/data/processed/{curves.parquet,forecasts.parquet,candidates.parquet,youtube_weekly.parquet} engine_c/data/processed/ \
  && cp /disk1/shinji/BC/trendlight/candidates/phrases.py engine_c/trendlight/candidates/ && cp /disk1/shinji/BC/trendlight/candidates/burst.py engine_c/trendlight/candidates/ \
  && git add engine_c/trendlight engine_c/data/processed signal/src/trendData.json && git commit -q -m "자정 갱신: 후보 곡선 전체 수집, 예측, 웹 데이터" && GIT_TERMINAL_PROMPT=0 git push origin shinji/chat-sql >> "/disk1/shinji/BC/$LOG" 2>&1
echo "=== $(date '+%F %T') 끝 ===" >> "/disk1/shinji/BC/$LOG"
