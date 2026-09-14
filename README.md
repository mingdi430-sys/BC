# BC카드 상권분석 대시보드

BC카드 2026년 1~6월 시군구·업종별 소비데이터로 만든 상권분석 대시보드.
시도·업종을 고르면 지도가 매출 기준으로 색칠되고, 구를 클릭하면 오른쪽에 상세 분석이 뜹니다.

## 폴더 구조

```
.
├── index.html              # 메인 페이지
├── app.js                  # 대시보드 로직 (지도 렌더링, 데이터 바인딩)
├── style.css                # 다크 테마 스타일
├── prepare_data.py          # 원본 CSV -> data/region_biz.json 생성 스크립트
├── data/
│   ├── region_biz.json                        # 지역x업종별 집계 결과 (자동 생성됨)
│   ├── skorea_municipalities_geo_simple.json   # 시군구 경계 GeoJSON
│   └── skorea_provinces_geo_simple.json        # 시도 경계 GeoJSON (예비용, 아직 미사용)
├── vendor/leaflet/          # Leaflet.js 로컬 번들 (CDN 의존성 없음)
└── requirements.txt
```

## 실행 방법

### 1. 데이터 준비 (원본 CSV가 바뀌었을 때만 다시 실행)

```bash
pip install -r requirements.txt
python3 prepare_data.py
```
`/mnt/user-data/uploads/ABP_CONTEST_DATA.csv` 경로를 로컬 환경에 맞게 `prepare_data.py` 상단에서 수정하세요.

### 2. 로컬 서버 실행

브라우저 보안 정책상 `file://`로 직접 열면 `fetch()`가 막히므로, 반드시 로컬 서버로 띄워야 합니다.

```bash
python3 -m http.server 8000
```

그다음 브라우저에서 `http://localhost:8000` 접속.

## 화면 구성

- **좌측**: 시도 선택 / 업종 선택 드롭다운 + 지도(선택 업종 매출 기준 색칠, 클릭 시 지역 선택)
- **우측 (지역 수요 패널)**: 6개월 결제액, 결제건수, 건당금액, 전국 업종 순위, 기간 내 성장률, 월별 결제액 바차트, 결제액 상위 시군구 표
- 표본이 적은 지역(6개월 중 2개월 이하만 데이터 존재)은 경고 문구 표시

## 알려진 제약

- GeoJSON이 2013년 기준 행정구역이라 일부 지역(청주시 서원구·청원구 등)은 지도에 표시되지 않음 — `app.js`의 `resolveFeature()`에서 도시 단위로 폴백 처리
- 상가업소정보·인구통계 등 외부데이터는 아직 미연동

## 다음 작업 후보

- [ ] 시도 GeoJSON으로 전국 단위 개요 화면 추가
- [ ] 상가업소정보 연동해서 "인기업종 vs 선택업종" 비교 기능 추가
