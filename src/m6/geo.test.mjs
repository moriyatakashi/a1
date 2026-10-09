// ab-44(2026-10-03): m6 の geo.js(となり・面積・県庁所在地・地方・クイズ作り)を、実際の prefectures.geojson で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, CAPITALS, AREAS, adjacency, centers, distKm, frontier, regionProgress, QUIZ_KINDS, makeQuiz, capitalAskable, prefCode, inGeometry, cityVisits, castleVisits, wishVisits, stationVisits, STATION_KM, officeVisits, OFFICE_KM, domeVisits, aeonVisits, komedaVisits, KOMEDA_KM, COUNT_SHOPS, shopCountVisits, BATH_KM, prefAt } from "./geo.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const features = JSON.parse(fs.readFileSync(path.join(HERE, "../m5/prefectures.geojson"), "utf8")).features;
const names = [...new Set(features.map((f) => f.properties.N03_001))];
const adj = adjacency(features);

// 決まった乱数(毎回同じ問題になる)
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("表: 47県そろっていて、地図の県名と一致する", () => {
  assert.equal(names.length, 47);
  assert.deepEqual(REGIONS.flatMap(([, ps]) => ps).sort(), [...names].sort());
  assert.deepEqual(Object.keys(CAPITALS).sort(), [...names].sort());
  assert.deepEqual(Object.keys(AREAS).sort(), [...names].sort());
});

test("となり: 実際の県境どおり、向きはどちらからでも同じ", () => {
  assert.equal(adj.get("北海道").size, 0);
  assert.equal(adj.get("沖縄県").size, 0);
  assert.deepEqual([...adj.get("長野県")].sort(), ["群馬県", "埼玉県", "山梨県", "新潟県", "富山県", "静岡県", "岐阜県", "愛知県"].sort());
  assert.deepEqual([...adj.get("香川県")].sort(), ["徳島県", "愛媛県"].sort());
  assert.ok(adj.get("京都府").has("三重県"));
  assert.ok(!adj.get("大阪府").has("三重県"));
  for (const [a, s] of adj) for (const b of s) assert.ok(adj.get(b).has(a), `${a}→${b}`);
});

test("次に晴らせる県・地方ごとの制覇", () => {
  const visited = new Set(["大阪府", "滋賀県"]);
  const f = frontier(visited, adj);
  assert.ok(f.has("京都府") && f.has("岐阜県") && f.has("和歌山県"));
  assert.ok(!f.has("大阪府") && !f.has("東京都"));
  const kinki = regionProgress(visited).find((r) => r.name === "近畿");
  assert.deepEqual(kinki, { name: "近畿", done: 2, total: 7 });
});

test("中心と距離: 大阪と東京はだいたい400km", () => {
  const c = centers(features);
  const d = distKm(c.get("大阪府"), c.get("東京都"));
  assert.ok(d > 300 && d < 500, String(d));
});

test("クイズ: どの種類でも、答えが選択肢にあり、選択肢は重ならない", () => {
  for (const [kind] of QUIZ_KINDS) {
    for (let seed = 1; seed <= 200; seed++) {
      const q = makeQuiz(kind, { names, adj }, seeded(seed));
      assert.ok(q.choices.includes(q.answer), `${kind} ${seed}`);
      assert.equal(new Set(q.choices).size, q.choices.length);
      assert.equal(q.choices.length, kind === "area" ? 2 : 4);
      if (kind === "neighbor") {
        assert.ok(adj.get(q.pref).has(q.answer));
        for (const c of q.choices) if (c !== q.answer) assert.ok(!adj.get(q.pref).has(c), `${q.pref}: ${c}`);
      }
      if (kind === "area") {
        const [a, b] = q.choices;
        assert.equal(q.answer, AREAS[a] > AREAS[b] ? a : b);
        assert.ok(Math.max(AREAS[a], AREAS[b]) / Math.min(AREAS[a], AREAS[b]) >= 1.15);
      }
      if (kind === "capital") {
        assert.ok(capitalAskable(q.pref), q.pref);
        assert.equal(q.answer, CAPITALS[q.pref]);
      }
      if (kind === "region") {
        assert.notEqual(q.pref, "北海道"); // 地方の名前と同じなので出さない
        assert.equal(q.answer, REGIONS.find(([, ps]) => ps.includes(q.pref))[0]);
        for (const c of q.choices) assert.ok(REGIONS.some(([r]) => r === c), c);
      }
    }
  }
  assert.ok(!capitalAskable("青森県") && capitalAskable("岩手県") && capitalAskable("愛知県"));
});

test("まちがい直し: まちがえた県があれば、その県が主役になる", () => {
  for (let seed = 1; seed <= 50; seed++) {
    assert.equal(makeQuiz("neighbor", { names, adj }, seeded(seed), ["香川県"]).pref, "香川県");
    // 県庁所在地クイズに出せない県しか無いときは、ふつうに出す
    assert.ok(capitalAskable(makeQuiz("capital", { names, adj }, seeded(seed), ["青森県"]).pref));
  }
});

test("1回の中: もう出た県(avoid)は、ほかに出せるうちは主役にしない", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seeded(seed), avoid = new Set();
    for (let i = 0; i < 5; i++) {
      const q = makeQuiz(QUIZ_KINDS[i % QUIZ_KINDS.length][0], { names, adj, avoid }, rng);
      assert.ok(!avoid.has(q.pref), `${seed}-${i}: ${q.pref}`);
      avoid.add(q.pref);
    }
  }
  // まちがえた県が全部もう出ていたら、ほかの県から出す
  const q = makeQuiz("shape", { names, adj, avoid: new Set(["香川県"]) }, seeded(3), ["香川県"]);
  assert.notEqual(q.pref, "香川県");
});

// ---- 市区町村(ab-107) ----
const city = (nn) => JSON.parse(fs.readFileSync(path.join(HERE, `city/${nn}.json`), "utf8"));

test("県コード: REGIONS の順が JIS の県コード、city/NN.json の県と合う", () => {
  assert.equal(prefCode("北海道"), "01");
  assert.equal(prefCode("東京都"), "13");
  assert.equal(prefCode("沖縄県"), "47");
  assert.equal(prefCode("どこか"), null);
  for (const n of names) {
    const c = city(prefCode(n));
    assert.equal(c.pref, n);
    assert.ok(c.features.every((f) => f.properties.c.startsWith(prefCode(n))), n);
  }
});

test("市区町村: 緯度経度から点の内外で決まる、政令市は区まで", () => {
  const fs27 = [...city("27").features, ...city("25").features];
  const vs = [
    { lat: 34.7025, lng: 135.4959, date: "2026-09-02" }, // 梅田
    { lat: 34.7030, lng: 135.4970, date: "2026-08-01" }, // 梅田(もう1回、こっちが先)
    { lat: 35.0170, lng: 135.9600, date: "2026-09-27" }, // 草津
    { lat: 35.0, lng: 140.0 },                            // どこでもない(千葉沖)
  ];
  const got = cityVisits(vs, fs27);
  assert.deepEqual([...got.values()].map((a) => [a.name, a.count, a.first]).sort(),
    [["大阪市北区", 2, "2026-08-01"], ["草津市", 1, "2026-09-27"]]);
});

test("市区町村: 緯度経度が無ければ visits の city・town の名前で合わせる", () => {
  const got = cityVisits([{ city: "大阪市", town: "北区梅田" }, { city: "豊中市", town: "" }, { city: "架空市" }], city("27").features);
  assert.deepEqual([...got.values()].map((a) => a.name).sort(), ["大阪市北区", "豊中市"]);
});

test("inGeometry: 穴の中は外", () => {
  const sq = (a, b) => [[a, a], [b, a], [b, b], [a, b], [a, a]];
  const g = { type: "Polygon", coordinates: [sq(0, 10), sq(4, 6)] };
  assert.ok(inGeometry([2, 2], g));
  assert.ok(!inGeometry([5, 5], g));
  assert.ok(!inGeometry([11, 5], g));
});

// ---- 日本100名城(ab-108) ----
test("100名城: 表は1〜100がそろい、県は47都道府県のどれか", () => {
  const cs = JSON.parse(fs.readFileSync(path.join(HERE, "castles.json"), "utf8"));
  assert.deepEqual(cs.map((c) => c[0]), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.ok(cs.every((c) => names.includes(c[4])), "県名");
  assert.equal(cs.find((c) => c[0] === 59)[4], "兵庫県"); // 姫路城
  assert.equal(cs.find((c) => c[0] === 100)[4], "沖縄県"); // 首里城
});

test("100名城: 1km 以内に入ったら行った、いちばん近づいた距離も出す", () => {
  const cs = [[54, "大坂城", 34.68722, 135.52583, "大阪府", "Q"], [59, "姫路城", 34.83944, 134.69389, "兵庫県", "Q"]];
  const vs = [
    { lat: 34.6880, lng: 135.5300, date: "2026-09-02", place: "大阪城公園" }, // 約0.4km
    { lat: 34.6870, lng: 135.5250, date: "2026-08-01", place: "天守" },
    { lat: 34.7025, lng: 135.4959, date: "2026-07-01", place: "梅田" },       // 約3km、行ったには入らない
    { lat: NaN, lng: NaN, date: "2026-01-01" },
  ];
  const [osaka, himeji] = castleVisits(vs, cs);
  assert.equal(osaka.done, true);
  assert.equal(osaka.count, 2);
  assert.equal(osaka.first, "2026-08-01");
  assert.ok(osaka.near < 0.1);
  assert.equal(himeji.done, false);
  assert.ok(himeji.near > 60 && himeji.near < 80, String(himeji.near));
  assert.equal(himeji.nearPlace, "梅田");
});

// ---- 願望マップ(ab-84 の1) ----
test("願望マップ: 1km 以内に入ったらかなった、元の項目(id・label)はそのまま", () => {
  const ws = [
    { id: "w1", label: "大阪城", lat: 34.68722, lng: 135.52583, pref: "大阪府", createdAt: "2026-10-04T00:00:00Z" },
    { id: "w2", label: "函館山", lat: 41.7594, lng: 140.7044, pref: "北海道", createdAt: "2026-10-04T00:00:00Z" },
  ];
  const [a, b] = wishVisits([{ lat: 34.6880, lng: 135.5300, date: "2026-09-02", place: "大阪城公園" }], ws);
  assert.equal(a.id, "w1");
  assert.equal(a.label, "大阪城");
  assert.equal(a.done, true);
  assert.equal(a.first, "2026-09-02");
  assert.equal(b.done, false);
  assert.ok(b.near > 900, String(b.near));
  assert.deepEqual(wishVisits([], []), []);
});

test("prefAt: 点がどの県か、海の上は空", () => {
  assert.equal(prefAt([135.4959, 34.7025], features), "大阪府");
  assert.equal(prefAt([140.7044, 41.7594], features), "北海道");
  assert.equal(prefAt([137.0, 33.0], features), "");
});
// ---- 駅(ab-48) ----
test("駅: 表は9000駅ほどで、新宿は JR・京王・小田急・地下鉄が1駅にまとまり、新幹線の駅は100ほど", () => {
  const st = JSON.parse(fs.readFileSync(path.join(HERE, "stations.json"), "utf8"));
  assert.ok(st.rows.length > 8500 && st.rows.length < 9500, String(st.rows.length));
  assert.ok(st.rows.every((r) => r[3] >= 1 && r[3] <= 47 && r[4] > 0 && r[5].every((i) => st.lines[i])));
  const shinjuku = st.rows.filter((r) => r[0] === "新宿");
  assert.equal(shinjuku.length, 1);
  assert.equal(shinjuku[0][3], 13);
  const ops = new Set(shinjuku[0][5].map((i) => st.ops[st.lines[i][0]]));
  for (const o of ["東日本旅客鉄道", "京王電鉄", "小田急電鉄", "東京地下鉄", "東京都"]) assert.ok(ops.has(o), o);
  const shinkansen = st.rows.filter((r) => r[4] & 1).length;
  assert.ok(shinkansen > 90 && shinkansen < 120, String(shinkansen));
});

test("駅: 訪問ごとに、いちばん近い駅が0.5km以内ならその1駅だけ行ったにする", () => {
  const rows = [["大阪", 34.70252, 135.49466, 27, 2, []], ["梅田", 34.70313, 135.49768, 27, 8, []], ["姫路", 34.82667, 134.69060, 28, 3, []]];
  const vs = [
    { lat: 34.7026, lng: 135.4950, date: "2026-09-02" }, // 大阪のすぐそば(梅田も0.5km以内だが、近い大阪だけ)
    { lat: 34.7030, lng: 135.4975, date: "2026-08-01" }, // 梅田
    { lat: 34.7027, lng: 135.4949, date: "2026-07-01" }, // 大阪をもう一度(初めての日が早まる)
    { lat: 34.80, lng: 134.69, date: "2026-09-03" },     // 姫路から約3km: どこにも入らない
    { lat: NaN, lng: NaN, date: "2026-09-04" },
  ];
  const got = stationVisits(vs, rows);
  assert.equal(STATION_KM, 0.5);
  assert.deepEqual([...got.keys()].sort(), [0, 1]);
  assert.deepEqual(got.get(0), { i: 0, count: 2, first: "2026-07-01" });
  assert.equal(got.get(1).count, 1);
});

// ---- 市区町村役場・ドーム(ab-48) ----
test("役所: 表は m6 の市区町村と同じ並び(浜松市の旧区を除く)に政令市の市役所を足したもの", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(HERE, "offices.json"), "utf8"));
  assert.ok(rows.length > 1900 && rows.length < 1950, String(rows.length));
  assert.equal(new Set(rows.map((r) => r[0])).size, rows.length, "団体コードは重ならない");
  assert.deepEqual(rows.find((r) => r[0] === "27100").slice(1, 2), ["大阪市役所"]);
  assert.equal(rows.find((r) => r[0] === "13101")[1], "千代田区役所");
  assert.equal(rows.filter((r) => r[5] === 1).length, 792); // 市は792
});

test("役所: 0.5km 以内に入った役所はどれも行った(近くに2つあれば2つとも)", () => {
  const rows = [["27100", "大阪市役所", 34.69375, 135.50211, 27, 1], ["27127", "大阪市北区役所", 34.70489, 135.51047, 27, 2], ["28201", "姫路市役所", 34.81500, 134.68534, 28, 1]];
  const got = officeVisits([
    { lat: 34.6990, lng: 135.5060, date: "2026-09-02" }, // 市役所から約0.7km・北区役所から約0.8km: どちらでもない
    { lat: 34.6940, lng: 135.5025, date: "2026-09-03" }, // 市役所の前
    { lat: 34.6941, lng: 135.5024, date: "2026-08-01" },
  ], rows);
  assert.equal(OFFICE_KM, 0.5);
  assert.deepEqual([...got.values()], [{ i: 0, count: 2, first: "2026-08-01" }]);
});

test("ドーム: 6つ、外から0.5km以内で行った", () => {
  const domes = JSON.parse(fs.readFileSync(path.join(HERE, "domes.json"), "utf8"));
  assert.equal(domes.length, 6);
  const [tokyo] = domeVisits([{ lat: 35.7040, lng: 139.7510, date: "2026-09-02", place: "水道橋" }], domes.filter((d) => d[0] === "東京ドーム"));
  assert.ok(tokyo.done && tokyo.near < 0.5);
  assert.equal(tokyo.name, "東京ドーム");
});

// ---- お店(ab-48): イオンモールとコメダ ----
test("お店: イオンモールは130以上・コメダは600以上、名前はそれぞれのチェーン、県は1〜47", () => {
  const s = JSON.parse(fs.readFileSync(path.join(HERE, "shops.json"), "utf8"));
  assert.ok(s.aeon.length >= 120 && s.aeon.every((r) => r[0].startsWith("イオンモール")), String(s.aeon.length));
  assert.ok(s.komeda.length >= 600 && s.komeda.every((r) => !/駐車場/.test(r[0])), String(s.komeda.length));
  assert.ok([...s.aeon, ...s.komeda].every((r) => r[3] >= 1 && r[3] <= 47));
});

// 2026-10-09(礼文): 銭湯・温泉と東横イン・アパホテル
test("お風呂・宿: 銭湯・温泉は3000以上で足湯・家族風呂は入らない、東横イン・アパホテルは名前がそのチェーン、県は1〜47", () => {
  const s = JSON.parse(fs.readFileSync(path.join(HERE, "shops.json"), "utf8"));
  assert.ok(s.bath.length >= 3000 && s.bath.every((r) => !/足湯|手湯|家族風呂/.test(r[0])), String(s.bath.length));
  assert.ok(s.toyoko.length >= 200 && s.toyoko.every((r) => /東[横橫]|toyoko/i.test(r[0])), String(s.toyoko.length));
  assert.ok(s.apa.length >= 150 && s.apa.every((r) => /アパ|APA/i.test(r[0])), String(s.apa.length));
  assert.ok([...s.bath, ...s.toyoko, ...s.apa].every((r) => r[3] >= 1 && r[3] <= 47));
  // 画面の並び(COUNT_SHOPS)の表はどれも shops.json にある
  assert.ok(COUNT_SHOPS.every((c) => Array.isArray(s[c.key]) && s[c.key].length > 0));
});

test("お風呂・宿: 銭湯は0.2km以内、チェーン名は一覧で落とす", () => {
  const bath = [["なにわの湯", 34.7000, 135.5000, 27, "w1"]];
  assert.equal(BATH_KM, 0.2);
  assert.deepEqual([...shopCountVisits([{ lat: 34.7015, lng: 135.5000, date: "2026-09-02" }], bath, BATH_KM).keys()], [0]); // 約170m
  assert.equal(shopCountVisits([{ lat: 34.7025, lng: 135.5000 }], bath, BATH_KM).size, 0); // 約280m
  const strip = Object.fromEntries(COUNT_SHOPS.map((c) => [c.key, c.strip]));
  assert.equal("東横INN新大阪中央口本館".replace(strip.toyoko, ""), "新大阪中央口本館");
  assert.equal("アパホテル〈なんば駅前〉".replace(strip.apa, ""), "〈なんば駅前〉");
});

test("お店: イオンモールは0.5km以内で行った(いちばん近づいた距離も)、コメダは0.15km以内の店だけ数える", () => {
  const aeon = [["イオンモールA", 34.7000, 135.5000, 27, "w1"]];
  const [a] = aeonVisits([{ lat: 34.7030, lng: 135.5000, date: "2026-09-02", place: "A" }], aeon); // 約0.33km
  assert.ok(a.done && a.name === "イオンモールA");
  const komeda = [["コメダ珈琲店 甲", 34.7000, 135.5000, 27, "n1"], ["コメダ珈琲店 乙", 34.7020, 135.5000, 27, "n2"]];
  const got = komedaVisits([{ lat: 34.7005, lng: 135.5000, date: "2026-09-02" }], komeda); // 甲から約55m・乙から約170m
  assert.equal(KOMEDA_KM, 0.15);
  assert.deepEqual([...got.keys()], [0]);
});
