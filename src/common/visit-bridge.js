// visit-bridge.js — 本州と四国・九州・北海道をつなぐ橋・トンネルを渡ったか(ab-175、2026-10-18 礼文)。
// m6 の橋の層(src/m6/geo.js から使う)と、m2 で訪問を保存したときの1日1点(visit-store.js、Takashi 10/18 の答え A)で共用。

function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 本州と四国・九州・北海道をつなぐ橋。トンネルも橋とみなす(Takashi)。同じ海峡の橋とトンネルは訪問の点からは見分けられないので、
// 「つなぎ」(ルート)ごとに渡ったかを見る。a は本州側の端、b は向こう側の端([緯度, 経度]、地図の線と、どのつなぎを通ったかの判定に使う)。
export const BRIDGES = [
  { key: "akashi", name: "神戸淡路鳴門", parts: "明石海峡大橋・大鳴門橋", to: "四国", a: [34.633, 135.020], b: [34.215, 134.635] },
  { key: "seto", name: "児島坂出", parts: "瀬戸大橋", to: "四国", a: [34.470, 133.810], b: [34.335, 133.835] },
  { key: "shimanami", name: "尾道今治", parts: "しまなみ海道(来島海峡大橋ほか)", to: "四国", a: [34.400, 133.190], b: [34.070, 132.990] },
  { key: "kanmon", name: "関門海峡", parts: "関門橋・関門トンネル・関門鉄道トンネル・新関門トンネル", to: "九州", a: [33.965, 130.945], b: [33.940, 130.965] },
  { key: "seikan", name: "青函トンネル", parts: "青函トンネル", to: "北海道", a: [41.180, 140.480], b: [41.600, 140.420] },
];
const ISLANDS = { 四国: ["徳島県", "香川県", "愛媛県", "高知県"], 九州: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"], 北海道: ["北海道"] };
// 県 → 島(本州・四国・九州・北海道)。沖縄と県が空のものは "" (つなぎが無い)。
export const islandOf = (pref) => (!pref || pref === "沖縄県" ? "" : Object.keys(ISLANDS).find((k) => ISLANDS[k].includes(pref)) || "本州");
// 続けて付けた2つの訪問の島がちがえば、そのあいだで渡ったとみる。どのつなぎかは回り道がいちばん短いもの。
// 飛行機・フェリーを拾わないため、2つの訪問がどちらもつなぎの真ん中から BRIDGE_REACH_KM 以内で、
// つなぎを通る道のりがまっすぐの BRIDGE_DETOUR 倍以内のときだけ数える(例: 東京→札幌・広島→松山は数えない)。
export const BRIDGE_REACH_KM = 300;
export const BRIDGE_DETOUR = 1.4;
const midOf = (b) => ({ lat: (b.a[0] + b.b[0]) / 2, lng: (b.a[1] + b.b[1]) / 2 });
// 返り値: 渡った回の一覧 [{ key, date, from, to }](古い順)。点は1日1回まで(ab-153 と同じ)なので、点の日は bridgeDays で出す。
export function bridgeCrossings(visits, bridges = BRIDGES) {
  const vs = visits.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng) && islandOf(v.pref))
    .sort((x, y) => `${x.date || ""} ${x.time || ""} ${x.createdAt || ""}`.localeCompare(`${y.date || ""} ${y.time || ""} ${y.createdAt || ""}`));
  const out = [];
  for (let i = 1; i < vs.length; i++) {
    const p = vs[i - 1], q = vs[i], ip = islandOf(p.pref), iq = islandOf(q.pref);
    if (ip === iq || (ip !== "本州" && iq !== "本州")) continue;
    const other = ip === "本州" ? iq : ip;
    const direct = distKm(p, q);
    let best = null;
    for (const b of bridges.filter((x) => x.to === other)) {
      const m = midOf(b), dp = distKm(p, m), dq = distKm(m, q);
      if (dp > BRIDGE_REACH_KM || dq > BRIDGE_REACH_KM || dp + dq > direct * BRIDGE_DETOUR) continue;
      if (!best || dp + dq < best.d) best = { key: b.key, d: dp + dq };
    }
    if (best) out.push({ key: best.key, date: q.date || p.date || "", from: p.place || p.pref, to: q.place || q.pref });
  }
  return out;
}
// 点の付く日(1日1回まで)。渡った回の一覧から、日付の重なりを落とす。
export const bridgeDays = (crossings) => [...new Set(crossings.map((c) => c.date).filter(Boolean))].sort();
export const BRIDGE_POINTS = 1;

// visits(今までの訪問)に visit(これから保存する分)を足したとき、その日の橋の1点が付くか。付くなら渡った回 {key, date, from, to}、
// 付かなければ null。visit-round.js の roundPointFor と同じく「足す前はその日に渡っておらず、足したら渡った」ときだけ付ける。
export function bridgePointFor(visits, visit) {
  if (!visit.date) return null;
  const before = bridgeCrossings(visits).some((c) => c.date === visit.date);
  if (before) return null;
  return bridgeCrossings([...visits, visit]).find((c) => c.date === visit.date) || null;
}
