// build-m6-shops.mjs — m6 地図あそびの「お店」(ab-48、コメダ・イオンモール)の表を作る。
// 公式の店舗一覧は配布されていないので、OpenStreetMap(ODbL)から Overpass API で取る。
//   イオンモール: shop=mall で名前が「イオンモール」で始まるもの。ほぼそろっている(10/07 に 147件、実際は170前後)ので「制覇」に使う。
//   コメダ: 名前が「コメダ珈琲」で始まるか brand:wikidata がコメダ珈琲店のもの。4分の1ほど欠けていそう(744件、実際は1000前後)なので、
//           画面では「行った数」だけを出し、全店の何割とは言わない。
// 同じ店が点と建物の両方で入っていることがあるので、同じ名前で近いもの(コメダ 100m)は1つにする。
// イオンモールは「草津モール棟」「高知 本館」のように棟・館ごとにも入っているので、名前にかかわらず 1km 以内は1つにし、
// 名前は「棟」「館」「番街」を付けない呼び名(無ければ短い方)にする。
// 県は src/m5/prefectures.geojson の内外で決める(外ならいちばん近い県境の頂点の県)。
// 出力: src/m6/shops.json { src, aeon: [[名前, 緯度, 経度, 県コード, OSM の id]], komeda: [同じ形] }
// 作り直すときは `node scripts/build-m6-shops.mjs`(Overpass が混んでいると 429/504 で止まる。時間をおいてやり直す)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inGeometry, distKm, prefCode } from "../src/m6/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/m6/shops.json");
const PREFS = JSON.parse(fs.readFileSync(path.join(HERE, "../src/m5/prefectures.geojson"), "utf8")).features;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const CHAINS = {
  aeon: { filter: `nwr["shop"="mall"]["name"~"^イオンモール"](area.j);`, mergeKm: 1, anyName: true, min: 120 },
  komeda: { filter: `nwr["name"~"^コメダ珈琲"](area.j);nwr["brand:wikidata"="Q11302766"](area.j);`, mergeKm: 0.1, anyName: false, min: 600 },
};

function prefAt(lat, lng) {
  const hit = PREFS.find((f) => inGeometry([lng, lat], f.geometry));
  if (hit) return hit.properties.N03_001;
  let best = null, bd = Infinity;
  for (const f of PREFS) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    for (const [x, y] of poly[0]) { const d = distKm({ lat, lng }, { lat: y, lng: x }); if (d < bd) { bd = d; best = f.properties.N03_001; } }
  return best;
}

async function overpass(filter) {
  const data = `[out:json][timeout:180];area["ISO3166-1"="JP"][admin_level=2]->.j;(${filter});out center tags;`;
  let last = "";
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST", body: "data=" + encodeURIComponent(data), signal: AbortSignal.timeout(240000),
        headers: { "User-Agent": "a1-m6-map/0.1 (https://moriyatakashi.github.io/a1/)", "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (res.ok) return (await res.json()).elements;
      last = `${ep}: HTTP ${res.status}`;
    } catch (e) { last = `${ep}: ${e.message}`; }
  }
  throw new Error("Overpass に断られた: " + last);
}

const out = { src: "OpenStreetMap(ODbL)" };
// 棟・館の名前を落とした呼び名(「イオンモール高知　東館」→「イオンモール高知」)。
const mallName = (n) => n.replace(/[\s　]*((東|西|南|北|本|新|モール|スポーツ&レジャー|Sakura)(棟|館)|\d+番街)$/, "")
  .replace(/^イオンモール[\s　]+/, "イオンモール").trim() || n;
for (const [key, { filter, mergeKm, anyName, min }] of Object.entries(CHAINS)) {
  const shops = [];
  for (const e of await overpass(filter)) {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    const t = e.tags || {};
    const name = t.name || t.brand || "";
    // 駐車場・入口などは店ではない
    if (!Number.isFinite(lat) || !name || /駐車場|駐輪場|入口/.test(name) || t.amenity === "parking" || t.entrance) continue;
    // 名前が「コメダ珈琲店」「イオンモール」だけで、店名が支店名(branch)に入っていることが多いので付ける
    const full = t.branch && !name.includes(t.branch) ? `${name}${anyName ? "" : " "}${t.branch}` : name;
    const shown = anyName ? mallName(full) : full;
    const same = shops.find((s) => (anyName || s.base === name) && distKm(s, { lat, lng }) <= mergeKm);
    if (same) {
      // 棟・館ごとの項目をまとめるときは、チェーン名だけの名前より店名の付いた名前、その中で短い方
      if (anyName) same.name = [same.name, shown].sort((a, b) => (a === name) - (b === name) || a.length - b.length)[0];
      continue;
    }
    shops.push({ base: name, name: shown, lat, lng, id: `${e.type[0]}${e.id}` });
  }
  const rows = shops.map((s) => {
    const lat = Number(s.lat.toFixed(5)), lng = Number(s.lng.toFixed(5));
    return [s.name, lat, lng, Number(prefCode(prefAt(lat, lng))), s.id];
  }).sort((a, b) => a[3] - b[3] || b[1] - a[1]);
  if (rows.length < min) throw new Error(`${key} が少なすぎる(${rows.length})`);
  out[key] = rows;
  console.log(key, rows.length);
}
fs.writeFileSync(OUT, `{"src":${JSON.stringify(out.src)},\n"aeon":[\n${out.aeon.map((r) => JSON.stringify(r)).join(",\n")}\n],\n"komeda":[\n${out.komeda.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`);
console.log(OUT);
