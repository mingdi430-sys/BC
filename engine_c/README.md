# 유행 신호등 — 엔진 C(유행 수명주기) 데이터 파이프라인 1단계

비씨카드 소비데이터 공모전 MVP의 엔진 C. 모집단(YouTube·빅카인즈)에서 급등 후보를 **자동으로** 뽑고,
네이버 검색어 트렌드(NAVER API HUB)는 **곡선 조회에만** 쓴다. 라벨(labels.yaml)은 검증에만 쓰고 후보 생성에는 넣지 않는다.

## 설치

```bash
cd shinji/BC
/usr/bin/python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # 값 채우고 `set -a; source .env; set +a`
```

## 환경변수

| 변수 | 용도 |
|---|---|
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | NAVER API HUB 검색어 트렌드 (헤더 `X-NCP-APIGW-API-KEY-ID` / `X-NCP-APIGW-API-KEY`) |
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `YOUTUBE_API_KEYS` | 팀원 키 로테이션(쉼표 구분). 쿼터는 Google Cloud **프로젝트 단위**라 팀원마다 자기 프로젝트에서 만든 키여야 한다. 한 키가 소진되면 자동으로 다음 키로 넘어간다 |

데이터랩 호출은 개발자센터(openapi.naver.com)가 아니라 **NAVER API HUB** 문서 기준이다:
`POST https://naverapihub.apigw.ntruss.com/search-trend/v1/search`
(https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)

## 실행 순서

```bash
P=.venv/bin/python
$P -m trendlight probe                 # 1. 앵커 후보 1회 호출 → 소수 자릿수 로그 + 앵커 채택
$P -m trendlight plan                  # 1b. YouTube 남은 작업량 · 키 수별 소요일
$P -m trendlight youtube --weeks 52    # 2. YouTube 후보 원천 (키당 하루 100회, 다음 날 이어서)
$P -m trendlight bigkinds              # 3. data/raw/bigkinds/*.xlsx 파싱 (없으면 스텁)
$P -m trendlight burst                 # 4. 급등 탐지 → data/processed/candidates.parquet
$P -m trendlight collect               # 5. 후보+라벨 곡선 수집 → data/processed/curves.parquet
$P -m trendlight collect-daily         # 5b. 반감기 라벨 4개 일간 곡선 (1회 호출) → curves_daily.parquet
$P -m trendlight lifecycle             # 6. 반감기·단계 판정 → stages.parquet
$P -m trendlight forecast              # 6b. TimesFM 26주 예측·백테스트 → forecasts.parquet (첫 실행 시 모델 ~1GB 다운로드, CPU 가능)
$P -m trendlight report                # 7. reports/stage1_eval.md
```

키가 없을 때 배관만 확인: `$P -m trendlight --synthetic collect` (curves에 `source_client=synthetic` 표시, 리포트 상단에 경고).
단위 테스트: `$P -m pytest tests`.

## 매일 자동 수집

이 서버(KST, 상시 가동)의 crontab에 등록돼 있다. Google 쿼터가 초기화되는 한국시간 16:00 직후와 예비로 23:30에 `scripts/daily_youtube.sh 40`이 돈다.
로그는 `data/state/daily_youtube.log`, 진행은 `python -m trendlight plan`으로 확인. 키를 추가하면 `.env`의 `YOUTUBE_API_KEYS`만 고치면 다음 실행부터 반영된다.
끄려면 `crontab -e`에서 해당 두 줄을 지운다.

## 쿼터 관리

- **YouTube**: search.list 100유닛, 하루 10,000유닛 → 100회. `data/state/quota_youtube.json` 에 일일 사용량,
  `data/state/youtube_progress.json` 에 완료 태스크 기록. 태스크는 (업종, 쿼리, 주) 단위이며 업종 라운드로빈 + 최근 주 우선.
  한도 도달 시 멈추고 상태 저장 → 다음 날 같은 명령으로 이어서 실행.
  전체 태스크 수 = 업종 11 × 쿼리 50개 × 주 수. `--weeks 52` = 2,600회 → 키 1개 26일, 키 3개 9일. `plan` 명령이 계산해 준다.
  키 여러 개는 `YOUTUBE_API_KEYS=키1,키2,키3` 으로 넣으면 한 머신에서 순서대로 소진한다(상태 파일 `quota_youtube.json`, `quota_youtube_2.json`, …).
- **데이터랩**: `data/state/quota_naver_datalab.json` (기본 1,000/일). 요청당 앵커 1 + 아이템 4.
  키워드 K개 × 세그먼트 9개(전체·성별 2·연령 6) ≈ K/4 × 9 요청. 후보 220 + 라벨 14 + 지역 35 ≈ 270개 → 약 610회 + 2단 앵커 추가분.
  한도 도달 시 부분 curves.parquet 저장 후 종료, 다음 날 재실행하면 캐시에서 이어감.
- **캐시**: 모든 API 응답은 `data/cache/<service>/<sha1>.json`. 같은 파라미터는 재호출하지 않는다.

## 앵커·정규화

- 데이터랩은 요청 내 최대값=100이라 요청 간 척도가 다르다. 모든 요청에 범용 앵커(anchors.yaml, 기본 쿠팡)를 넣고
  앵커 기간 평균으로 나눠 앵커=1.0 척도로 통일한다(`normalize_method: mean`).
- 첫 호출 후 소수 자릿수를 `data/cache/datalab_precision.json` 에 기록한다(문서 예시는 5자리).
- 아이템 max raw < 1.0 이면 자동으로 2단 앵커(범용 → 업종 앵커 → 아이템)로 전환하고 체인 곱으로 척도를 잇는다.
  `anchor` 열이 `쿠팡>맛집` 형태면 2단이다. 정규화 전(value_raw)·후(value_norm) 모두 저장.

## 산출물

| 파일 | 내용 |
|---|---|
| `data/processed/youtube_weekly.parquet` | 업종·명사구·주·빈도 |
| `data/processed/bigkinds_weekly.parquet` | 키워드/명사구·주·건수 |
| `data/processed/candidates.parquet` | phrase, industry, burst_start_week, max_z, max_ratio, sources, n_bursts (업종당 ≤20) |
| `data/processed/curves.parquet` | keyword, base_keyword, week, value_raw, value_norm, gender, age, anchor, industry, source, source_client |
| `data/processed/curves_daily.parquet` | 반감기 라벨 4개 일간 곡선 (정의 차이 진단용) |
| `data/processed/stages.parquet` | 롤링 단계 판정 |
| `data/processed/forecasts.parquet` | TimesFM 26주 예측(median/q10/q90)과 P(6개월 뒤 유지), 신호 |
| `data/processed/timesfm_backtest.parquet` | 라벨 곡선 rolling-origin 백테스트 |
| `reports/stage1_eval.md` | (a) 후보 재현율 (b) 반감기 MAE (c) 리드타임 (d) 음성 오판 |

## 패키지 구조

```
trendlight/
  config/      industries.yaml anchors.yaml labels.yaml
  common/      paths cache quota text
  candidates/  phrases(kiwi) youtube bigkinds burst
  datalab/     client(API HUB) normalize synthetic collect
  lifecycle/   preprocess halflife stage
  eval/        report
tests/         test_normalize test_halflife test_stage
```

## 판정 구조

- **규칙(stage.py)**: 지금 단계(태동/급등/정점/하락/안정)를 설명. 미래 정보 없음.
- **예측(forecast.py, TimesFM 2.5 zero-shot)**: "26주 뒤 검색량이 지금의 70% 이상인가"의 확률 P(유지). 신호등 색은 이 확률로 정한다(≥0.9 초록, <0.5 빨강).
- 쿼리 정교화 이력은 `industries.yaml` 주석 참고(2026-09-15 저수확 쿼리 9개 교체).


## 팀원용: 지금까지 수집한 데이터로 실험하기

키 없이도 아래 파일만으로 모델 실험이 된다(모든 API 응답은 이미 받아 저장돼 있음).

| 파일 | 내용 | 행 |
|---|---|---|
| `data/processed/curves.parquet` | 네이버 검색 곡선. 키워드 90개(라벨 14 + 지역 조합 70 + 비빔밥 6) × 세그먼트 9개(전체·성별 2·연령 6) × 2020~2026 주간 | 약 22만 |
| `data/processed/curves_daily.parquet` | 반감기 라벨 4개의 일간 곡선 | 약 7천 |
| `data/processed/youtube_docs.parquet` | YouTube 검색 결과 원문(제목·설명·게시일·채널). 업종 11 × 쿼리 50 × 최근 24주 | 약 5만 |
| `data/processed/youtube_weekly.parquet` | 제목 명사구의 업종·주별 빈도 | 약 15만 |
| `data/processed/candidates.parquet` | 급등 후보(업종당 ≤20) | 약 120 |
| `data/processed/stages.parquet` | 규칙 기반 롤링 단계 판정 | 약 3만 |
| `data/processed/forecasts.parquet` | TimesFM 26주 예측과 P(6개월 뒤 유지) | 키워드 90 × 26 |
| `data/processed/timesfm_backtest.parquet` | TimesFM rolling-origin 백테스트(1,033 시점) | 1,033 |
| `data/cache/datalab/*.json` | 네이버 API 원본 응답(요청 바디 포함) | 461 파일 |

`curves.parquet` 열: `keyword, base_keyword, week, value_raw(네이버 원값, 요청 내 최대=100), value_norm(앵커 쿠팡 평균=1 척도, 요청 간 비교용), gender(all/m/f), age(all/1~6 카드 AGE_CD), anchor(쿠팡 또는 쿠팡>업종앵커), industry, source(label/label_region/demo/demo_region), source_client`.
모델 입력은 `gender=all, age=all` 의 `value_norm` 을 쓰면 된다.

### 모델 바꿔 끼우기

`examples/backtest_template.py` 의 `predict(history) -> 유지 확률` 하나만 고치면 같은 잣대(4주 간격 rolling origin, 26주 뒤 70% 유지 여부, AUC)로 TimesFM과 비교된다.

```bash
python examples/backtest_template.py
```

TimesFM 자체를 돌리려면 `pip install timesfm torch` 후 `python -m trendlight forecast` (첫 실행 시 모델 약 1GB 다운로드, CPU 가능).
규칙 단계는 `trendlight/lifecycle/stage.py`, 반감기는 `halflife.py`, 검증 리포트는 `reports/stage1_eval.md`.

### 하지 말 것

- `labels.yaml` 의 라벨 키워드를 후보 생성(쿼리·필터)에 넣지 않는다. 검증에만 쓴다.
- 백테스트에서 origin 이후 데이터를 특징으로 쓰지 않는다(누수). `tests/test_stage.py` 가 규칙 쪽 누수를 검사한다.

## 코드북 가정 (확인 필요)

- `AGE_CD`: 1=20대 이하, 2=20대, 3=30대, 4=40대, 5=50대, 6=60대 이상, x=미상 (팀 README 코드북 확인됨)
- `GENDER_CD`: 1=남성, 2=여성, 3=외국인(성별 미제공), x=미상 (팀 README 코드북 확인됨)
- 데이터랩 ages 매핑은 `industries.yaml`의 `age_map_card_to_datalab` 참고.
