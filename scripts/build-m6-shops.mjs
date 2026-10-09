// build-m6-shops.mjs — m6 地図あそびの「お店」(ab-48、コメダ・イオンモール)の表を作る。
// 公式の店舗一覧は配布されていないので、OpenStreetMap(ODbL)から Overpass API で取る。
//   イオンモール: shop=mall で名前が「イオンモール」で始まるもの。ほぼそろっている(10/07 に 147件、実際は170前後)ので「制覇」に使う。
//   コメダ: 名前が「コメダ珈琲」で始まるか brand:wikidata がコメダ珈琲店のもの。4分の1ほど欠けていそう(744件、実際は1000前後)なので、
//           画面では「行った数」だけを出し、全店の何割とは言わない。
// 同じ店が点と建物の両方で入っていることがあるので、同じ名前で近いもの(コメダ 100m)は1つにする。
// イオンモールは「草津モール棟」「高知 本館」のように棟・館ごとにも入っているので、名前にかかわらず 1km 以内は1つにし、
// 名前は「棟」「館」「番街」を付けない呼び名(無ければ短い方)にする。
// 県は src/m5/prefectures.geojson の内外で決める(外ならいちばん近い県境の頂点の県)。
// 2026-10-09(ab-48 の続き、礼文): 銭湯・温泉(bath)と、東横イン(toyoko)・アパホテル(apa)を足した。どれもコメダと同じ「行った数」。
//   銭湯・温泉: amenity=public_bath。足湯・手湯・家族風呂・貸切と、名前の無いものは落とす。スーパー銭湯と町の銭湯は OSM では
//              分けられない(bath:type が付いているのは2割ほど)ので、まとめて数える。
//   東横イン・アパホテル: tourism=hotel で名前かブランドが合うもの。どちらも欠けがある(東横は実際340前後、アパは提携を入れると700前後)。
// 出力: src/m6/shops.json { src, aeon: [[名前, 緯度, 経度, 県コード, OSM の id]], komeda: [同じ形], bath, toyoko, apa }
// 作り直すときは `node scripts/build-m6-shops.mjs`(Overpass が混んでいると 429/504 で止まる。時間をおいてやり直す)。
// `node scripts/build-m6-shops.mjs bath apa` のように名前を渡すと、その表だけ作り直し、ほかは今のファイルのまま残す。
// Overpass がどこも断るとき(2026-10-09 夜はそうだった)は、前に取れた返事を `--raw <返事のjson>` で渡せる(表は1つだけ指定する)。
// 返事に別のチェーンが混ざっていても keep で落とす(東横とアパを1回で取った返事を両方に使える)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inGeometry, distKm, prefCode } from "../src/m6/geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/m6/shops.json");
const PREFS = JSON.parse(fs.readFileSync(path.join(HERE, "../src/m5/prefectures.geojson"), "utf8")).features;
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
const CHAINS = {
  aeon: { filter: `nwr["shop"="mall"]["name"~"^イオンモール"](area.j);`, mergeKm: 1, anyName: true, min: 120 },
  komeda: { filter: `nwr["name"~"^コメダ珈琲"](area.j);nwr["brand:wikidata"="Q11302766"](area.j);`, mergeKm: 0.1, anyName: false, min: 600 },
  bath: { filter: `nwr["amenity"="public_bath"]`, tiles: true, mergeKm: 0.1, anyName: false, min: 3000,
    skip: (t) => !t.name || /foot_bath|hand_bath/.test(t["bath:type"] || "") || /足湯|手湯|家族(風呂|温泉|湯)|貸切/.test(t.name) },
  toyoko: { filter: `nwr["tourism"="hotel"]["name"~"^東[横橫]"](area.j);nwr["tourism"="hotel"]["brand"~"^(東横|Toyoko)"](area.j);`, mergeKm: 0.1, anyName: false, min: 200,
    keep: (t) => t.tourism === "hotel" && (/^東[横橫]/.test(t.name || "") || /^(東横|Toyoko)/i.test(t.brand || "")) },
  apa: { filter: `nwr["tourism"="hotel"]["name"~"^(アパホテル|アパリゾート|アパヴィラ|APA|Apa )"](area.j);nwr["tourism"="hotel"]["brand"~"^アパ"](area.j);`, mergeKm: 0.1, anyName: false, min: 150,
    // ブランドだけアパの提携旅館(「湊屋旅館」など)は落とし、名前がアパのものだけ
    keep: (t) => t.tourism === "hotel" && /^(アパホテル|アパリゾート|アパヴィラ|APA|Apa )/.test(t.name || "") },
};
const args = process.argv.slice(2);
const rawAt = args.indexOf("--raw");
const raw = rawAt >= 0 ? args.splice(rawAt, 2)[1] : null;
const only = args;
if (raw && only.length !== 1) throw new Error("--raw のときは表を1つだけ指定する");
for (const k of only) if (!CHAINS[k]) throw new Error(`知らない表: ${k}(${Object.keys(CHAINS).join(" ")})`);

function prefAt(lat, lng) {
  const hit = PREFS.find((f) => inGeometry([lng, lat], f.geometry));
  if (hit) return hit.properties.N03_001;
  let best = null, bd = Infinity;
  for (const f of PREFS) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    for (const [x, y] of poly[0]) { const d = distKm({ lat, lng }, { lat: y, lng: x }); if (d < bd) { bd = d; best = f.properties.N03_001; } }
  return best;
}

// 銭湯のように数千件あるものは、日本全体の area で一度に聞くと Overpass が時間切れになる(2026-10-09)。
// 地域ごとの四角(南・西・北・東)に分けて聞き、日本の外(韓国の南岸など)は県の形から10km以上離れていたら落とす。
const TILES = [
  [41.3, 139.3, 45.6, 146.0], // 北海道
  [36.8, 139.0, 41.6, 142.2], // 東北・新潟の北
  [34.8, 138.4, 37.2, 141.0], // 関東
  [34.5, 135.8, 38.6, 139.0], // 中部・佐渡
  [33.4, 134.2, 36.0, 136.9], // 近畿
  [32.6, 130.8, 36.4, 134.5], // 中国・四国・隠岐
  [30.9, 128.5, 34.8, 132.2], // 九州・対馬
  [24.0, 122.9, 30.9, 131.4], // 沖縄・南西諸島
  [24.0, 138.5, 34.8, 142.5], // 伊豆・小笠原
];
function inJapan(lat, lng) {
  if (PREFS.some((f) => inGeometry([lng, lat], f.geometry))) return true;
  for (const f of PREFS) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    for (const [x, y] of poly[0]) if (distKm({ lat, lng }, { lat: y, lng: x }) < 10) return true;
  return false;
}
async function overpassTiles(filter) {
  const seen = new Set(), out = [];
  for (const [s, w, n, e] of TILES) {
    for (const el of await overpass(`${filter}(${s},${w},${n},${e});`, false)) {
      const id = `${el.type}${el.id}`;
      const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
      if (seen.has(id) || !Number.isFinite(lat) || !inJapan(lat, lng)) continue;
      seen.add(id);
      out.push(el);
    }
  }
  return out;
}

async function overpass(filter, japanArea = true) {
  const area = japanArea ? `area["ISO3166-1"="JP"][admin_level=2]->.j;` : "";
  const data = `[out:json][timeout:180];${area}(${filter});out center tags;`;
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

const out = only.length ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { src: "OpenStreetMap(ODbL)" };
// 棟・館の名前を落とした呼び名(「イオンモール高知　東館」→「イオンモール高知」)。
const mallName = (n) => n.replace(/[\s　]*((東|西|南|北|本|新|モール|スポーツ&レジャー|Sakura)(棟|館)|\d+番街)$/, "")
  .replace(/^イオンモール[\s　]+/, "イオンモール").trim() || n;
for (const [key, { filter, tiles, mergeKm, anyName, min, skip, keep }] of Object.entries(CHAINS)) {
  if (only.length && !only.includes(key)) continue;
  const shops = [];
  const elements = raw ? JSON.parse(fs.readFileSync(raw, "utf8")).elements : await (tiles ? overpassTiles(filter) : overpass(filter));
  for (const e of elements) {
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    const t = e.tags || {};
    const name = t.name || t.brand || "";
    // 駐車場・入口などは店ではない
    if (!Number.isFinite(lat) || !name || /駐車場|駐輪場|入口/.test(name) || t.amenity === "parking" || t.entrance) continue;
    if ((skip && skip(t)) || (keep && !keep(t))) continue;
    if (tiles && raw && !inJapan(lat, lng)) continue;
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
const table = (k) => `"${k}":[\n${out[k].map((r) => JSON.stringify(r)).join(",\n")}\n]`;
fs.writeFileSync(OUT, `{"src":${JSON.stringify(out.src)},\n${Object.keys(CHAINS).filter((k) => out[k]).map(table).join(",\n")}}\n`);
console.log(OUT);
