// build-m6-castles.mjs — m6 地図あそびの「日本100名城」(ab-108)の表を作る。
// 元: Wikidata(CC0)。「の一部(P361)= 日本100名城(Q1139439)」の城と、その番号(修飾子 P1545)・座標(P625)。
// 2026-10-04 に取ったときは五稜郭だけ番号が付いていなかったので、公式の番号(2)を FIX で補う。
// 座標が2つある城は桁の多い方を使う。県は src/m5/prefectures.geojson の内外で決める(海沿いで簡略化した県境の外に出る城は、
// いちばん近い県境の頂点の県)。出力: src/m6/castles.json([番号, 名前, 緯度, 経度, 県, Wikidata の Q番号] の100行)。
// 作り直すときは `node scripts/build-m6-castles.mjs`。100件そろわなければ書かずに止まる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inGeometry, distKm } from "../src/m6/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/m6/castles.json");
const PREFS = JSON.parse(fs.readFileSync(path.join(HERE, "../src/m5/prefectures.geojson"), "utf8")).features;
function prefAt(lat, lng) {
  const hit = PREFS.find((f) => inGeometry([lng, lat], f.geometry));
  if (hit) return hit.properties.N03_001;
  let best = null, bd = Infinity;
  for (const f of PREFS) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    for (const [x, y] of poly[0]) { const d = distKm({ lat, lng }, { lat: y, lng: x }); if (d < bd) { bd = d; best = f.properties.N03_001; } }
  return best;
}
const FIX = { Q1196357: 2 }; // 五稜郭
const UA = { "User-Agent": "a1-m6-map/0.1 (https://moriyatakashi.github.io/a1/)", Accept: "application/sparql-results+json" };
const QUERY = `SELECT ?c ?cLabel ?coord ?num WHERE {
  ?c p:P361 ?st . ?st ps:P361 wd:Q1139439 . OPTIONAL { ?st pq:P1545 ?num }
  OPTIONAL { ?c wdt:P625 ?coord }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". } }`;

const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(QUERY), { headers: UA });
if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
const byNum = new Map();
for (const b of (await res.json()).results.bindings) {
  const qid = b.c.value.split("/").pop();
  const num = FIX[qid] || Number(b.num?.value);
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value || "");
  if (!num || !m) continue;
  const prec = m[1].length + m[2].length;
  if (byNum.has(num) && byNum.get(num).prec >= prec) continue;
  const lat = Number(Number(m[2]).toFixed(5)), lng = Number(Number(m[1]).toFixed(5));
  byNum.set(num, { prec, row: [num, b.cLabel.value, lat, lng, prefAt(lat, lng), qid] });
}
const rows = [...byNum.values()].map((x) => x.row).sort((a, b) => a[0] - b[0]);
const missing = Array.from({ length: 100 }, (_, i) => i + 1).filter((n) => !byNum.has(n));
if (rows.length !== 100 || missing.length) throw new Error(`100件そろわない(${rows.length}件、欠け: ${missing.join(",")})`);
fs.writeFileSync(OUT, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
console.log("100件", OUT);
