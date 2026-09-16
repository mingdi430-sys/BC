/*
 * 소상공인시장진흥공단 상가(상권)정보 API(data.go.kr, B553077)에서
 * 지역(시군구) x 업종별 "경쟁업체 수"를 받아와 src/businessDensityData.json 으로 저장한다.
 *
 * 매칭 원칙: SEMAS의 상권업종 분류(대/중/소분류, KSIC 기반)는 BC카드의
 * TP_BUZ_NM(카드사 자체 11개 분류)와 체계가 달라 완벽한 1:1 매칭이 불가능하다.
 * 아래 매핑은 각 카테고리의 실제 원문 정의(업종 상세 동의어 목록)를 기준으로
 * 가장 근접한 SEMAS 소분류/중분류 코드를 선택한 근사치이며, 코드 옆 주석에
 * 근거를 남긴다. 정확한 업종 일치가 아니므로 화면에도 "근사 매칭"임을 표시한다.
 */
import fs from "node:fs";

function loadEnv() {
  const path = new URL("../.env", import.meta.url);
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();
const KEY = process.env.DATA_GO_KR_KEY;
if (!KEY) throw new Error(".env에 DATA_GO_KR_KEY가 없습니다.");

const BASE = "https://apis.data.go.kr/B553077/api/open/sdsc2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `${BASE}/${path}?serviceKey=${KEY}&type=json&${qs}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(350); // 초당 요청 제한을 넉넉히 피하기 위한 고정 간격
    try {
      const res = await fetch(url);
      const json = await res.json();
      const rateLimited =
        json?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode === "23";
      if (rateLimited) throw new Error("RATE_LIMITED");
      if (json?.header?.resultCode === "03") return { items: [], totalCount: 0 }; // 결과 없음(정상)
      if (json?.header?.resultCode !== "00")
        throw new Error(json?.header?.resultMsg || JSON.stringify(json).slice(0, 200));
      return json.body;
    } catch (e) {
      if (attempt === 7) throw e;
      const backoff = e.message === "RATE_LIMITED" ? 2500 : 800 * (attempt + 1);
      await sleep(backoff);
    }
  }
}

async function countStores(signguCd, params) {
  const body = await api("storeListInDong", {
    divId: "signguCd",
    key: signguCd,
    numOfRows: 1,
    pageNo: 1,
    ...params,
  });
  return Number(body?.totalCount || 0);
}

// BC카드 업종명 -> SEMAS 코드 매핑 (indsMclsCd: 중분류, indsSclsCd: 소분류).
// 일반한식/갈비전문점/한정식은 SEMAS의 "한식" 중분류(I201) 하나를 세 카드사
// 업종이 나눠 쓰는 구조라, 소고기구이·백반한정식 소분류를 먼저 빼고
// 나머지를 일반한식으로 계산한다. 지역별로 필요한 코드마다 개별 count 쿼리
// (코드 조합 필터는 API가 지원하지 않음).
async function regionTotals(signguCd) {
  const hanshikAll = await countStores(signguCd, { indsMclsCd: "I201" });
  const galbi = await countStores(signguCd, { indsSclsCd: "I20108" });
  const hanjeongsik = await countStores(signguCd, { indsSclsCd: "I20101" });
  const ilsik = await countStores(signguCd, { indsMclsCd: "I203" });
  const jungsik = await countStores(signguCd, { indsMclsCd: "I202" });
  const seoyangMcls = await countStores(signguCd, { indsMclsCd: "I204" });
  const cafe = await countStores(signguCd, { indsSclsCd: "I21201" });
  const pizza = await countStores(signguCd, { indsSclsCd: "I21003" });
  const burger = await countStores(signguCd, { indsSclsCd: "I21004" });
  const toast = await countStores(signguCd, { indsSclsCd: "I21005" });
  const chicken = await countStores(signguCd, { indsSclsCd: "I21006" });
  const bunsik = await countStores(signguCd, { indsSclsCd: "I21007" });
  const bread = await countStores(signguCd, { indsSclsCd: "I21001" });
  const tteok = await countStores(signguCd, { indsSclsCd: "I21002" });
  const mart = await countStores(signguCd, { indsSclsCd: "G20402" });
  const conv = await countStores(signguCd, { indsSclsCd: "G20405" });
  const super_ = await countStores(signguCd, { indsSclsCd: "G20404" });

  return {
    일반한식: Math.max(0, hanshikAll - galbi - hanjeongsik),
    갈비전문점: galbi,
    한정식: hanjeongsik,
    일식회집: ilsik,
    중국음식: jungsik,
    서양음식: seoyangMcls + cafe + pizza + burger + toast,
    스넥: chicken + bunsik,
    "제 과 점": bread + tteok,
    대형할인점: mart,
    "편 의 점": conv,
    "슈퍼 마켓": super_,
  };
}

async function fetchAllSignguCodes() {
  const provinces = await api("baroApi", { resId: "dong", catId: "mega" });
  const out = [];
  for (const p of provinces.items) {
    const list = await api("baroApi", {
      resId: "dong",
      catId: "cty",
      ctprvnCd: p.ctprvnCd,
    });
    for (const g of list.items)
      out.push({
        ctprvnNm: g.ctprvnNm,
        signguNm: g.signguNm,
        signguCd: g.signguCd,
      });
  }
  return out;
}

function loadRegionCatalog() {
  const card = JSON.parse(
    fs.readFileSync(new URL("../src/cardData.json", import.meta.url), "utf8"),
  );
  return card.regions; // [{id, province, name}]
}

function norm(s) {
  return s.replace(/\s+/g, "");
}

// 2026-07-01부로 광주광역시+전라남도가 "전남광주통합특별시"로 통합됐다(SEMAS
// 기준). 하위 시군구 이름 자체는 그대로 유지되므로 province 별칭으로 연결한다.
// 인천 동구/서구/중구는 같은 시기 제물포구/영종구/서해구/검단구로 분할 개편돼
// 옛 경계와 깔끔한 1:1 대응이 없어 억지로 연결하지 않고 "자료 없음"으로 둔다.
const PROVINCE_ALIASES = {
  광주광역시: "전남광주통합특별시",
  전라남도: "전남광주통합특별시",
};

function loadExisting() {
  const path = new URL("../src/businessDensityData.json", import.meta.url);
  if (!fs.existsSync(path)) return {};
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")).data || {};
  } catch {
    return {};
  }
}

async function main() {
  console.log("시군구 코드 목록 조회 중...");
  const signguList = await fetchAllSignguCodes();
  console.log(`${signguList.length}개 시군구 코드 수신`);

  const regions = loadRegionCatalog();
  const bySignguKey = new Map(
    signguList.map((s) => [norm(s.ctprvnNm) + "|" + norm(s.signguNm), s]),
  );
  function resolve(r) {
    return (
      bySignguKey.get(norm(r.province) + "|" + norm(r.name)) ||
      (PROVINCE_ALIASES[r.province] &&
        bySignguKey.get(norm(PROVINCE_ALIASES[r.province]) + "|" + norm(r.name)))
    );
  }

  const unmatched = [];
  const result = loadExisting();
  let done = 0;
  for (const r of regions) {
    if (result[r.id]) {
      done++;
      continue; // 이미 받아온 지역은 재요청하지 않음(재실행 시 이어받기)
    }
    const hit = resolve(r);
    if (!hit) {
      unmatched.push(r.id);
      done++;
      continue;
    }
    try {
      result[r.id] = await regionTotals(hit.signguCd);
    } catch (e) {
      console.error("실패:", r.id, e.message);
      result[r.id] = null;
    }
    done++;
    if (done % 20 === 0) console.log(`${done}/${regions.length}`);
  }

  fs.writeFileSync(
    new URL("../src/businessDensityData.json", import.meta.url),
    JSON.stringify({ source: "SEMAS sdsc2 storeListInDong", stdrYm: "202606", data: result }),
  );
  console.log("완료:", regions.length - unmatched.length, "/", regions.length, "지역 매칭");
  if (unmatched.length) console.log("미매칭 지역:", unmatched.join(", "));
}

main();
