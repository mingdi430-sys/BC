"""
ABP_CONTEST_DATA.csv -> 지역x업종별 성별x연령 교차(이용건수) 집계.
cardData.json의 region.ages/region.genders는 결제금액 기준 주변분포(marginal)만 있어
성별x연령을 함께 쪼갠 값이 없다. 원자료에는 GENDER_CD/AGE_CD가 같은 행에 있으므로
여기서 새로 교차표를 만든다. 표준 라이브러리만 사용 (pandas 미설치 환경 대응).
"""
import csv
import json
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "ABP_CONTEST_DATA.csv")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "genderAgeData.json")

GENDERS = ("1", "2")             # 남성, 여성 (외국인 '3', 미상 'x' 제외)
AGES = ("2", "3", "4", "5", "6")  # 20대~60대이상 (20대이하 '1', 미상 'x' 제외)

data = {}

with open(SRC, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        gender = row["GENDER_CD"]
        age = row["AGE_CD"]
        if gender not in GENDERS or age not in AGES:
            continue
        key = row["SIDO_NM"] + "|" + row["CCG_NM"] + "|" + row["TP_BUZ_NM"]
        cnt = int(row["cnt"])
        bucket = data.setdefault(key, {g: {a: 0 for a in AGES} for g in GENDERS})
        bucket[gender][age] += cnt

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

print("완료:", OUT, round(os.path.getsize(OUT) / 1024 / 1024, 2), "MB, entries:", len(data))
