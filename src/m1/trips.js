// trips.js — 日々記録の1日3回の記録(b1 ah-51)。画面に触らない計算だけ置く(trips.test.mjs で確かめる)。
// scores/{日付}.trips = { home: {at, ...}, station: {...}, office: {at, kind: "出社"|"帰社前", ...} }(欄を足すだけ)

// 記録のつけどき。3つ目は押すときに「出社 / 帰社前」を選ぶ(ah-51 仮決め Q1)
export const SLOTS = [
  { id: "home", label: "家出る前" },
  { id: "station", label: "行きの駅" },
  { id: "office", label: "出社 / 帰社前", kinds: ["出社", "帰社前"] },
];

// 位置は小数3けた(緯度で約110m、経度で約90m)に丸めて残す。家の位置がそのまま残らないように(仮決め Q4)
export const roundPos = (lat, lng) => ({ lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 });

// 2点の距離(km)。近くの場所の並べ替えと面積の両方で使う
export function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// その日の3点でできる三角形の面積(km²、小数2けた、仮決め Q6)。3点の位置がそろっていなければ null。
// 3点の中心まわりで平面に開いて(数十km までなら差は小さい)、靴ひもの式で出す
export function triangleKm2(trips) {
  const pts = ["home", "station", "office"].map((k) => trips && trips[k]);
  if (!pts.every((p) => p && typeof p.lat === "number" && typeof p.lng === "number")) return null;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / 3;
  const kx = 111.32 * Math.cos(lat0 * Math.PI / 180), ky = 110.57;
  const [a, b, c] = pts.map((p) => ({ x: p.lng * kx, y: p.lat * ky }));
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return Math.round(area * 100) / 100;
}

// 近くの観光地とコメダ珈琲(仮決め Q5: 鍵の要らない OpenStreetMap の Overpass を、押したときだけ呼ぶ)
const OVERPASS = "https://overpass-api.de/api/interpreter";
export function overpassQuery({ lat, lng }) {
  return `[out:json][timeout:15];(` +
    `nwr(around:3000,${lat},${lng})["tourism"~"^(attraction|viewpoint|museum)$"]["name"];` +
    `nwr(around:10000,${lat},${lng})["name"~"コメダ"];` +
    `);out center 60;`;
}
// Overpass の答えから、名前・種類・距離を近い順に。種類ごとに n 件まで
export function pickNearby(json, pos, n = 3) {
  const all = (json.elements || []).map((e) => {
    const p = e.center || e;
    const name = e.tags && e.tags.name;
    return name && typeof p.lat === "number" ? { name, kind: /コメダ/.test(name) ? "コメダ" : "観光", km: distKm(pos, { lat: p.lat, lng: p.lon }) } : null;
  }).filter(Boolean).sort((a, b) => a.km - b.km);
  const seen = new Set();
  const uniq = all.filter((x) => !seen.has(x.name) && seen.add(x.name));
  return ["観光", "コメダ"].flatMap((k) => uniq.filter((x) => x.kind === k).slice(0, n));
}
export async function fetchNearby(pos) {
  const r = await fetch(OVERPASS, { method: "POST", body: "data=" + encodeURIComponent(overpassQuery(pos)) });
  if (!r.ok) throw new Error(`Overpass ${r.status}`);
  return pickNearby(await r.json(), pos);
}

// 押したときの位置。取れなければ null(位置なしで記録だけ残す)
export function currentPos(geo = globalThis.navigator && navigator.geolocation) {
  if (!geo) return Promise.resolve(null);
  return new Promise((resolve) => {
    geo.getCurrentPosition((p) => resolve(roundPos(p.coords.latitude, p.coords.longitude)), () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  });
}
