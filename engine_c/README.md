# 유행 신호등 엔진 C(유행 수명주기) 데이터 파이프라인 1단계

비씨카드 소비데이터 공모전 MVP의 엔진 C. 모집단(YouTube·빅카인즈)에서 급등 후보를 **자동으로** 뽑고,
네이버 검색어 트렌드(NAVER API HUB)는 **곡선 조회에만** 쓴다. 라벨(labels.yaml)은 검증에만 쓰고 후보 생성에는 넣지 않는다.

---

## 팀 공유 현황 (2026-09-18 기준)

### 1. 데이터가 어디까지 있나

| 데이터 | 상태 | 파일 |
|---|---|---|
| YouTube 검색 결과 | 업종 11 × 쿼리 50, 2026-03-23 ~ 09-07 **25주**, 영상 47,021건 (태스크 1,200 / 목표 2,000) | `data/processed/youtube_docs.parquet` |
| 명사구 주간 빈도 | 제목만, 채널당 1회, 한글 필수, 지명·일반명사·해외 영상 제외 | `data/processed/youtube_weekly.parquet` |
| 급등 후보 | **125개** (업종당 7~16). 두쫀쿠가 제과점에서 자동으로 잡힘 | `data/processed/candidates.parquet` |
| 네이버 검색 곡선 | **90개 키워드** × 9세그먼트(전체·성별·연령6) × 2020~2026 주간, 233,755행. 키워드 = 검증용 라벨 14 + 지역 조합 70 + 비빔밥 6 | `data/processed/curves.parquet` |
| 일간 곡선 | 반감기 라벨 4개 | `data/processed/curves_daily.parquet` |
| 네이버 원본 응답 | 506건 (재호출 불필요, 캐시) | `data/cache/datalab/` |
| 빅카인즈 | 없음 (파서만 있음, 엑셀 넣으면 동작) | `data/raw/bigkinds/` |

- **후보 125개의 검색 곡선은 아직 없다.** 후보가 매일 바뀌어서 9/20 수집 마감 후 한 번에 받는다(네이버 하루치). 그 전까지 모델 실험은 위 90개 곡선(실질적으로 라벨 14 + 비빔밥)으로 한다.
- YouTube는 cron으로 매일 16:30 KST 자동 수집(키 3개 × 100회). 9/20이면 40주 범위가 끝난다.
- 라벨 14개 = 유행 7(크로플·탕후루·두바이 초콜릿·두쫀쿠·마라탕·오마카세·소금빵) + 안정 7(김밥·떡볶이·치킨·삼겹살·짜장면·라면·우유). **검증 전용**이며 후보 생성에는 절대 쓰지 않는다.

### 2. 어떤 모델·방법을 해봤나

| 구분 | 방법 | 결과 | 비고 |
|---|---|---|---|
| 후보 생성 | 명사구 주간 빈도, 직전 8주 z-score ≥3 또는 ×3 | 라벨 유행 7개 중 1개(두쫀쿠) 자동 포착. 나머지 6개는 수집 범위(40주) 밖 | `candidates/burst.py` |
| 단계 판정 | 규칙: 최근 4주 성장률·가속·최고치 대비 수준·t-통계량 → 태동/급등/정점/하락/안정, 롤링(미래 정보 없음) | 안정 7개 surging 오판 0. 하락 판정은 정점 뒤 6~27주로 느림 | `lifecycle/stage.py` |
| 반감기 | 정점 → 50% 도달 일수. 주간 원본 / 스플라인 / 일간 원본 / 일간 7일 이동평균 비교 | **일간 + 7일 이동평균이 코리아헤럴드 수치와 MAE 2.5일** (주간 13.5일) | `lifecycle/halflife.py` |
| 6개월 예측 | **TimesFM 2.5 (200M, zero-shot, 추가 학습 없음)** 26주 분위수 예측 → P(26주 뒤 ≥ 현재의 70%) | 곡선 183개·12,826시점 **AUC 0.912** (규칙 단계 0.53). 초록(P≥0.8) 실제 유지 96%, 빨강(P<0.5) 실제 하락 73%. 비교: LSTM 0.88, 트리 계열 0.82~0.83, 로지스틱 0.73 (`reports/experiments_latest.txt`) | `lifecycle/forecast.py`, 보고서 `ui/timesfm-report.html` |

TimesFM의 약점: 급등 직전에 "곧 꺼진다"고 비관(탕후루 정점 12주 전 P=0.16, 실제 +37%), 완만한 유행(크로플 AUC 0.53, 소금빵 0.57)에 약함. 표본의 90%가 "유지"라 안정 품목이 성적을 올린다. 확률 보정(isotonic)은 표본이 곡선 14개뿐이라 보류.

안 해본 것: 학습 모델(GBM/로지스틱). 곡선이 200개 이상 모이면 TimesFM 확률 + 규칙 특징을 입력으로 보정 모델을 얹는 것이 v2 계획. LLM으로 후보에서 "아이템이 아닌 말" 거르기 API 키 없어 미적용.

### 3. 앞으로 실험할 때 코드 짜는 방식

**공통 잣대**: 주 t까지의 곡선만 보고 "26주 뒤 검색량이 지금(최근 4주 평균)의 70% 이상인가"를 맞힌다. 4주 간격 rolling origin, 최소 문맥 26주, 지표는 AUC. 이 잣대를 바꾸지 않아야 서로 비교가 된다.

**모델 교체 (가장 쉬운 길)**: `examples/backtest_template.py`

```python
def predict(history: np.ndarray) -> float:   # history: 오래된→최근, value_norm×100
    ...                                      # 0~1 유지 확률을 돌려준다
    return p
```
이 함수만 바꾸고 `python examples/backtest_template.py` 를 돌리면 TimesFM과 같은 표에 AUC가 찍힌다. 학습이 필요한 모델이면 `backtest()` 안에서 origin 이전 데이터로만 fit 하고(누수 금지) origin마다 predict 한다.

**TimesFM 자체를 바꾸기**: `trendlight/lifecycle/forecast.py`
- `keep_probability(q, base)`: 분위수 → 확률 매핑. 지금은 분위수 선형보간. 여기가 보정/임계값 실험 지점.
- `GREEN_MIN / RED_MAX`: 신호등 임계값(0.9 / 0.5).
- `backtest_all(curves)`: 라벨 백테스트. 다른 파운데이션 모델(Chronos, Moirai 등)을 붙이려면 `forecast_batch()`와 같은 (point, quantiles) 반환 형태로 맞추면 나머지는 그대로 돈다.

**후보 생성 실험**: `trendlight/candidates/burst.py`
- `detect_bursts(weekly, baseline_weeks, z_thresh, ratio_thresh, min_count)`: 입력은 `youtube_weekly.parquet`. 파라미터만 바꿔도 되고 함수를 갈아끼워도 된다. 결과는 `python -m trendlight report` 의 (a)절(라벨 7개 포착 여부)로 평가한다.
- 명사구 추출·불용어는 `candidates/phrases.py`.

**단계 규칙 실험**: `trendlight/lifecycle/stage.py`
- `features_at(values, t)` 는 `values[:t+1]` 만 쓴다. `classify(f)` 규칙을 바꾼 뒤 `pytest tests/test_stage.py` 로 누수 검사를 통과해야 한다.

**규칙 세 가지**
1. 라벨 키워드를 후보 생성(쿼리·필터·불용어)에 넣지 않는다.
2. origin 이후 데이터를 특징이나 학습에 쓰지 않는다.
3. 결과는 `reports/stage1_eval.md` 형식(a~e)으로 같이 낸다. `python -m trendlight report` 가 만든다.

### 3b. 폐점률(인허가 데이터) 준비 상태

`trendlight/closures.py` 작성 완료. 입력 파일이 아직 없다. **이 서버에서는 localdata.go.kr 접속이 막혀 있어** PC에서 받아 `data/raw/localdata/`에 올려야 한다.
받을 것: 지방행정인허가 데이터개방(localdata.go.kr) → 데이터받기 → 식품 → **일반음식점, 휴게음식점, 제과점** 각각 "전체 데이터"(CSV zip, 파일당 수백 MB).
올린 뒤 `python -m trendlight.closures` 를 돌리면 상호에 아이템명이 든 매장의 월별 개업·폐업·영업중 수, 검색 정점→개업 정점→폐업 정점 시차, 개업 연도별 12개월 생존율이 `reports/closures.md`로 나온다.

### 4. 일정

- 9/20 YouTube 40주 수집 마감 → `burst` → `collect`(후보 곡선 약 200개, 네이버 하루치) → `forecast` → `report`
- 9/21 UI 데이터 교체, 9/22 제출

---


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
