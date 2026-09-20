// 엔진 C(유행 수명주기) 데이터 조회. 원본: src/trendData.json (engine_c/trendlight/export_web.py 가 생성)
import source from "./trendData.json";

export const trendMeta = source.meta;
export const trendWeeks = source.weeks;
export const trendKeywords = Object.keys(source.keywords);
// 온디맨드로 받아온 항목을 풀에 등록 (같은 세션 동안 유지)
export function registerTrend(keyword, entry) {
  source.keywords[keyword] = entry;
  if (!trendKeywords.includes(keyword)) trendKeywords.push(keyword);
}
export const candidates = source.candidates;
export const trending = source.trending || [];
export const generatedAt = source.generated;

export const STAGE_LABEL = { emerging: "태동", surging: "급등", peak: "정점", declining: "하락", stable: "안정" };
// TrendLifecycle 의 6단계(초기·성장·급성장·정점·하락·안정) 위치
export const STAGE_INDEX = { emerging: 1, surging: 2, peak: 3, declining: 4, stable: 5 };
export const STAGE_TEXT = {
  emerging: "검색이 잡음 이상으로 늘기 시작했습니다. 유행 초입입니다.",
  surging: "최근 4주 검색이 50% 넘게 뛰었습니다. 이미 많이 알려진 상태라 정점이 멀지 않을 수 있습니다.",
  peak: "성장이 멈추고 꺾이기 시작했습니다.",
  declining: "검색이 최근 4주 연속 줄고 있습니다.",
  stable: "급변 없이 유지되는 안정 수요입니다. 유행 곡선이 아닙니다.",
};
export const SIGNAL_LABEL = { green: "초록", amber: "노랑", red: "빨강", grey: "회색" };
export const SIGNAL_COLOR = { green: "#1E9C58", amber: "#D99A06", red: "#D4413A", grey: "#98A4AC" };
export const AGE_LABEL = { 1: "20대 이하", 2: "20대", 3: "30대", 4: "40대", 5: "50대", 6: "60대 이상" };

export const normalizeName = (s) => (s || "").replace(/\s+/g, "");

// 보여주기 좋은 아이템: 곡선에 뚜렷한 봉우리가 있는 것(정점/중앙값 비율) 우선, 신호색이 골고루 섞이게
function shapeScore(e) {
  const v = (e.all || []).filter((x) => x != null && x > 0);
  if (v.length < 52) return 0;
  const s = v.slice().sort((a, b) => a - b), med = s[Math.floor(s.length / 2)] || 1e-9;
  return Math.max(...v) / med;
}
export function featuredKeywords(limit = 10, pool = trendKeywords) {
  const ranked = pool.map((k) => ({ k, e: source.keywords[k], sc: shapeScore(source.keywords[k]) }))
    .filter((x) => x.e && x.sc >= 3 && k_ok(x.k)).sort((a, b) => b.sc - a.sc);
  const out = [], seen = { green: 0, amber: 0, red: 0 };
  for (const x of ranked) { if (out.length >= limit) break; const sig = x.e.signal || "amber"; if (seen[sig] >= Math.ceil(limit / 2)) continue; seen[sig]++; out.push(x.k); }
  for (const x of ranked) { if (out.length >= limit) break; if (!out.includes(x.k)) out.push(x.k); }
  return out;
}
const k_ok = (k) => !/^(서울|부산|대구|광주|대전) /.test(k) && k.length >= 2 && k.length <= 8;

export function getTrend(keyword) {
  return source.keywords[normalizeKey(keyword)] || null;
}
function normalizeKey(k) {
  const clean = (k || "").trim();
  if (source.keywords[clean]) return clean;
  const hit = trendKeywords.find((x) => normalizeName(x) === normalizeName(clean));
  return hit || clean;
}

// 업종(카드 데이터 원문, 공백 포함 가능)에 해당하는 키워드·후보
export function keywordsForIndustry(industry) {
  const ind = normalizeName(industry);
  return trendKeywords.filter((k) => normalizeName(source.keywords[k].industry) === ind);
}
export function candidatesForIndustry(industry, limit = 12) {
  const ind = normalizeName(industry);
  return candidates.filter((c) => normalizeName(c.industry) === ind).slice(0, limit);
}

// 최근 n주 평균 (null 제외)
export function recentMean(arr, n = 26) {
  const v = (arr || []).slice(-n).filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
export const idx = (v) => (v == null ? "–" : (v * 100).toFixed(v * 100 < 1 ? 2 : 1));
