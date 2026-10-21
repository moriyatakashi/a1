// m1 の1日3回の記録(b1 ah-51)。丸め・面積・近くの場所の並べ方を確かめる。
// 座標は赤道まわりの作りもの(公開レポなので、実際の場所は書かない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundPos, triangleKm2, pickNearby, distKm } from "./trips.js";

test("位置は小数3けたに丸める", () => {
  assert.deepEqual(roundPos(1.23456, 2.34549), { lat: 1.235, lng: 2.345 });
});

test("面積: 3点そろわなければ null、そろえば km² の小数2けた", () => {
  assert.equal(triangleKm2({ home: { lat: 0, lng: 0 }, station: { lat: 0, lng: 0.01 } }), null);
  assert.equal(triangleKm2({ home: { lat: 0, lng: 0 }, station: { lat: 0, lng: 0.01 }, office: { at: "x" } }), null);
  // 底辺約1.11km・高さ約1.11km の直角三角形 → 約0.62km²
  assert.equal(triangleKm2({ home: { lat: 0, lng: 0 }, station: { lat: 0, lng: 0.01 }, office: { lat: 0.01, lng: 0 } }), 0.62);
});

test("近くの場所: 近い順・名前の重複なし・種類ごとに n 件", () => {
  const pos = { lat: 0, lng: 0 };
  const json = { elements: [
    { lat: 0, lon: 0.02, tags: { name: "見晴台" } },
    { lat: 0, lon: 0.01, tags: { name: "博物館" } },
    { center: { lat: 0, lon: 0.03 }, tags: { name: "コメダ珈琲店 A店" } },
    { lat: 0, lon: 0.04, tags: { name: "博物館" } },
    { lat: 0, lon: 0.05, tags: {} },
  ] };
  const got = pickNearby(json, pos, 1);
  assert.deepEqual(got.map((x) => x.name), ["博物館", "コメダ珈琲店 A店"]);
  assert.ok(Math.abs(got[0].km - distKm(pos, { lat: 0, lng: 0.01 })) < 1e-9);
});
