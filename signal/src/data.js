import source from "./cardData.json";
export const meta = source.meta;
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
  if (!records.some((r) => r.hasData)) {
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
};
export const metricText = (r, k) =>
  r[k] == null
    ? "자료 없음"
    : k === "amount"
      ? money(r.amount)
      : k === "count"
        ? `${r.count.toLocaleString("ko-KR")}건`
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
export function resolveRegion(records, id) {
  return (
    records.find((r) => r.id === id) ||
    municipalityGroups(records).find((r) => r.id === id)
  );
}
