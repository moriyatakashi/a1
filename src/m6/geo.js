// geo.js — m6 地図あそびの、DOM を使わない部分(ab-44)。
//   となり(隣接)は prefectures.geojson の県境の頂点の共有から出す(北海道・沖縄はとなり無し)。
//   面積は地図データだと離島が落ちていて大きくずれる(長崎は半分くらいになる)ので、公表値の概数を表で持つ。
//   県庁所在地・地方の分け方も表で持つ。クイズの出題もここで作る(乱数は rng を渡せる)。

export const REGIONS = [
  ["北海道", ["北海道"]],
  ["東北", ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"]],
  ["関東", ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"]],
  ["中部", ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"]],
  ["近畿", ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"]],
  ["中国", ["鳥取県", "島根県", "岡山県", "広島県", "山口県"]],
  ["四国", ["徳島県", "香川県", "愛媛県", "高知県"]],
  ["九州・沖縄", ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]],
];
export const regionOf = (n) => (REGIONS.find(([, ps]) => ps.includes(n)) || ["?"])[0];

export const CAPITALS = {
  北海道: "札幌市", 青森県: "青森市", 岩手県: "盛岡市", 宮城県: "仙台市", 秋田県: "秋田市", 山形県: "山形市", 福島県: "福島市",
  茨城県: "水戸市", 栃木県: "宇都宮市", 群馬県: "前橋市", 埼玉県: "さいたま市", 千葉県: "千葉市", 東京都: "東京(新宿区)", 神奈川県: "横浜市",
  新潟県: "新潟市", 富山県: "富山市", 石川県: "金沢市", 福井県: "福井市", 山梨県: "甲府市", 長野県: "長野市", 岐阜県: "岐阜市",
  静岡県: "静岡市", 愛知県: "名古屋市", 三重県: "津市", 滋賀県: "大津市", 京都府: "京都市", 大阪府: "大阪市", 兵庫県: "神戸市",
  奈良県: "奈良市", 和歌山県: "和歌山市", 鳥取県: "鳥取市", 島根県: "松江市", 岡山県: "岡山市", 広島県: "広島市", 山口県: "山口市",
  徳島県: "徳島市", 香川県: "高松市", 愛媛県: "松山市", 高知県: "高知市", 福岡県: "福岡市", 佐賀県: "佐賀市", 長崎県: "長崎市",
  熊本県: "熊本市", 大分県: "大分市", 宮崎県: "宮崎市", 鹿児島県: "鹿児島市", 沖縄県: "那覇市",
};

// 面積(km²、国土地理院の公表値の概数。クイズは1.15倍以上ちがう組だけ出すので、細かい年次差は効かない)。
export const AREAS = {
  北海道: 83424, 青森県: 9646, 岩手県: 15275, 宮城県: 7282, 秋田県: 11638, 山形県: 9323, 福島県: 13784,
  茨城県: 6098, 栃木県: 6408, 群馬県: 6362, 埼玉県: 3798, 千葉県: 5157, 東京都: 2194, 神奈川県: 2416,
  新潟県: 12584, 富山県: 4248, 石川県: 4186, 福井県: 4191, 山梨県: 4465, 長野県: 13562, 岐阜県: 10621,
  静岡県: 7777, 愛知県: 5173, 三重県: 5774, 滋賀県: 4017, 京都府: 4612, 大阪府: 1905, 兵庫県: 8401,
  奈良県: 3691, 和歌山県: 4725, 鳥取県: 3507, 島根県: 6708, 岡山県: 7114, 広島県: 8479, 山口県: 6113,
  徳島県: 4147, 香川県: 1877, 愛媛県: 5676, 高知県: 7104, 福岡県: 4988, 佐賀県: 2441, 長崎県: 4131,
  熊本県: 7409, 大分県: 6341, 宮崎県: 7735, 鹿児島県: 9186, 沖縄県: 2282,
};
export const areaText = (n) => `約${(Math.round(AREAS[n] / 100) * 100).toLocaleString("ja-JP")}km²`;

const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

// となり: 2つ以上の頂点を共有する県どうし(1点だけの接し方は、データの丸めの偶然とみなして外す)。
export function adjacency(features) {
  const owner = new Map();
  for (const f of features) {
    const n = f.properties.N03_001;
    for (const poly of polysOf(f.geometry)) for (const ring of poly) for (const [x, y] of ring) {
      const k = x.toFixed(4) + "," + y.toFixed(4);
      if (!owner.has(k)) owner.set(k, new Set());
      owner.get(k).add(n);
    }
  }
  const shared = new Map();
  for (const s of owner.values()) {
    if (s.size < 2) continue;
    for (const a of s) for (const b of s) if (a !== b) {
      const k = a + "|" + b;
      shared.set(k, (shared.get(k) || 0) + 1);
    }
  }
  const adj = new Map();
  for (const f of features) adj.set(f.properties.N03_001, new Set());
  for (const [k, c] of shared) if (c >= 2) { const [a, b] = k.split("|"); adj.get(a).add(b); }
  return adj;
}

// 県のだいたいの中心(いちばん大きい島の外周の頂点の平均)。距離の目安にだけ使う。
export function centers(features) {
  const best = new Map();
  for (const f of features) {
    const n = f.properties.N03_001;
    for (const poly of polysOf(f.geometry)) {
      const ring = poly[0];
      if (!best.has(n) || ring.length > best.get(n).length) best.set(n, ring);
    }
  }
  const out = new Map();
  for (const [n, ring] of best) {
    const s = ring.reduce((a, [x, y]) => [a[0] + x, a[1] + y], [0, 0]);
    out.set(n, { lng: s[0] / ring.length, lat: s[1] / ring.length });
  }
  return out;
}
export function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 次に晴らせる県: 行った県のとなりで、まだ行っていない県。
export function frontier(visited, adj) {
  const out = new Set();
  for (const n of visited) for (const m of adj.get(n) || []) if (!visited.has(m)) out.add(m);
  return out;
}

// 地方ごとの制覇数。
export const regionProgress = (visited) =>
  REGIONS.map(([name, ps]) => ({ name, done: ps.filter((p) => visited.has(p)).length, total: ps.length }));

// ---- 市区町村(ab-107) ----
// 県コード2桁。REGIONS を並べた順がそのまま JIS の県コード順(北海道=01 … 沖縄=47)。
const PREF_ORDER = REGIONS.flatMap(([, ps]) => ps);
export const prefCode = (n) => { const i = PREF_ORDER.indexOf(n); return i < 0 ? null : String(i + 1).padStart(2, "0"); };

// 点 [lng, lat] が輪の中か(偶奇則)。
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// 外周の中で、どの穴(琵琶湖など)の中でもなければ中。
export function inGeometry([x, y], geom) {
  return polysOf(geom).some(([outer, ...holes]) => inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)));
}

// 市区町村ごとの集計。cityFeatures は src/m6/city/NN.json の features を集めたもの(properties: c=団体コード, n=名前)。
// 緯度経度がある訪問は点の内外で決める(霧の穴と訪問点が食い違わないように)。境界は簡略化してあるので、
// 市境ぎりぎりの点はとなりの市に入ることがある(数百m)。点が無い・どこにも入らない訪問は、
// visits の city(+town の頭の区名)と名前が合えばそこに数える。
// 返り値: Map(コード → { code, name, pref, count, first })
export function cityVisits(visits, cityFeatures, prefOf = () => "") {
  const boxed = cityFeatures.map((f) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const poly of polysOf(f.geometry)) for (const [x, y] of poly[0]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { f, box: [x0, y0, x1, y1] };
  });
  const byName = (v) => {
    if (!v.city) return null;
    const hit = cityFeatures.find((f) => f.properties.n === v.city
      || (f.properties.n.startsWith(v.city) && (v.town || "").startsWith(f.properties.n.slice(v.city.length))));
    return hit || null;
  };
  const out = new Map();
  for (const v of visits) {
    let f = null;
    if (Number.isFinite(v.lat) && Number.isFinite(v.lng)) {
      const hit = boxed.find(({ f, box: [x0, y0, x1, y1] }) =>
        v.lng >= x0 && v.lng <= x1 && v.lat >= y0 && v.lat <= y1 && inGeometry([v.lng, v.lat], f.geometry));
      f = hit ? hit.f : null;
    }
    if (!f) f = byName(v); // 簡略化した境界のすき間(県境など)に落ちた点も、名前で拾う
    if (!f) continue;
    const { c, n } = f.properties;
    const a = out.get(c) || { code: c, name: n, pref: prefOf(c), count: 0, first: "" };
    a.count++;
    if (v.date && (!a.first || v.date < a.first)) a.first = v.date;
    out.set(c, a);
  }
  return out;
}

// ---- 日本100名城(ab-108) ----
// castles.json の行 [番号, 名前, 緯度, 経度, 県, Q番号] ごとに、訪問がいちばん近づいた距離(near, km)と、
// km 以内に入った回数・最初の日を出す。km 以内に入ったら「行った」(スタンプ)。新しく書くものは無い。
export const CASTLE_KM = 1;
export function castleVisits(visits, castles, km = CASTLE_KM) {
  const pts = visits.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lng));
  return castles.map(([num, name, lat, lng, pref, qid]) => {
    const c = { num, name, lat, lng, pref, qid, near: Infinity, nearPlace: "", count: 0, first: "" };
    for (const v of pts) {
      const d = distKm(v, c);
      if (d < c.near) { c.near = d; c.nearPlace = v.place || ""; }
      if (d <= km) {
        c.count++;
        if (v.date && (!c.first || v.date < c.first)) c.first = v.date;
      }
    }
    c.done = c.count > 0;
    return c;
  });
}

// ---- 願望マップ(ab-84 の1、2026-10-04) ----
// 行きたい場所(wishes の {id, label, lat, lng, pref, createdAt})ごとに、名城と同じく訪問がいちばん近づいた距離と、
// km 以内に入った回数・最初の日を出す。km 以内に入ったら「かなった」。かなったかどうかは書かず、毎回訪問から決める。
export const WISH_KM = 1;
export function wishVisits(visits, wishes, km = WISH_KM) {
  const rows = castleVisits(visits, wishes.map((w) => [w.id, w.label, w.lat, w.lng, w.pref, null]), km);
  return rows.map((r, i) => ({ ...wishes[i], near: r.near, nearPlace: r.nearPlace, count: r.count, first: r.first, done: r.done }));
}

// ---- 駅(ab-48、2026-10-07) ----
// stations.json(scripts/build-m6-stations.mjs)の rows [名前, 緯度, 経度, 県コード, 種類のビット, [路線の番号…]] に、訪問を割り当てる。
// 駅は町なかでは数百mおきにあるので、名城と違い「訪問ごとに、いちばん近い駅が STATION_KM 以内なら、その1駅だけ」行ったにする。
// 返り値: 行った駅の Map(rows の番号 → { i, count, first })。行っていない駅は入らない(9000駅を毎回並べないように)。
export const STATION_KM = 0.5;
export const STATION_KINDS = [[1, "新幹線"], [2, "JR"], [4 | 8 | 16, "地下鉄・私鉄など"]];
export function stationVisits(visits, rows, km = STATION_KM) {
  // 0.01度(約1km)のます目に駅を入れておき、訪問のまわり3×3だけ見る。
  const cell = (lat, lng) => `${Math.floor(lat * 100)},${Math.floor(lng * 100)}`;
  const grid = new Map();
  rows.forEach((r, i) => { const k = cell(r[1], r[2]); grid.set(k, [...(grid.get(k) || []), i]); });
  const out = new Map();
  for (const v of visits) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
    let best = -1, bd = km;
    const y = Math.floor(v.lat * 100), x = Math.floor(v.lng * 100);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of grid.get(`${y + dy},${x + dx}`) || []) {
      const d = distKm(v, { lat: rows[i][1], lng: rows[i][2] });
      if (d <= bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    const a = out.get(best) || { i: best, count: 0, first: "" };
    a.count++;
    if (v.date && (!a.first || v.date < a.first)) a.first = v.date;
    out.set(best, a);
  }
  return out;
}

// ---- 市区町村役場(ab-48、2026-10-07) ----
// offices.json(scripts/build-m6-offices.mjs)の行 [団体コード, 名前, 緯度, 経度, 県コード, 種類] ごとに、訪問が OFFICE_KM 以内に
// 入った回数と最初の日。役所はまばらなので名城と同じく「以内ならどれも」。2000件 × 訪問を全部比べないよう、ます目で引く。
// 返り値: 行った役所の Map(行の番号 → { i, count, first })。
export const OFFICE_KM = 0.5;
export const OFFICE_KINDS = [[1, "市役所"], [2, "区役所"], [3, "町役場"], [4, "村役場"]];
export const officeVisits = (visits, rows, km = OFFICE_KM) => nearVisits(visits, rows.map((r) => ({ lat: r[2], lng: r[3] })), km);

// 点 pts [{lat, lng}] ごとに、訪問が km(1km まで)以内に入った回数と最初の日。0.01度(約1km)のます目に点を入れ、訪問のまわり3×3だけ見る。
// 返り値: 入った点の Map(pts の番号 → { i, count, first })。役所・コメダで使う。
export function nearVisits(visits, pts, km) {
  const grid = new Map();
  pts.forEach((p, i) => { const k = `${Math.floor(p.lat * 100)},${Math.floor(p.lng * 100)}`; grid.set(k, [...(grid.get(k) || []), i]); });
  const out = new Map();
  for (const v of visits) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) continue;
    const y = Math.floor(v.lat * 100), x = Math.floor(v.lng * 100);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of grid.get(`${y + dy},${x + dx}`) || []) {
      if (distKm(v, pts[i]) > km) continue;
      const a = out.get(i) || { i, count: 0, first: "" };
      a.count++;
      if (v.date && (!a.first || v.date < a.first)) a.first = v.date;
      out.set(i, a);
    }
  }
  return out;
}

// ---- ドーム(ab-48、2026-10-07) ----
// domes.json の行 [名前, 緯度, 経度, 県, Q番号]。中に入らなくても、外から見れば(訪問が DOME_KM 以内)行った。名城と同じ計算。
export const DOME_KM = 0.5;
export const domeVisits = (visits, domes, km = DOME_KM) =>
  castleVisits(visits, domes.map(([name, lat, lng, pref, qid], i) => [i, name, lat, lng, pref, qid]), km);

// ---- お店(ab-48、2026-10-07): イオンモールとコメダ ----
// shops.json(scripts/build-m6-shops.mjs、OpenStreetMap)の行 [名前, 緯度, 経度, 県コード, OSM の id]。
// イオンモールは表がほぼそろっているので名城と同じ「制覇」(いちばん近づいた距離も出す)。建物が大きいので0.5km。
// コメダは表が4分の1ほど欠けているので「行った数」だけ。店は小さく町なかに多いので0.15km。
export const AEON_KM = 0.5;
export const KOMEDA_KM = 0.15;
export const aeonVisits = (visits, rows, km = AEON_KM) =>
  castleVisits(visits, rows.map(([name, lat, lng, pref, id], i) => [i, name, lat, lng, pref, id]), km);
export const komedaVisits = (visits, rows, km = KOMEDA_KM) => nearVisits(visits, rows.map((r) => ({ lat: r[1], lng: r[2] })), km);

// 点 [lng, lat] がどの県の中か(県の features から)。どこにも入らない(海の上など)なら ""。
export function prefAt(pt, features) {
  const f = features.find((x) => inGeometry(pt, x.geometry));
  return f ? f.properties.N03_001 : "";
}

// ---- クイズ ----
// 1問 = { kind, prompt, marks: {県名: "target"|"target2"}, choices: [文字列], answer: 文字列, pref: 主役の県, after: 答えたあとの一言, show: 答えたあとに塗る県 }
export const QUIZ_KINDS = [
  ["shape", "形あて"],
  ["neighbor", "となりの県"],
  ["area", "広いのはどっち"],
  ["capital", "県庁所在地"],
  ["region", "どの地方"], // 2026-10-07 礼文(ab-84 の3、豆知識クイズの形あてではない方。データは REGIONS をそのまま使う)
];
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const shuffle = (arr, rng) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const short = (n) => (n === "北海道" ? n : n.replace(/[都府県]$/, ""));
// 県名と同じ名前の市が県庁所在地の県は、県庁所在地クイズでは出さない(答えが見えてしまう)。
export const capitalAskable = (n) => !CAPITALS[n].startsWith(short(n));

// kinds のどれかで、なるべく focus(まちがえた県など)の県を主役にして1問作る。出せないときは null。
// ctx.avoid(この回にもう出た県)は、ほかに出せる県があるうちは主役にしない(1回5問で同じ県が続かないように)。
export function makeQuiz(kind, ctx, rng = Math.random, focus = null) {
  const { names, adj } = ctx;
  const avoid = ctx.avoid || new Set();
  const from = (ok) => {
    const f = focus && focus.filter((n) => names.includes(n) && ok(n) && !avoid.has(n));
    if (f && f.length) return pick(f, rng);
    const fresh = names.filter((n) => ok(n) && !avoid.has(n));
    return pick(fresh.length ? fresh : names.filter(ok), rng);
  };
  if (kind === "shape") {
    const t = from(() => true);
    const others = shuffle(names.filter((n) => n !== t), rng).slice(0, 3);
    return { kind, pref: t, prompt: "色のついた県はどこ?", marks: { [t]: "target" }, choices: shuffle([t, ...others], rng), answer: t, after: `${t}(${regionOf(t)})`, show: [] };
  }
  if (kind === "neighbor") {
    const t = from((n) => (adj.get(n) || new Set()).size > 0);
    const ns = adj.get(t);
    const right = pick([...ns], rng);
    // はずれは「となりのとなり」から選ぶ(近くて紛らわしい)。足りなければ同じ地方・全体から。
    const near = new Set();
    for (const m of ns) for (const k of adj.get(m)) near.add(k);
    const ng = (n) => n !== t && !ns.has(n);
    let wrong = shuffle([...near].filter(ng), rng).slice(0, 3);
    if (wrong.length < 3) wrong = wrong.concat(shuffle(names.filter((n) => ng(n) && !wrong.includes(n)), rng).slice(0, 3 - wrong.length));
    return { kind, pref: t, prompt: `${t}のとなりの県はどれ?`, marks: { [t]: "target" }, choices: shuffle([right, ...wrong], rng), answer: right,
      after: `${t}のとなり: ${[...ns].join("・")}`, show: [...ns] };
  }
  if (kind === "area") {
    const a = from(() => true);
    const ok = (n) => n !== a && Math.max(AREAS[a], AREAS[n]) / Math.min(AREAS[a], AREAS[n]) >= 1.15;
    // なるべく近い県(となり・となりのとなり)と比べる。地図で見比べられるので。
    const near = new Set(adj.get(a) || []);
    for (const m of [...near]) for (const k of adj.get(m)) near.add(k);
    const cand = [...near].filter(ok);
    const b = cand.length ? pick(cand, rng) : pick(names.filter(ok), rng);
    const answer = AREAS[a] > AREAS[b] ? a : b;
    return { kind, pref: a, prompt: "広いのはどっち?", marks: { [a]: "target", [b]: "target2" }, choices: shuffle([a, b], rng), answer,
      after: `${a} ${areaText(a)} / ${b} ${areaText(b)}`, show: [] };
  }
  if (kind === "capital") {
    const t = from(capitalAskable);
    const right = CAPITALS[t];
    const wrong = shuffle(names.filter((n) => n !== t).map((n) => CAPITALS[n]), rng).slice(0, 3);
    return { kind, pref: t, prompt: `${t}の県庁所在地は?`, marks: { [t]: "target" }, choices: shuffle([right, ...wrong], rng), answer: right,
      after: `${t} → ${right}`, show: [] };
  }
  if (kind === "region") {
    // 地方が1県だけ(北海道)だと答えが見えるので出さない。はずれは、なるべくとなりの県の地方から(近くて紛らわしい)。
    const t = from((n) => regionOf(n) !== n);
    const right = regionOf(t);
    const near = [...new Set([...(adj.get(t) || [])].map(regionOf))].filter((r) => r !== right);
    const rest = REGIONS.map(([r]) => r).filter((r) => r !== right && !near.includes(r));
    const wrong = shuffle(near, rng).concat(shuffle(rest, rng)).slice(0, 3);
    const same = REGIONS.find(([r]) => r === right)[1];
    return { kind, pref: t, prompt: `${t}はどの地方?`, marks: { [t]: "target" }, choices: shuffle([right, ...wrong], rng), answer: right,
      after: `${t} → ${right}(${same.map(short).join("・")})`, show: same };
  }
  return null;
}
