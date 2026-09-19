"""BC카드 CSV를 DuckDB 인메모리 테이블 `card` 로 올리고, 읽기 전용 SQL만 실행한다.

열 (LLM에게 그대로 알려주는 스키마):
  month        INTEGER  결제 연월 (202601 ~ 202606)
  sido         VARCHAR  시도 (예: 서울특별시)
  sigungu      VARCHAR  시군구 (예: 성북구, 성남시 분당구)
  gender_cd    VARCHAR  성별 코드 ('1' 남성, '2' 여성, '3' 외국인, 'x' 미상)
  gender       VARCHAR  성별 라벨
  age_cd       VARCHAR  연령 코드 ('1' 20대 이하 … '6' 60대 이상, 'x' 미상)
  age          VARCHAR  연령 라벨
  industry     VARCHAR  업종 (공백 제거: 편의점, 슈퍼마켓, 제과점, 일반한식 …)
  amt          BIGINT   결제 금액(원)
  cnt          BIGINT   결제 건수
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import duckdb

CSV = Path(__file__).resolve().parents[1] / "ABP_CONTEST_DATA.csv"
POPULATION_JSON = Path(__file__).resolve().parents[1] / "src" / "populationData.json"
DENSITY_JSON = Path(__file__).resolve().parents[1] / "src" / "businessDensityData.json"
GENDER = {"1": "남성", "2": "여성", "3": "외국인", "x": "성별 미상"}
AGE = {"1": "20대 이하", "2": "20대", "3": "30대", "4": "40대", "5": "50대", "6": "60대 이상", "x": "연령 미상"}
MAX_ROWS = 200
FORBIDDEN = re.compile(r"\b(insert|update|delete|drop|alter|create|attach|detach|copy|export|import|pragma|install|load|call|set|reset|vacuum|checkpoint)\b", re.I)

SCHEMA_TEXT = """테이블 card (BC카드 결제 집계, 2026년 1~6월, 행 = 연월×시도×시군구×성별×연령×업종)
- month INTEGER: 202601~202606
- sido VARCHAR: 시도 전체 이름 (서울특별시, 부산광역시, 경기도, 강원특별자치도, 전북특별자치도, 세종특별자치시 …)
- sigungu VARCHAR: 시군구 (성북구, 성동구, 강릉시, 성남시 분당구 …). 도(道)의 구는 '시 구' 형태.
- gender_cd VARCHAR: '1' 남성, '2' 여성, '3' 외국인, 'x' 미상  /  gender VARCHAR: 라벨
- age_cd VARCHAR: '1' 20대 이하, '2' 20대, '3' 30대, '4' 40대, '5' 50대, '6' 60대 이상, 'x' 미상  /  age VARCHAR: 라벨
- industry VARCHAR: 대형할인점, 편의점, 슈퍼마켓, 일반한식, 갈비전문점, 한정식, 일식회집, 중국음식, 서양음식, 스넥, 제과점
- amt BIGINT: 결제 금액(원), cnt BIGINT: 결제 건수
주의: 성별·연령이 'x'(미상)인 행은 합계에는 포함되지만 성별·연령 비율을 낼 때는 제외해야 한다. 여성 비율 = 여성 amt / (남성+여성 amt).

테이블 population (행정안전부 주민등록인구, 시군구 단위, 업종 무관)
- sido VARCHAR, sigungu VARCHAR, population BIGINT
- 252개 시군구만 있음(인천 3개 구는 행정구역 개편으로 매칭 불가 → 없음). card와 조인할 땐 LEFT JOIN 쓰고
  population이 NULL이면 그 지역은 1인당 계산에서 제외하고 있다고 밝혀라.

테이블 competitors (소상공인시장진흥공단 상가업소, 시군구×업종 단위 동일업종 점포 수)
- sido VARCHAR, sigungu VARCHAR, industry VARCHAR, count BIGINT
- population과 마찬가지로 252개 시군구만 있음. 업체당 평균매출(추정) = 결제금액 / count.

1인당·업체당 질의 예시:
SELECT c.sido, c.sigungu, SUM(c.amt) AS total_amt, p.population, SUM(c.amt)/p.population AS per_capita
FROM card c JOIN population p ON c.sido=p.sido AND c.sigungu=p.sigungu
WHERE c.industry='스넥' GROUP BY c.sido, c.sigungu, p.population ORDER BY per_capita DESC"""


class CardStore:
    def __init__(self, csv: Path = CSV):
        self.con = duckdb.connect(database=":memory:")
        self.con.execute("CREATE TABLE gmap(code VARCHAR, label VARCHAR)")
        self.con.executemany("INSERT INTO gmap VALUES (?, ?)", list(GENDER.items()))
        self.con.execute("CREATE TABLE amap(code VARCHAR, label VARCHAR)")
        self.con.executemany("INSERT INTO amap VALUES (?, ?)", list(AGE.items()))
        self.con.execute(f"""
            CREATE TABLE card AS
            SELECT CAST(STRD_YYMM AS INTEGER) AS month, SIDO_NM AS sido, CCG_NM AS sigungu,
                   CAST(GENDER_CD AS VARCHAR) AS gender_cd, COALESCE(g.label, '성별 미상') AS gender,
                   CAST(AGE_CD AS VARCHAR) AS age_cd, COALESCE(a.label, '연령 미상') AS age,
                   regexp_replace(TP_BUZ_NM, '\\s+', '', 'g') AS industry,
                   CAST(amt AS BIGINT) AS amt, CAST(cnt AS BIGINT) AS cnt
            FROM read_csv_auto('{csv.as_posix()}', header=true, all_varchar=true) r
            LEFT JOIN gmap g ON g.code = CAST(r.GENDER_CD AS VARCHAR)
            LEFT JOIN amap a ON a.code = CAST(r.AGE_CD AS VARCHAR)
        """)
        self.rows = self.con.execute("SELECT count(*) FROM card").fetchone()[0]

        self.con.execute("CREATE TABLE population(sido VARCHAR, sigungu VARCHAR, population BIGINT)")
        pop = json.loads(POPULATION_JSON.read_text(encoding="utf-8"))["data"]
        pop_rows = []
        for region_id, cell in pop.items():
            sido, sigungu = region_id.split("|", 1)
            pop_rows.append((sido, sigungu, cell.get("population")))
        self.con.executemany("INSERT INTO population VALUES (?, ?, ?)", pop_rows)

        self.con.execute("CREATE TABLE competitors(sido VARCHAR, sigungu VARCHAR, industry VARCHAR, count BIGINT)")
        density = json.loads(DENSITY_JSON.read_text(encoding="utf-8"))["data"]
        density_rows = []
        for region_id, by_industry in density.items():
            sido, sigungu = region_id.split("|", 1)
            for industry, count in by_industry.items():
                density_rows.append((sido, sigungu, re.sub(r"\s+", "", industry), count))
        self.con.executemany("INSERT INTO competitors VALUES (?, ?, ?, ?)", density_rows)

    def validate(self, sql: str) -> str:
        s = sql.strip().rstrip(";").strip()
        if ";" in s:
            raise ValueError("문장은 하나만 허용됩니다.")
        if not re.match(r"^(select|with)\b", s, re.I):
            raise ValueError("SELECT 문만 허용됩니다.")
        if FORBIDDEN.search(s):
            raise ValueError("허용되지 않는 키워드가 있습니다.")
        if not re.search(r"\blimit\b", s, re.I):
            s += f" LIMIT {MAX_ROWS}"
        return s

    def query(self, sql: str) -> dict:
        s = self.validate(sql)
        cur = self.con.execute(s)
        cols = [d[0] for d in cur.description]
        rows = cur.fetchmany(MAX_ROWS)
        return {"sql": s, "columns": cols, "rows": [[_py(v) for v in r] for r in rows], "truncated": len(rows) >= MAX_ROWS}


def _py(v):
    if hasattr(v, "item"):
        return v.item()
    return v
