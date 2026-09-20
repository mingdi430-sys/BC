import source from "./cardData.json";
import genderAgeSource from "./genderAgeData.json";
import densitySource from "./businessDensityData.json";
import detailSource from "./businessDetailData.json";
export const meta = source.meta;
// 소상공인시장진흥공단 상가(상권)정보 기반 점포 수(공급). 업종 매칭은 근사치이고, 대응이 없는 업종·지역은 null.
export const densityMeta = { ...densitySource.meta, stdrYm: densitySource.stdrYm };
export const storesFor = (id, industry) => densitySource.data[id]?.[industry] ?? null;
// 원자료의 업종명에 섞인 어색한 공백 제거 (매칭용 키는 원문 그대로 유지, 화면 표시만 붙여쓰기)
export const industryLabel = (name) => (name || "").replace(/\s+/g, "");
export const AGE_GROUPS = ["2", "3", "4", "5", "6"]; // 20대~60대이상 (20대이하 '1', 미상 'x' 제외)
export const GENDER_GROUPS = ["1", "2"]; // 남성, 여성 (외국인 '3', 미상 'x' 제외)
// 성별x연령 교차 이용건수 (cardData.json의 ages/genders는 결제금액 주변분포만 있어 별도 파일에서 가져온다)
export function genderAgeFor(region, industry) {
  const ids = region.isAggregate ? region.memberIds : [region.id];
  const totals = Object.fromEntries(
    GENDER_GROUPS.map((g) => [g, Object.fromEntries(AGE_GROUPS.map((a) => [a, 0]))]),
  );
  for (const id of ids) {
    const [province, name] = id.split("|");
    const cell = genderAgeSource[`${province}|${name}|${industry}`];
    if (!cell) continue;
    for (const g of GENDER_GROUPS)
      for (const a of AGE_GROUPS) totals[g][a] += cell[g]?.[a] || 0;
  }
  return totals;
}
export const industries = source.industries;
export const provinces = [...new Set(source.regions.map((r) => r.province))];
export const regionCatalog = source.regions;
export const months = meta.months;
export const genderLabels = meta.genderCodes;
export const ageLabels = meta.ageCodes;
export const period = `${months[0].slice(0, 4)}.${months[0].slice(4)} – ${months.at(-1).slice(0, 4)}.${months.at(-1).slice(4)}`;
export function change(monthly) {
  const current = monthly[months.at(-1)],
    previous = monthly[months.at(-2)];
  return !current || !previous || previous.amount === 0
    ? null
    : (current.amount / previous.amount - 1) * 100;
}
export function periodChange(monthly) {
  const first = monthly[months[0]],
    last = monthly[months.at(-1)];
  return !first || !last || first.amount === 0
    ? null
    : (last.amount / first.amount - 1) * 100;
}
const perStore = (amount, stores) => (stores > 0 ? amount / stores : null);
export function getRecords(industry) {
  const found = new Map(
    source.records.filter((r) => r.industry === industry).map((r) => [r.id, r]),
  );
  const ranked = [...found.values()].sort((a, b) => b.amount - a.amount),
    rankOf = new Map(ranked.map((r, i) => [r.id, i + 1])),
    nationalTotal = ranked.length;
  return regionCatalog.map((r) => {
    const match = found.get(r.id);
    return match
      ? {
          ...match,
          hasData: true,
          stores: storesFor(match.id, industry),
          amountPerStore: perStore(match.amount, storesFor(match.id, industry)),
          growth: change(match.monthly),
          periodGrowth: periodChange(match.monthly),
          nationalRank: rankOf.get(r.id),
          nationalTotal,
          lowSample: Object.keys(match.monthly).length <= 2,
        }
      : {
          ...r,
          industry,
          hasData: false,
          amount: null,
          count: null,
          stores: storesFor(r.id, industry),
          amountPerStore: null,
          growth: null,
          periodGrowth: null,
          nationalRank: null,
          nationalTotal,
          lowSample: false,
          monthly: {},
          ages: {},
          genders: {},
        };
  });
}
export function summarize(records) {
  const result = { amount: 0, count: 0, monthly: {}, ages: {}, genders: {} };
  for (const r of records) {
    if (!r.hasData) continue;
    result.amount += r.amount;
    result.count += r.count;
    for (const [m, v] of Object.entries(r.monthly)) {
      result.monthly[m] ??= { amount: 0, count: 0 };
      result.monthly[m].amount += v.amount;
      result.monthly[m].count += v.count;
    }
    for (const field of ["ages", "genders"])
      for (const [k, v] of Object.entries(r[field]))
        result[field][k] = (result[field][k] || 0) + v;
  }
  result.growth = change(result.monthly);
  // 합산한 지역 중 하나라도 점포 수를 모르면 점포당 금액은 왜곡되므로 산출하지 않는다.
  const withData = records.filter((r) => r.hasData);
  result.stores =
    withData.length && withData.every((r) => r.stores != null)
      ? withData.reduce((s, r) => s + r.stores, 0)
      : null;
  result.amountPerStore = perStore(result.amount, result.stores);
  if (!withData.length) {
    result.amount = null;
    result.count = null;
  }
  return result;
}
export const money = (n) =>
  n == null
    ? "자료 없음"
    : Math.abs(n) >= 1e8
      ? `${(n / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}억 원`
      : `${n.toLocaleString("ko-KR")}원`;
export const signed = (n) =>
  n == null ? "비교 불가" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
export const direction = (n) =>
  n == null
    ? "비교 불가"
    : n > 0
      ? "최근 증가"
      : n < 0
        ? "최근 감소"
        : "변화 없음";
export function topRegions(records, limit = 8) {
  const withData = records.filter((r) => r.hasData);
  const total = withData.reduce((s, r) => s + r.amount, 0) || 1;
  return withData
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((r) => ({ ...r, share: (r.amount / total) * 100 }));
}
export const metrics = {
  amount: "기간 결제금액",
  count: "기간 결제 건수",
  growth: "최근 월 증감률",
  amountPerStore: "점포당 결제금액(근사)",
};
export const metricText = (r, k) =>
  r[k] == null
    ? "자료 없음"
    : k === "amount"
      ? money(r.amount)
      : k === "count"
        ? `${r.count.toLocaleString("ko-KR")}건`
        : k === "amountPerStore"
          ? money(Math.round(r.amountPerStore))
          : signed(r.growth);

// Municipality groups retain CSV leaf records; only named city + district pairs aggregate.
export const municipalityName = (record) =>
  record.name.includes(" ") ? record.name.split(" ")[0] : record.name;
export function municipalityGroups(records) {
  const buckets = new Map();
  for (const r of records) {
    const key = r.province + "|" + municipalityName(r);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  return [...buckets.entries()]
    .map(([key, members]) => {
      const first = members[0],
        name = municipalityName(first);
      if (members.length === 1 && first.name === name)
        return { ...first, memberIds: [first.id] };
      return {
        ...summarize(members),
        id: "city:" + key,
        province: first.province,
        name,
        industry: first.industry,
        hasData: members.some((r) => r.hasData),
        isAggregate: true,
        memberIds: members.map((r) => r.id),
        availableMembers: members.filter((r) => r.hasData).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
// 월별 결제금액의 최소제곱 추세선 기울기를 평균으로 나눈 값(월평균 증감 비율).
// 단일 월(6월/5월) 비교는 영업일 수·계절 요인에 좌우되므로 4개월 이상 자료가 있을 때만 추세를 낸다.
export function trendSlope(monthly) {
  const pts = months
    .map((m, i) => [i, monthly[m]?.amount])
    .filter(([, y]) => y != null);
  if (pts.length < 4) return null;
  const n = pts.length,
    mx = pts.reduce((s, [x]) => s + x, 0) / n,
    my = pts.reduce((s, [, y]) => s + y, 0) / n;
  const varX = pts.reduce((s, [x]) => s + (x - mx) ** 2, 0);
  return my > 0
    ? pts.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / varX / my
    : null;
}
// BC 업종 안의 세부 업종(SEMAS 소분류)별 점포 구성과 전국 구성 대비 비율. 세부 구분이 없는 업종·지역은 null.
const nationalMixCache = new Map();
function nationalMix(industry) {
  if (!nationalMixCache.has(industry)) {
    const totals = detailSource.industries[industry].map(() => 0);
    for (const byIndustry of Object.values(detailSource.data))
      byIndustry[industry]?.forEach((n, i) => (totals[i] += n));
    nationalMixCache.set(industry, totals);
  }
  return nationalMixCache.get(industry);
}
export function subcategoryMix(region, industry) {
  const codes = detailSource.industries[industry];
  if (!codes) return null;
  const ids = region.isAggregate ? region.memberIds : [region.id];
  const parts = ids.map((id) => detailSource.data[id]?.[industry]).filter(Boolean);
  if (!parts.length) return null;
  const counts = codes.map((_, i) => parts.reduce((s, p) => s + p[i], 0)),
    total = counts.reduce((s, n) => s + n, 0),
    national = nationalMix(industry),
    nationalTotal = national.reduce((s, n) => s + n, 0);
  if (!total) return null;
  return {
    total,
    missing: ids.length - parts.length,
    rows: codes
      .map((code, i) => ({
        code,
        name: detailSource.codes[code],
        count: counts[i],
        share: counts[i] / total,
        nationalShare: national[i] / nationalTotal,
        ratio: counts[i] / total / (national[i] / nationalTotal),
      }))
      .sort((a, b) => b.count - a.count),
  };
}
// 수요(결제금액) 대비 공급(점포)이 적은 "기회 후보":
// 6개월 추세가 이 범위 전체 평균보다 빠르고 + 점포당 결제금액이 상위 25%인 지역.
// 점수가 아니라 조건 필터이며, 표본이 작은 지역(자료 월 부족·점포 MIN_STORES개 미만)은 제외한다.
// 공통 계절 요인은 범위 평균과의 차이로 상쇄된다.
export const MIN_STORES = 10;
export function opportunityRegions(records, topFrac = 0.25) {
  const baseline = trendSlope(summarize(records).monthly);
  const pool = records
    .filter(
      (r) =>
        r.hasData &&
        !r.lowSample &&
        r.amountPerStore != null &&
        r.stores >= MIN_STORES,
    )
    .map((r) => ({ ...r, trend: trendSlope(r.monthly) }))
    .filter((r) => r.trend != null);
  if (!pool.length || baseline == null) return { regions: [], threshold: null };
  const sorted = pool.map((r) => r.amountPerStore).sort((a, b) => a - b);
  const threshold =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - topFrac)))];
  return {
    regions: pool
      .filter((r) => r.trend > baseline && r.amountPerStore >= threshold)
      .map((r) => ({ ...r, excessTrend: r.trend - baseline }))
      .sort((a, b) => b.amountPerStore - a.amountPerStore),
    threshold,
    baseline,
  };
}
export function resolveRegion(records, id) {
  return (
    records.find((r) => r.id === id) ||
    municipalityGroups(records).find((r) => r.id === id)
  );
}
