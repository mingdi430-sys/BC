import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

// 시도별 상가업소 CSV 폴더(기본: 저장소 두 단계 위의 "소상공인시장진흥공단_상가(상권)정보_20260630").
export const CSV_DIR = process.argv[2] || decodeURIComponent(new URL("../../../../소상공인시장진흥공단_상가(상권)정보_20260630", import.meta.url).pathname);
// CSV 열 위치
export const COL = { midCode: 5, smallCode: 7, smallName: 8, sido: 12, sigungu: 14 };

export const INDUSTRY_RULES = {
  // 소고기 구이/찜 (돼지갈비는 삼겹살 등과 분리 불가라 제외)
  갈비전문점: (c) => c.small === "I20108",
  // 한식 중분류에서 갈비(소고기구이)와 횟집을 뺀 나머지. 백반집이 다수라 한정식과는 분리 불가.
  일반한식: (c) => c.mid === "I201" && c.small !== "I20108" && c.small !== "I20111",
  // 일식 + 횟집(회집)
  일식회집: (c) => c.mid === "I203" || c.small === "I20111",
  중국음식: (c) => c.mid === "I202",
  // 카페는 BC 11개 업종에 없으므로 포함하지 않는다.
  서양음식: (c) => c.mid === "I204" || ["I21003", "I21004", "I21005"].includes(c.small),
  스넥: (c) => ["I21006", "I21007"].includes(c.small),
  "제 과 점": (c) => ["I21001", "I21002"].includes(c.small),
  "편 의 점": (c) => c.small === "G20405",
  "슈퍼 마켓": (c) => c.small === "G20404",
};
// 한정식: SEMAS에 "백반/한정식" 단일 코드뿐이라 BC 한정식과 대응 불가.
// 대형할인점: SEMAS 종합소매에 대형마트 코드가 없고, 상호명으로 세면 소상공인 데이터에 대형 점포가
// 대부분 빠져 있어 신뢰할 수 없다(메가마트 117개, 코스트코 2개 등).
export const UNAVAILABLE = ["한정식", "대형할인점"];

export const MAPPING_NOTES = {
  갈비전문점: "소고기 구이/찜 (돼지갈비 제외)",
  일반한식: "한식 전체 − 소고기 구이/찜 − 횟집 (백반 포함)",
  일식회집: "일식 전체 + 횟집",
  중국음식: "중식 전체",
  서양음식: "서양식 + 피자 + 버거 + 토스트/샌드위치 (카페 제외)",
  스넥: "치킨 + 김밥/만두/분식",
  "제 과 점": "빵/도넛 + 떡/한과",
  "편 의 점": "편의점",
  "슈퍼 마켓": "슈퍼마켓",
  한정식: "대응 코드 없음(백반/한정식 단일 코드) — 자료 없음",
  대형할인점: "소상공인 상가정보에 대형마트 코드·점포가 없음 — 자료 없음",
};

export function parse(line) {
  const out = [];
  const n = line.length;
  let i = 0;
  while (i <= n) {
    if (line[i] === '"') {
      let j = i + 1;
      let s = "";
      while (j < n) {
        if (line[j] === '"') {
          if (line[j + 1] === '"') {
            s += '"';
            j += 2;
            continue;
          }
          break;
        }
        s += line[j++];
      }
      out.push(s);
      i = j + 2;
    } else {
      let j = line.indexOf(",", i);
      if (j < 0) j = n;
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

export const norm = (s) => s.replace(/\s+/g, "");
// 2026-07-01부로 광주광역시+전라남도가 "전남광주통합특별시"로 통합(SEMAS 기준). 하위 시군구명은 유지.
export const PROVINCE_ALIASES = { 광주광역시: "전남광주통합특별시", 전라남도: "전남광주통합특별시" };

export const card = JSON.parse(
  fs.readFileSync(new URL("../../src/cardData.json", import.meta.url), "utf8"),
);
export const regionByKey = new Map();
for (const r of card.regions) {
  regionByKey.set(norm(r.province) + "|" + norm(r.name), r.id);
  const alias = PROVINCE_ALIASES[r.province];
  if (alias) regionByKey.set(norm(alias) + "|" + norm(r.name), r.id);
}


// 시도별 CSV를 한 줄씩 읽어 (fields) 콜백에 넘긴다.
export async function eachRow(onRow) {
  for (const file of fs.readdirSync(CSV_DIR).filter((f) => f.endsWith(".csv")).sort()) {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(CSV_DIR, file), "utf8"),
      crlfDelay: Infinity,
    });
    let header = true;
    for await (const line of rl) {
      if (header) {
        header = false;
        continue;
      }
      onRow(parse(line));
    }
    console.error(file);
  }
}
