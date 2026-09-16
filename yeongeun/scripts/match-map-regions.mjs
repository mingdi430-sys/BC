import fs from "node:fs";
import assert from "node:assert/strict";
const file = new URL("../public/maps/districts.json", import.meta.url),
  geo = JSON.parse(fs.readFileSync(file, "utf8")),
  data = JSON.parse(
    fs.readFileSync(new URL("../src/cardData.json", import.meta.url), "utf8"),
  );
const matched = new Set();
for (const f of geo.features) {
  const p = f.properties;
  const key = (s) => s.replace(/\s+/g, "");
  let candidates = data.regions.filter(
    (r) => r.province === p.sidonm && key(r.name) === key(p.sggnm),
  );
  if (p.sgg === "36110")
    candidates = data.regions.filter((r) => r.province === p.sidonm);
  assert.equal(
    candidates.length,
    1,
    "Non-unique region match: " + JSON.stringify(p),
  );
  p.sourceName ??= p.sggnm;
  p.sggnm = candidates[0].name;
  assert(!matched.has(candidates[0].id));
  matched.add(candidates[0].id);
}
assert.equal(matched.size, data.regions.length);
fs.writeFileSync(file, JSON.stringify(geo));
console.log(
  "PASS: All " +
    matched.size +
    " CSV regions match exactly one actual boundary. Only whitespace and the explicit Sejong name alias were normalized.",
);
