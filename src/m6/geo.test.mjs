// ab-44(2026-10-03): m6 の geo.js(となり・面積・県庁所在地・地方・クイズ作り)を、実際の prefectures.geojson で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, CAPITALS, AREAS, adjacency, centers, distKm, frontier, regionProgress, QUIZ_KINDS, makeQuiz, capitalAskable, prefCode, inGeometry, cityVisits, castleVisits } from "./geo.js";

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
