// build-m6-cities.mjs — m6 地図あそびの「市区町村の霧」(ab-107)で使う、県ごとの市区町村の境界を作る。
// 元: スマートニュース メディア研究所 japan-topography の s0010(簡略化済み)。さらにその元は
// 国土交通省 国土数値情報(行政区域、2021-01-01)。出典は m6 のページに書いてある。
// 取り込み元はコミットを固定している(いつ作り直しても同じものになるように)。
// やること: 座標を小数4桁(約10m)に丸める・丸めて重なった点を落とす・つぶれた輪を落とす・
//   属性を c(団体コード5桁)と n(名前。政令市の区は「大阪市北区」のように市名を付ける)だけにする。
// 出力: src/m6/city/01.json 〜 47.json。作り直すときは `node scripts/build-m6-cities.mjs`。
// 2026-10-09(ab-117): 2021 年より後に区が変わった県は、国土数値情報の新しい版から同じ 1% 簡略化で作る(NEWER)。
// 浜松市は 2024-01-01 に7区から中央区・浜名区・天竜区の3区になった。s0010 は 2021 年版しか無い。
// こちらは zip を落として unzip・mapshaper(npx で、その時だけ取る)で市区町村ごとに1つにまとめて(元は島ごとにばらばら)簡略化するので、unzip と npx が要る。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SRC_COMMIT = "b403e71eb97f1fdf32f63d16bd485129f703855e";
const BASE = `https://raw.githubusercontent.com/smartnews-smri/japan-topography/${SRC_COMMIT}/data/municipality/geojson/s0010`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/m6/city");

const NEWER = {
  "22": { zip: "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_22_GML.zip", file: "N03-20250101_22.geojson" },
};
const MAPSHAPER = "mapshaper@0.6.121";

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

// 新しい版(2024 年以降)は列が1つずれている: N03_003=郡、N03_004=市町村、N03_005=政令市の区。2021 年版の形に読み替える。
const fromNewer = (p) => ({ N03_001: p.N03_001, N03_003: p.N03_004, N03_004: p.N03_005 || p.N03_004, N03_007: p.N03_007 });
async function newer({ zip, file }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m6-cities-"));
  try {
    const res = await fetch(zip);
    if (!res.ok) throw new Error(`${zip}: HTTP ${res.status}`);
    fs.writeFileSync(path.join(dir, "n03.zip"), Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-qo", "n03.zip", file], { cwd: dir });
    execFileSync("npx", ["-y", MAPSHAPER, file, "-dissolve", "N03_007", "copy-fields=N03_001,N03_003,N03_004,N03_005", "-simplify", "1%", "keep-shapes", "-o", "s.json", "force"], { cwd: dir, stdio: "ignore" });
    const src = JSON.parse(fs.readFileSync(path.join(dir, "s.json"), "utf8"));
    for (const f of src.features) f.properties = fromNewer(f.properties);
    return src;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (let i = 1; i <= 47; i++) {
  const nn = String(i).padStart(2, "0");
  let src;
  if (NEWER[nn]) src = await newer(NEWER[nn]);
  else {
    const res = await fetch(`${BASE}/N03-21_${nn}_210101.json`);
    if (!res.ok) throw new Error(`${nn}: HTTP ${res.status}`);
    src = await res.json();
  }
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
