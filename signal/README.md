# 결 — CSV 기반 상권·트렌드 분석

## 실행

`START.cmd`를 더블클릭한 후 http://localhost:5173 에 접속합니다. 서버 창은 열어두세요.

직접 실행: `npm install`, `npm run dev -- --port 5173`

빌드: `npm run build`

## 실제 데이터 범위

- 원본: ABP_CONTEST_DATA.csv (원본 수정 없음)
- 242,574행 / 2026년 1~6월 / 17개 시도 / 시도+시군구 255개 조합 / 11개 업종
- 지역 식별자는 SIDO_NM + CCG_NM입니다. 강릉시, 기장군, 성남시 분당구, 세종특별자치시 등 실제 문자열을 그대로 사용합니다.
- 카페는 원본 업종 목록에 없으므로 선택할 수 없습니다. 업종명 내부 공백도 원본 그대로 유지합니다.
- 전국은 실제 시도 경계 위에 합계를 표시하고, 시도 선택 후 실제 시·군·구 경계로 확대합니다. 경계는 2026년 4월 자료를 단순화한 것입니다.
- 모든 지역은 유지하며, 업종 행이 없으면 자료 없음으로 표시합니다. 누락을 0으로 해석하지 않습니다.

## 집계 정의

- 기간 결제금액: 해당 업종·지역의 모든 행 amt 합계
- 기간 결제 건수: 동일한 행 cnt 합계
- 건당 결제금액: 기간 amt 합계 / 기간 cnt 합계
- 월별 결제금액: STRD_YYMM별 amt 합계
- 최근 월 증감률: (202606 amt / 202605 amt - 1) × 100. 어느 월이 없거나 이전 월이 0이면 비교 불가.
- amt는 원 단위, cnt는 건 단위입니다(공모전 데이터 레이아웃 문서 기준). 화면에는 가독성을 위해 억 원 단위로 축약해 표시합니다.
- GENDER_CD는 1=남성, 2=여성, 3=외국인(성별 미제공), x=성별 미상입니다. AGE_CD는 1=20대 이하, 2=20대, 3=30대, 4=40대, 5=50대, 6=60대 이상, x=연령 미상입니다. 모든 코드는 합계에 포함합니다.
- 업종 자료가 존재하는 지역 조합은 2,379개입니다. 모든 업종이 모든 지역을 포함하지는 않습니다.

## 트렌드

검색 관심도·예측·생애주기는 여전히 말차, 베이글, 그릭요거트 시연 데이터입니다. 상권 CSV와 시기·출처가 다르며 결합 점수나 인과관계를 계산하지 않습니다.

## 시연 순서

분석 시작하기 → 갈비전문점 → 전국 시도 경계 확인 → 강원특별자치도 → 강릉시 → 월별 상세 → 양양군의 자료 없음 상태 확인.

다른 업종과 시도로 변경해 군·시·복합 구 명칭을 확인할 수 있습니다.

## 데이터 갱신

원본 CSV를 교체한 다음 `node scripts/aggregate-data.mjs`를 실행하고 `npm run build`를 실행합니다. 집계 스크립트는 헤더·값을 검증하고 원본 전체 금액과 건수의 총합이 집계 출력과 일치하는지 검사합니다.

소스: src/data.js (집계 조회), src/cardData.json (로컬 집계 결과), src/components/DataCommercial.jsx (전국 탐색·정보 패널·상세 차트), src/components/TrendAnalysis.jsx (시연 트렌드).

## 실제 행정 경계 지도

- `GeoMapPanel.jsx`가 이전 타일 지도를 대체합니다. 전국 시도를 클릭하면 해당 시·군·구 실제 경계를 보여줍니다.
- - / - 확대·축소, 초기 위치, 드래그 이동, 키보드 Enter/Space 선택을 지원합니다.
- 원출처: 통계청 SGIS, 가공: vuski/admdongkor (https://github.com/vuski/admdongkor), ver20260401. CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
- 지도 표시를 위해 경계를 단순화하고 행정동을 시군구/시도로 병합했습니다. 정밀 측량이나 개별 필지 경계 용도가 아닙니다.
- 지도 경계 255개와 CSV 지역 255개를 일대일 검증했습니다. 띄어쓰기만 정규화했고, 세종시(경계 코드 36110)는 CSV의 세종특별자치시로 명시적으로 연결했습니다. 원본 지도 이름은 sourceName에 보존합니다.
- 검증 재실행: `node scripts/match-map-regions.mjs`.
- 실제 배포용 지도 파일은 `public/maps/provinces.json`, `public/maps/districts.json`입니다. 원본 대용량 지도는 `scripts/source-20260401.geojson`에 보관하며 배포물에 포함하지 않습니다.


## 신호등 브랜드와 단계별 지역 선택

- 서비스 이름은 신호등입니다. 소비·트렌드 정보를 판단의 신호로 제공하며 창업 가능/불가 판정 점수를 만들지 않습니다.
- 도 지역은 시·도 → 시·군 → 구 순서로 선택합니다. 경기도 → 성남시 → 분당구 등이 가능합니다.
- 특별·광역시는 시·도 → 구·군으로 바로 선택합니다. 군은 시의 하위 단계로 취급하지 않습니다.
- 하위 구가 없는 시·군은 구 선택을 비활성화합니다. 세종은 원본 지역 단위를 유지합니다.
- 시 전체를 선택하면 원본 하위 구의 금액·건수·월별 수치·인구통계 코드를 합산합니다. 증감률과 건당 금액은 합산된 분자·분모로 다시 계산합니다. 자료가 없는 구를 0으로 간주하지 않으며 포함된 구 수를 표시합니다.
- 검증: `node scripts/test-hierarchy.mjs` (11개 업종의 합계 보존, 구 중복 방지, 시 단위 증감률 계산).

## 경쟁업체 데이터 (공급 정규화)

절대 결제금액만으로는 지역 간 비교가 왜곡됩니다(이미 포화된 지역과 진짜 기회 지역을 구분 못 함). 이를 보완하기 위해 공공데이터를 추가로 연동했습니다.

- **경쟁업체 수**: 소상공인시장진흥공단 상가(상권)정보 API(`apis.data.go.kr/B553077/api/open/sdsc2`, 2026.06 기준). 시군구별로 BC카드 업종에 대응하는 SEMAS 업종 코드의 상가업소 수를 셉니다. 수집: `node scripts/prepare_business_density.mjs` → `src/businessDensityData.json`.
- **업종 매칭은 근사치입니다.** SEMAS 업종 분류(대/중/소분류, KSIC 기반)는 BC카드의 11개 자체 분류와 체계가 달라 완벽한 1:1 매칭이 불가능합니다. 각 BC 업종에 대응시킨 SEMAS 코드와 근거는 `prepare_business_density.mjs`의 주석에 남겨뒀습니다. 화면에도 근사치임을 표시합니다.
- **파생 지표**: 업체당 평균 매출 추정(amount/competitors). 지도 "표시 기준" 드롭다운과 지역 상세 패널에서 확인할 수 있습니다.
- API는 data.go.kr 계정의 인증키가 필요합니다(`.env`의 `DATA_GO_KR_KEY`, git에 커밋되지 않음). 원본 CSV가 바뀌어도 이 데이터는 카드사 CSV와 무관하므로 별도로 갱신해야 합니다.

**인구 1인당 지표는 넣지 않습니다.** 그 지역 결제 총액에는 거주자뿐 아니라 방문객·유동인구 소비도 섞여 있어, 거주 인구(행정안전부 주민등록 인구)로 나누면 "주민 소비력"처럼 보이지만 실제로는 관광지·환승지 등 외부 유입이 많은 지역이 왜곡되어 높게 나옵니다. 오해를 줄 수 있는 지표라 제외했습니다(과거에 `perCapitaAmount`/`populationData.json`로 있었으나 제거함).

## 트렌드 온디맨드 조회

풀(`src/trendData.json`)에 없는 아이템을 검색하면 프런트가 `GET /trend/{키워드}` 를 호출한다. 백엔드는 `engine_c`의 `python -m trendlight.ondemand` 를 실행해 네이버에서 곡선(전체·성별·연령·5개 도시, 약 27회)을 받고 단계·반감기·TimesFM 예측을 계산해 같은 형식으로 돌려준다(첫 조회 20~30초, 이후 캐시). `backend/.env`에 `NAVER_CLIENT_ID/SECRET`, `ENGINE_C_ROOT`(engine_c 경로), `ENGINE_C_PYTHON`(그 venv의 python)이 필요하다.

## 챗봇 (LLM 분석 도우미)

### 2026-09-18 추가: 카드 데이터 자연어 질의 (text-to-SQL)

- `backend/.env`에 `OPENAI_API_KEY`가 있으면 제공자가 OpenAI(`LLM_MODEL`, 기본 `gpt-5-mini`)로 바뀌고, 기존 화면 조작 도구 4개에 **`query_card_data`**(읽기 전용 SQL) 도구가 추가된다. Gemini도 OpenAI 호환 엔드포인트(`LLM_BASE_URL`)로 붙는다. 키가 없으면 기존 Anthropic 경로 그대로.
- `backend/sqlstore.py`: `ABP_CONTEST_DATA.csv`를 DuckDB 인메모리 테이블 `card`(month, sido, sigungu, gender_cd/gender, age_cd/age, industry, amt, cnt)로 올린다. SELECT 하나만 허용, 금지 키워드 차단, 200행 제한.
- `backend/llm_openai.py`: 스키마·계산 규칙(비율은 미상·외국인 제외)·**답변 범위**를 시스템 프롬프트로 고정. 조회·집계·비교·순위만 답하고, 예측·추천·원인 해석·데이터 밖 정보·개인정보는 정해진 문구로 거절한다. 숫자는 SQL 결과에서만 인용.
- 프런트 `ChatPanel`은 답변 아래 "근거 SQL n건"을 접이식으로 보여준다. API 주소는 `VITE_CHAT_API`(기본 `http://localhost:8010`; 8000은 이 서버에서 다른 프로세스가 사용).
- 실행: `cd backend && python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/uvicorn main:app --port 8010`
- 확인된 예: "성북구랑 성동구 중 여성 결제 비율이 높은 곳" → 성북구 45.40% vs 성동구 45.22%. "내년에 탕후루 가게 열면 성공할까" → 거절 문구.


지도·드롭다운 클릭만으로는 "성장 중인데 경쟁이 적은 지역"처럼 복합 조건을 찾기 어렵습니다. 화면 오른쪽 상시 채팅 패널에서 한국어로 질문하면, 화면에 이미 계산된 수치만 근거로 답하고 필요하면 지도/업종/지표를 직접 조작합니다.

- **백엔드**: `backend/` 아래 FastAPI 서버(`main.py`, `llm_client.py`). `POST /chat`이 현재 화면 상태(업종·지역·지표와 이미 계산된 통계)를 받아 Anthropic Claude에 전달하고, `set_industry`/`show_region`/`set_metric`/`clear_selection` 네 가지 도구(tool) 호출과 한국어 응답을 반환합니다.
  - 실행: `cd backend`, 가상환경 생성 후 `pip install -r requirements.txt`, `uvicorn main:app --reload --port 8000`.
  - `backend/.env`에 `ANTHROPIC_API_KEY=sk-ant-...` 한 줄을 추가해야 실제 응답을 받습니다(git에 커밋되지 않음). 키가 없어도 서버는 정상 기동하며, `/chat`은 에러 없이 "채팅 기능이 아직 설정되지 않았어요"라고 정직하게 답합니다.
- **프런트엔드**: `src/components/ChatPanel.jsx`. LLM의 도구 호출을 그대로 실행하지 않고, `App.jsx`가 지도·드롭다운 클릭과 **동일하게** 사용하는 `setSelected`/`setIndustry`/`setMetric` 함수를 그대로 호출합니다 — 별도의 렌더링 경로가 아니라 기존 상태 갱신 경로를 공유합니다. 지역 id는 LLM이 만들어 보내면 `resolveRegion`으로 검증 후 성공한 경우에만 반영합니다(존재하지 않는 id는 조용히 무시).
- **정직성**: 시스템 프롬프트가 제공된 수치 외 추측을 금지하며, 값이 없으면 화면 UI와 동일하게 "자료 없음"/"비교 불가"라고 답하도록 지시합니다. 백엔드는 결제금액·업체당 평균 매출 같은 수치를 직접 계산하지 않고, `data.js`가 이미 계산한 값만 그대로 전달받아 인용합니다.

소스: backend/main.py, backend/llm_client.py, src/components/ChatPanel.jsx, src/App.jsx.
