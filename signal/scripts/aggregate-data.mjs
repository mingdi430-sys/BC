import fs from "node:fs";
import assert from "node:assert/strict";
const input = fs
  .readFileSync(new URL("../ABP_CONTEST_DATA.csv", import.meta.url), "utf8")
  .replace(/^\uFEFF/, "");
function parse(line) {
  return line
    .match(/("(?:[^"]|"")*"|[^,]*)(,|$)/g)
    .filter((x) => x)
    .map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
}
const lines = input.trim().split(/\r?\n/),
  header = parse(lines.shift());
assert.deepEqual(header, [
  "STRD_YYMM",
  "SIDO_NM",
  "CCG_NM",
  "GENDER_CD",
  "AGE_CD",
  "TP_BUZ_NO",
  "TP_BUZ_NM",
  "amt",
  "cnt",
]);
const groups = new Map(),
  regions = new Map(),
  industries = new Set(),
  months = new Set();
let sourceAmount = 0,
  sourceCount = 0;
for (const line of lines) {
  const [month, province, name, gender, age, code, industry, a, c] =
    parse(line);
  const amt = Number(a),
    cnt = Number(c);
  assert(
    province &&
      name &&
      industry &&
      /^\d{6}$/.test(month) &&
      Number.isFinite(amt) &&
      Number.isFinite(cnt),
    "Invalid CSV row",
  );
  const id = province + "|" + name,
    key = industry + "|" + id;
  regions.set(id, { id, province, name });
  industries.add(industry);
  months.add(month);
  sourceAmount += amt;
  sourceCount += cnt;
  if (!groups.has(key))
    groups.set(key, {
      id,
      province,
      name,
      industry,
      amount: 0,
      count: 0,
      monthly: {},
      genders: {},
      ages: {},
    });
  const g = groups.get(key);
  g.amount += amt;
  g.count += cnt;
  g.monthly[month] ??= { amount: 0, count: 0, rows: 0 };
  g.monthly[month].amount += amt;
  g.monthly[month].count += cnt;
  g.monthly[month].rows++;
  g.genders[gender] = (g.genders[gender] || 0) + amt;
  g.ages[age] = (g.ages[age] || 0) + amt;
}
const records = [...groups.values()];
assert.equal(
  records.reduce((s, r) => s + r.amount, 0),
  sourceAmount,
);
assert.equal(
  records.reduce((s, r) => s + r.count, 0),
  sourceCount,
);
const output = {
  meta: {
    source: "ABP_CONTEST_DATA.csv",
    rowCount: lines.length,
    months: [...months].sort(),
    regionCount: regions.size,
    provinceCount: new Set([...regions.values()].map((r) => r.province)).size,
    sourceAmount,
    sourceCount,
    unit: "amt: 원, cnt: 건",
    genderCodes: { 1: "남성", 2: "여성", 3: "외국인", x: "성별 미상" },
    ageCodes: {
      1: "20대 이하",
      2: "20대",
      3: "30대",
      4: "40대",
      5: "50대",
      6: "60대 이상",
      x: "연령 미상",
    },
  },
  industries: [...industries].sort(),
  regions: [...regions.values()].sort((a, b) => a.id.localeCompare(b.id, "ko")),
  records,
};
fs.writeFileSync(
  new URL("../src/cardData.json", import.meta.url),
  JSON.stringify(output),
);
console.log(
  JSON.stringify({
    ...output.meta,
    industryCount: industries.size,
    records: records.length,
  }),
);
