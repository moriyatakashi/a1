// ab-153: 1日に何か所か回ったときの1点の判定(visit-round.js)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundPointFor, routeKm, ROUND_RULE } from "./visit-round.js";

// 緯度 0.1 度 ≒ 11km
const v = (time, lat, extra = {}) => ({ date: "2026-10-08", time, lat, lng: 135.5, ...extra });

test("3か所で合計10km以上なら付く。距離は回った順(time の順)", () => {
  assert.equal(ROUND_RULE.minVisits, 3);
  const r = roundPointFor([v("09:00", 34.6), v("12:00", 34.7)], v("15:00", 34.71));
  assert.equal(r.count, 3);
  assert.ok(r.km > 11 && r.km < 13);
});

test("2か所しかない・近場だけ・別の日だけなら付かない", () => {
  assert.equal(roundPointFor([v("09:00", 34.6)], v("12:00", 34.8)), null);
  assert.equal(roundPointFor([v("09:00", 34.70), v("10:00", 34.701)], v("11:00", 34.702)), null);
  assert.equal(roundPointFor([v("09:00", 34.6, { date: "2026-10-07" }), v("10:00", 34.7)], v("11:00", 34.8)), null);
});

test("その日にもう満たしていれば2点目は付かない(途中に差し込んでも)。座標の無い訪問は数えない", () => {
  assert.equal(roundPointFor([v("09:00", 34.6), v("10:00", 34.7), v("11:00", 34.8)], v("12:00", 34.9)), null);
  assert.equal(roundPointFor([v("09:00", 34.6), v("10:00", 34.7), v("11:00", 34.8)], v("09:30", 34.9)), null);
  assert.equal(roundPointFor([v("09:00", 34.6), { date: "2026-10-08", time: "10:00" }], v("11:00", 34.8)), null);
  assert.equal(roundPointFor([v("09:00", 34.6), v("10:00", 34.7)], v("11:00", 34.8, { date: "" })), null);
});

test("行って戻るのも距離に数える(順に並べ直す)", () => {
  // 12:00 に遠く、9:00 と 15:00 は家の近く → 往復で約22km
  assert.ok(routeKm([v("15:00", 34.6), v("09:00", 34.6), v("12:00", 34.7)]) > 20);
});
