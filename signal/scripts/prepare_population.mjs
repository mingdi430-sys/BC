/*
 * 행정안전부 주민등록 인구 및 세대현황 API(data.go.kr, 1741000)에서
 * 지역(시군구)별 인구수를 받아와 src/populationData.json 으로 저장한다.
 * 지역 코드는 소상공인시장진흥공단 API와 동일한 시군구코드(5자리)를 쓰며,
 * 이 API는 시군구코드 뒤에 0을 5개 붙인 10자리 법정동코드 형태(stdgCd)로
 * 조회하고, 그 시군구에 속한 모든 법정동(읍면동) 인구를 합산해 구한다.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function popApi(params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus?serviceKey=${KEY}&type=json&${qs}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(350);
    try {
      const res = await fetch(url);
      const json = await res.json();
      const head = json?.Response?.head;
      if (!head) throw new Error(JSON.stringify(json).slice(0, 200));
      if (head.resultCode === "03") return []; // 결과 없음(정상)
      if (head.resultCode !== "0" && head.resultCode !== "00")
        throw new Error(head.resultMsg || "unknown error");
      const items = json.Response.items;
      if (!items) return [];
      const raw = items.item;
      return Array.isArray(raw) ? raw : raw ? [raw] : [];
    } catch (e) {
      if (attempt === 7) throw e;
      const rateLimited = /LIMIT|초과/.test(e.message);
      await sleep(rateLimited ? 2500 : 800 * (attempt + 1));
    }
  }
}

async function baroApi(params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const url = `https://apis.data.go.kr/B553077/api/open/sdsc2/baroApi?serviceKey=${KEY}&type=json&${qs}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(350);
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json?.header?.resultCode !== "00")
        throw new Error(json?.header?.resultMsg || JSON.stringify(json).slice(0, 200));
      return json.body;
    } catch (e) {
      if (attempt === 7) throw e;
      const rateLimited = /LIMIT|초과/.test(e.message);
      await sleep(rateLimited ? 2500 : 800 * (attempt + 1));
    }
  }
}

async function fetchAllSignguCodes() {
  const provinces = await baroApi({ resId: "dong", catId: "mega" });
  const out = [];
  for (const p of provinces.items) {
    const list = await baroApi({ resId: "dong", catId: "cty", ctprvnCd: p.ctprvnCd });
    for (const g of list.items)
      out.push({ ctprvnNm: g.ctprvnNm, signguNm: g.signguNm, signguCd: g.signguCd });
  }
  return out;
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

function loadRegionCatalog() {
  const card = JSON.parse(
    fs.readFileSync(new URL("../src/cardData.json", import.meta.url), "utf8"),
  );
  return card.regions;
}

function loadExisting() {
  const path = new URL("../src/populationData.json", import.meta.url);
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

  const result = loadExisting();
  const unmatched = [];
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
    const stdgCd = hit.signguCd + "00000";
    try {
      const items = await popApi({
        stdgCd,
        lv: 3,
        regSeCd: 1,
        srchFrYm: "202606",
        srchToYm: "202606",
        numOfRows: 300,
        pageNo: 1,
      });
      const total = items.reduce((s, it) => s + Number(it.totNmprCnt || 0), 0);
      result[r.id] = { population: total, dongCount: items.length };
    } catch (e) {
      console.error("실패:", r.id, e.message);
      result[r.id] = null;
    }
    done++;
    if (done % 20 === 0) console.log(`${done}/${regions.length}`);
  }

  fs.writeFileSync(
    new URL("../src/populationData.json", import.meta.url),
    JSON.stringify({ source: "행정안전부 주민등록 인구현황", statsYm: "202606", data: result }),
  );
  console.log("완료:", regions.length - unmatched.length, "/", regions.length, "지역 매칭");
  if (unmatched.length) console.log("미매칭 지역:", unmatched.join(", "));
}

main();
