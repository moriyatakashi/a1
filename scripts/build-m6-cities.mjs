// build-m6-cities.mjs — m6 地図あそびの「市区町村の霧」(ab-107)で使う、県ごとの市区町村の境界を作る。
// 元: スマートニュース メディア研究所 japan-topography の s0010(簡略化済み)。さらにその元は
// 国土交通省 国土数値情報(行政区域、2021-01-01)。出典は m6 のページに書いてある。
// 取り込み元はコミットを固定している(いつ作り直しても同じものになるように)。
// やること: 座標を小数4桁(約10m)に丸める・丸めて重なった点を落とす・つぶれた輪を落とす・
//   属性を c(団体コード5桁)と n(名前。政令市の区は「大阪市北区」のように市名を付ける)だけにする。
// 出力: src/m6/city/01.json 〜 47.json。作り直すときは `node scripts/build-m6-cities.mjs`。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_COMMIT = "b403e71eb97f1fdf32f63d16bd485129f703855e";
const BASE = `https://raw.githubusercontent.com/smartnews-smri/japan-topography/${SRC_COMMIT}/data/municipality/geojson/s0010`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/m6/city");

const r4 = (v) => Math.round(v * 1e4) / 1e4;
function ring(pts) {
  const out = [];
  for (const [x, y] of pts) {
    const p = [r4(x), r4(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null; // 閉じた輪は最低4点(始点=終点)
}
function polygon(rings) {
  const rs = rings.map(ring);
  if (!rs[0]) return null; // 外周がつぶれたら穴ごと捨てる
  return rs.filter(Boolean);
}
function geometry(g) {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates).map(polygon).filter(Boolean);
  if (!polys.length) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}
function cityName(p) {
  const ward = p.N03_003 && /市$/.test(p.N03_003) && /区$/.test(p.N03_004 || "");
  return ward ? p.N03_003 + p.N03_004 : p.N03_004;
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (let i = 1; i <= 47; i++) {
  const nn = String(i).padStart(2, "0");
  const res = await fetch(`${BASE}/N03-21_${nn}_210101.json`);
  if (!res.ok) throw new Error(`${nn}: HTTP ${res.status}`);
  const src = await res.json();
  const features = [];
  for (const f of src.features) {
    const p = f.properties;
    if (!p.N03_007 || !p.N03_004) continue; // 所属未定地は塗る先が無いので落とす
    const geom = geometry(f.geometry);
    if (geom) features.push({ type: "Feature", geometry: geom, properties: { c: p.N03_007, n: cityName(p) } });
  }
  const body = JSON.stringify({ type: "FeatureCollection", pref: src.features[0].properties.N03_001, features });
  fs.writeFileSync(path.join(OUT, `${nn}.json`), body);
  total += body.length;
  console.log(nn, src.features[0].properties.N03_001, features.length, (body.length / 1024).toFixed(0) + "KB");
}
console.log("合計", (total / 1024 / 1024).toFixed(2) + "MB");
