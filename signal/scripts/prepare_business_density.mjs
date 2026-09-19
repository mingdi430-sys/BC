/*
 * 소상공인시장진흥공단 상가(상권)정보 CSV(시도별 파일)에서 시군구 x BC카드 업종별
 * "점포 수(공급)"를 집계해 src/businessDensityData.json 으로 저장한다.
 *
 *   node scripts/prepare_business_density.mjs [CSV 폴더]
 *   (폴더 기본값: 이 저장소 두 단계 위의 "소상공인시장진흥공단_상가(상권)정보_20260630")
 *
 * 매칭 원칙: SEMAS 상권업종 분류(대/중/소분류)는 BC카드 TP_BUZ_NM(자체 11개 분류)과
 * 체계가 달라 1:1 매칭이 불가능하다. 아래 규칙은 실제 코드 정의를 확인해 고른 근사치이며,
 * 정확한 대응이 없는 업종(한정식)은 억지로 채우지 않고 "자료 없음"으로 둔다.
 * 출력 JSON의 meta.mapping 에 규칙 설명을 남겨 화면에서도 근사치임을 밝힌다.
 */
import fs from "node:fs";
import {
  COL,
  INDUSTRY_RULES,
  UNAVAILABLE,
  MAPPING_NOTES,
  norm,
  card,
  regionByKey,
  eachRow,
} from "./lib/business-rules.mjs";

const counts = new Map(); // regionId -> { 업종: n }
const detail = new Map(); // regionId -> 업종 -> 세부 코드 -> n
const codeNames = {};
const seenKeys = new Set();
const unmatchedSemas = new Map();
let rows = 0;

await eachRow((f) => {
  rows++;
  const key = norm(f[COL.sido]) + "|" + norm(f[COL.sigungu]);
  const id = regionByKey.get(key);
  if (!id) {
    const k = f[COL.sido] + "|" + f[COL.sigungu];
    unmatchedSemas.set(k, (unmatchedSemas.get(k) || 0) + 1);
    return;
  }
  seenKeys.add(id);
  const c = { mid: f[COL.midCode], small: f[COL.smallCode] };
  let bucket = counts.get(id);
  if (!bucket) {
    bucket = Object.fromEntries(Object.keys(INDUSTRY_RULES).map((k) => [k, 0]));
    counts.set(id, bucket);
  }
  for (const [industry, rule] of Object.entries(INDUSTRY_RULES)) {
    if (!rule(c)) continue;
    bucket[industry]++;
    codeNames[c.small] = f[COL.smallName];
    const byIndustry = detail.get(id) ?? detail.set(id, {}).get(id);
    const codesOf = (byIndustry[industry] ??= {});
    codesOf[c.small] = (codesOf[c.small] || 0) + 1;
  }
});

const data = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b, "ko")));
const unmatchedBc = card.regions.map((r) => r.id).filter((id) => !seenKeys.has(id));

fs.writeFileSync(
  new URL("../src/businessDensityData.json", import.meta.url),
  JSON.stringify({
    source: "소상공인시장진흥공단 상가(상권)정보 CSV",
    stdrYm: "202606",
    meta: { unavailable: UNAVAILABLE, mapping: MAPPING_NOTES },
    data,
  }),
);

console.log(`상가업소 ${rows.toLocaleString()}행 처리, BC 지역 ${seenKeys.size}/${card.regions.length} 매칭`);
console.log("BC 미매칭 지역:", unmatchedBc.join(", ") || "없음");
console.log("SEMAS 미매칭 시군구:", [...unmatchedSemas.entries()].map(([k, n]) => `${k}(${n})`).join(", ") || "없음");
const totals = {};
for (const b of Object.values(data)) for (const [k, n] of Object.entries(b)) totals[k] = (totals[k] || 0) + n;
console.log("업종별 전국 점포 수:", totals);

// 세부 업종(소분류) 구성: BC 업종 안에서 어떤 종류의 점포가 얼마나 있는지. 세부 코드가 하나뿐인 업종은 제외.
const nationalByCode = {};
for (const byIndustry of detail.values())
  for (const [industry, codes] of Object.entries(byIndustry))
    for (const [code, n] of Object.entries(codes)) {
      nationalByCode[industry] ??= {};
      nationalByCode[industry][code] = (nationalByCode[industry][code] || 0) + n;
    }
const industries = {};
for (const [industry, byCode] of Object.entries(nationalByCode)) {
  const list = Object.keys(byCode).sort((a, b) => byCode[b] - byCode[a]);
  if (list.length > 1) industries[industry] = list;
}
const detailData = {};
for (const [id, byIndustry] of [...detail.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"))) {
  detailData[id] = {};
  for (const [industry, list] of Object.entries(industries))
    detailData[id][industry] = list.map((code) => byIndustry[industry]?.[code] || 0);
}
const usedCodes = Object.fromEntries(
  [...new Set(Object.values(industries).flat())].map((c) => [c, codeNames[c]]),
);
fs.writeFileSync(
  new URL("../src/businessDetailData.json", import.meta.url),
  JSON.stringify({
    source: "소상공인시장진흥공단 상가(상권)정보 CSV",
    stdrYm: "202606",
    codes: usedCodes,
    industries,
    data: detailData,
  }),
);
console.log("세부 업종 구성:", Object.fromEntries(Object.entries(industries).map(([k, v]) => [k, v.map((c) => usedCodes[c]).join(" / ")])));
