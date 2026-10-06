// build-m6-stations.mjs — m6 地図あそびの「駅」(ab-48)の表を作る。
// 元: 国土交通省 国土数値情報「鉄道データ」(N02、令和6年=2024年度版、CC BY 4.0)の駅(N02-24_Station.geojson)。
// Wikidata は新宿・梅田・銀座などの大きな駅が「駅」として入っていないので、駅は国の表から作る(10/07 に確かめた)。
// 元の駅は「路線ごとのホーム(線)」なので、まとめて1駅にする:
//   1) 駅コードのグループ(N02_005g)でまとめる。
//   2) 同じ名前で、中心が 1km 以内のグループはさらにまとめる(新宿の JR・京王・小田急・地下鉄など)。
// 座標は、まとめたホームの点の平均。県は src/m5/prefectures.geojson の内外で決める(外ならいちばん近い県境の頂点の県)。
// 出力: src/m6/stations.json
//   { src, ops: [事業者名], lines: [[事業者の番号, 路線名]],
//     rows: [[名前, 緯度, 経度, 県コード(1〜47), 種類のビット, [路線の番号…]]] }
//   種類のビット: 1=新幹線 2=JR在来線 4=公営(地下鉄など) 8=民営 16=第三セクター(N02_002 の 1〜5)。
// 作り直すときは `node scripts/build-m6-stations.mjs`。8000駅に届かなければ書かずに止まる。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { inGeometry, distKm, prefCode } from "../src/m6/geo.js";

const SRC = "https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-24/N02-24_GML.zip";
const ENTRY = "UTF-8/N02-24_Station.geojson";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "../src/m6/stations.json");
const PREFS = JSON.parse(fs.readFileSync(path.join(HERE, "../src/m5/prefectures.geojson"), "utf8")).features;

// zip から1ファイルだけ取り出す(中央ディレクトリを読んで、そのファイルを inflate する)。
function unzipOne(buf, name) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("zip の終わりが見つからない");
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0, n = buf.readUInt16LE(eocd + 10); i < n; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`zip に ${name} が無い`);
}

function prefAt(lat, lng) {
  const hit = PREFS.find((f) => inGeometry([lng, lat], f.geometry));
  if (hit) return hit.properties.N03_001;
  let best = null, bd = Infinity;
  for (const f of PREFS) for (const poly of f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates)
    for (const [x, y] of poly[0]) { const d = distKm({ lat, lng }, { lat: y, lng: x }); if (d < bd) { bd = d; best = f.properties.N03_001; } }
  return best;
}

const res = await fetch(SRC);
if (!res.ok) throw new Error(`国土数値情報: HTTP ${res.status}`);
const src = JSON.parse(unzipOne(Buffer.from(await res.arrayBuffer()), ENTRY).toString("utf8"));

// 1) 駅コードのグループごとに、名前・点・種類・路線を集める。
const groups = new Map();
for (const f of src.features) {
  const p = f.properties;
  const g = groups.get(p.N02_005g) || { names: new Map(), pts: [], kind: 0, lines: new Set() };
  g.names.set(p.N02_005, (g.names.get(p.N02_005) || 0) + 1);
  g.pts.push(...f.geometry.coordinates);
  g.kind |= 1 << (Number(p.N02_002) - 1);
  g.lines.add(p.N02_004 + "\t" + p.N02_003);
  groups.set(p.N02_005g, g);
}
const center = (pts) => ({ lng: pts.reduce((s, q) => s + q[0], 0) / pts.length, lat: pts.reduce((s, q) => s + q[1], 0) / pts.length });
let stations = [...groups.values()].map((g) => ({
  name: [...g.names].sort((a, b) => b[1] - a[1])[0][0], pts: g.pts, kind: g.kind, lines: g.lines, ...center(g.pts),
}));

// 2) 同じ名前で 1km 以内のものをまとめる(まとめたら中心を出し直して、もう一度)。
for (let changed = true; changed;) {
  changed = false;
  const byName = new Map();
  for (const s of stations) byName.set(s.name, [...(byName.get(s.name) || []), s]);
  const next = [];
  for (const same of byName.values()) {
    while (same.length) {
      const a = same.shift();
      for (let i = same.length - 1; i >= 0; i--) {
        if (distKm(a, same[i]) > 1) continue;
        const b = same.splice(i, 1)[0];
        a.pts.push(...b.pts); a.kind |= b.kind; b.lines.forEach((l) => a.lines.add(l));
        Object.assign(a, center(a.pts));
        changed = true;
      }
      next.push(a);
    }
  }
  stations = next;
}

const ops = [], lines = [];
const opIdx = (o) => (ops.includes(o) ? ops.indexOf(o) : ops.push(o) - 1);
const lineKey = new Map();
const lineIdx = (l) => {
  if (!lineKey.has(l)) { const [o, n] = l.split("\t"); lineKey.set(l, lines.push([opIdx(o), n]) - 1); }
  return lineKey.get(l);
};
const rows = stations.map((s) => {
  const lat = Number(s.lat.toFixed(5)), lng = Number(s.lng.toFixed(5));
  return [s.name, lat, lng, Number(prefCode(prefAt(lat, lng))), s.kind, [...s.lines].sort().map(lineIdx)];
}).sort((a, b) => a[3] - b[3] || b[1] - a[1] || a[2] - b[2]);

if (rows.length < 8000) throw new Error(`駅が少なすぎる(${rows.length})`);
if (rows.some((r) => !(r[3] >= 1 && r[3] <= 47))) throw new Error("県が決まらない駅がある");
const body = `{"src":"国土数値情報 鉄道データ(N02-24)","ops":${JSON.stringify(ops)},\n"lines":${JSON.stringify(lines)},\n"rows":[\n`
  + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]}\n";
fs.writeFileSync(OUT, body);
const count = (bit) => rows.filter((r) => r[4] & bit).length;
console.log(`${rows.length}駅(元のグループ ${groups.size})、新幹線 ${count(1)}・JR ${count(2)}・公営 ${count(4)}・民営 ${count(8)}・三セク ${count(16)}、`
  + `事業者 ${ops.length}・路線 ${lines.length}、${(body.length / 1024).toFixed(0)}KB`, OUT);
