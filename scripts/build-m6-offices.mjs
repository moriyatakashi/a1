// build-m6-offices.mjs — m6 地図あそびの「市区町村役場」(ab-48)の表を作る。
// どの役所を並べるかは m6 の市区町村(src/m6/city/NN.json、2021-01-01 の行政区域)と同じにする(霧と1対1になるように)。
// 政令市は区役所に加えて市役所も入れる。座標は Wikidata(CC0)の市区町村の座標(P625)を団体コード(P429)で引く。
// 日本の市区町村の座標は役所の位置で入っている(10/07 に大阪市・横浜市・札幌市で確かめた)。
// 国土数値情報の「市町村役場等」(P34)は使用許諾が非商用で、2014年版と古いので使わない。
// 1つの団体コードに Wikidata の項目が2つ以上あるとき(役所の建物の項目など)は、名前が合う方を使う。
// 2024年に再編した浜松市の旧区は Wikidata に座標が無いので落とす(浜松市役所は入る)。
// 出力: src/m6/offices.json([団体コード, 役所の名前, 緯度, 経度, 県コード, 種類] の行。種類 1=市役所 2=区役所 3=町役場 4=村役場)。
// 作り直すときは `node scripts/build-m6-offices.mjs`。1800件に届かなければ書かずに止まる。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/m6/offices.json");
const UA = { "User-Agent": "a1-m6-map/0.1 (https://moriyatakashi.github.io/a1/)", Accept: "application/sparql-results+json" };
const QUERY = `SELECT ?m ?code ?l ?c WHERE { ?m wdt:P429 ?code ; wdt:P625 ?c .
  OPTIONAL { ?m rdfs:label ?l FILTER(LANG(?l) = "ja") } FILTER NOT EXISTS { ?m wdt:P576 [] } }`;

const res = await fetch("https://query.wikidata.org/sparql?query=" + encodeURIComponent(QUERY), { headers: UA });
if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
const byCode = new Map(); // 団体コード5桁 → [{ label, lat, lng }]
for (const b of (await res.json()).results.bindings) {
  const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.c.value);
  if (!m) continue;
  const k = b.code.value.slice(0, 5);
  byCode.set(k, [...(byCode.get(k) || []), { label: b.l ? b.l.value : "", lat: Number(m[2]), lng: Number(m[1]) }]);
}
// 名前が合う項目(区は「北区」のように市名なしのこともある)。無ければ「役所」「庁舎」でない項目。
function pick(code, name) {
  const hs = byCode.get(code) || [];
  return hs.find((h) => h.label === name) || hs.find((h) => h.label && name.endsWith(h.label))
    || hs.find((h) => !/役所|役場|庁舎/.test(h.label)) || null;
}
// 区(東京の特別区・政令市の区)は区役所。
const kindOf = (name) => (/区$/.test(name) ? 2 : /市$/.test(name) ? 1 : /町$/.test(name) ? 3 : 4);
const officeName = (name, kind) => name + ["", "役所", "役所", "役場", "役場"][kind];

const rows = [];
const dropped = [];
const cities = new Map(); // 政令市の名前 → 県コード
for (let i = 1; i <= 47; i++) {
  const gj = JSON.parse(fs.readFileSync(path.join(HERE, `../src/m6/city/${String(i).padStart(2, "0")}.json`), "utf8"));
  for (const f of gj.features) {
    const { c, n } = f.properties;
    const h = pick(c, n);
    if (!h) { dropped.push(c + n); continue; }
    const kind = kindOf(n);
    rows.push([c, officeName(n, kind), Number(h.lat.toFixed(5)), Number(h.lng.toFixed(5)), i, kind]);
    const city = /^(.+?市).+区$/.exec(n);
    if (city) cities.set(city[1], i);
  }
}
// 政令市の市役所: 同じ県で、名前が市名と同じ項目。
for (const [name, pref] of cities) {
  const p2 = String(pref).padStart(2, "0");
  const hit = [...byCode].find(([code, hs]) => code.startsWith(p2) && hs.some((h) => h.label === name));
  if (!hit) { dropped.push(name); continue; }
  const h = hit[1].find((x) => x.label === name);
  rows.push([hit[0], name + "役所", Number(h.lat.toFixed(5)), Number(h.lng.toFixed(5)), pref, 1]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
if (rows.length < 1800) throw new Error(`役所が少なすぎる(${rows.length})`);
fs.writeFileSync(OUT, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
const count = (k) => rows.filter((r) => r[5] === k).length;
console.log(`${rows.length}件(市役所 ${count(1)}・区役所 ${count(2)}・町役場 ${count(3)}・村役場 ${count(4)})、落とした ${dropped.length}: ${dropped.join(" ")}`, OUT);
