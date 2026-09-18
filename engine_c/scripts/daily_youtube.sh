#!/bin/bash
# 매일 YouTube 후보 원천 수집. Google 쿼터는 미국 태평양시 자정(한국 16:00 PDT / 17:00 PST)에 초기화되므로 그 직후 실행.
# 키가 모두 소진되면 스스로 멈추고 진행 상태를 저장하므로 여러 번 돌아도 안전하다.
set -u
cd /disk1/shinji/BC || exit 1
set -a; source .env; set +a
WEEKS="${1:-40}"
LOG=data/state/daily_youtube.log
echo "=== $(date '+%F %T') 시작 (weeks=$WEEKS) ===" >> "$LOG"
.venv/bin/python -m trendlight youtube --weeks "$WEEKS" 2>&1 | grep -vE "key=" >> "$LOG"
.venv/bin/python -m trendlight plan >> "$LOG" 2>&1
echo "=== $(date '+%F %T') 끝 ===" >> "$LOG"
