// visit-round.js — 何度も行く場所でも、1日に何か所か回れば1点(ab-153、2026-10-08)。visit-store.js が保存のときに使う。
// 1回押すごとではなく、その日(visits の date、日本時間の 24:00 で切れる)に座標のある訪問が ROUND_RULE.minVisits か所以上あり、
// 回った順(time の順)の距離の合計が ROUND_RULE.minKm 以上になったら、その条件を初めて満たした訪問に1点。1日1点まで。
// 初めての町(2点)より上にしないため1点(Takashi)。距離は増える一方なので、保存のたびに判定すれば日の終わりにまとめて
// 判定したのと同じになる(バッチ無し、ab-153 の note)。数字は仮置きで、決まったらここだけ直す。
// 初訪問の訪問もその日の1か所に数える(初訪問の点とは別に付く)。
// 2026-10-09 Takashi: 面積の条件も足す。回った場所を囲んだ広さ(凸包、3か所なら三角形)が minKm2 以上でも1点(距離とどちらか)。
// 一直線の遠出は距離で、街中をぐるっと回った日は面積で拾う(例: 梅田→京橋→天王寺は約9.5km・約10km²で面積側で付く)。
export const ROUND_RULE = { minVisits: 3, minKm: 10, minKm2: 5, points: 1 };

const hasXY = (v) => typeof v.lat === "number" && typeof v.lng === "number";

function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 回った順の距離の合計(km)。time が無いものは作った順(createdAt)で並べる。
export function routeKm(dayVisits) {
  const pts = dayVisits.filter(hasXY)
    .sort((a, b) => (a.time || "").localeCompare(b.time || "") || (a.createdAt || "").localeCompare(b.createdAt || ""));
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += distKm(pts[i - 1], pts[i]);
  return km;
}

// 回った場所を囲んだ広さ(km²、凸包)。日本の中なら、その日の点の平均緯度で平面にしてよい。
// 点を足しても凸包は小さくならないので、距離と同じく「初めて満たした回」の判定がそのまま使える。
export function hullKm2(dayVisits) {
  const pts = dayVisits.filter(hasXY);
  if (pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  const xy = pts.map((p) => [p.lng * kx, p.lat * ky]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...half(xy), ...half(xy.slice().reverse())];
  let a = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// visits(今までの訪問)に visit(これから保存する分)を足したとき、その日の1点が付くか。付くなら {count, km}、付かなければ null。
// 「足す前は満たしておらず、足したら満たした」ときだけ付ける。か所数も距離も足して減ることはない(途中に差し込んでも
// 三角不等式で合計は減らない)ので、これで1日1点になる。訪問に印を書かずに済む(Rules で visits の欄は決まっている)。
const meets = (day) => {
  const count = day.filter(hasXY).length;
  if (count < ROUND_RULE.minVisits) return null;
  const km = routeKm(day), km2 = hullKm2(day);
  return km >= ROUND_RULE.minKm || km2 >= ROUND_RULE.minKm2 ? { count, km, km2 } : null;
};

export function roundPointFor(visits, visit) {
  if (!visit.date) return null;
  const day = visits.filter((v) => v.date === visit.date);
  return meets(day) ? null : meets([...day, visit]);
}
