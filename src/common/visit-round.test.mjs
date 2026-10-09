// ab-153: 1日に何か所か回ったときの1点の判定(visit-round.js)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { roundPointFor, routeKm, hullKm2, ROUND_RULE } from "./visit-round.js";

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

// 2026-10-09: 面積(凸包)の条件。大阪の駅の座標で、すまが Takashi に見せた例と同じ結果になるか。
const st = (time, lat, lng) => ({ date: "2026-10-09", time, lat, lng });
const UMEDA = [34.7025, 135.4959], NAMBA = [34.6666, 135.5011], TENNOJI = [34.6466, 135.5133],
  KYOBASHI = [34.6966, 135.5345], SHINOSAKA = [34.7335, 135.5002];

test("面積: 5km² の条件があり、三角形の広さを km² で出す", () => {
  assert.equal(ROUND_RULE.minKm2, 5);
  const km2 = hullKm2([st("9", ...UMEDA), st("10", ...KYOBASHI), st("11", ...TENNOJI)]);
  assert.ok(km2 > 9.5 && km2 < 11.5, `km2=${km2}`);
  assert.equal(hullKm2([st("9", ...UMEDA), st("10", ...KYOBASHI)]), 0);
});

test("面積: 距離が 10km に届かなくても、囲んだ広さが 5km² 以上なら付く", () => {
  const r = roundPointFor([st("09:00", ...UMEDA), st("10:00", ...KYOBASHI)], st("11:00", ...TENNOJI));
  assert.ok(r && r.km < 10 && r.km2 >= 5);
  const r2 = roundPointFor([st("09:00", ...UMEDA), st("10:00", ...SHINOSAKA)], st("11:00", ...KYOBASHI));
  assert.ok(r2 && r2.km < 10 && r2.km2 >= 5);
});

test("面積: ほぼ一直線(梅田→難波→天王寺)は距離も面積も足りず付かない", () => {
  assert.equal(roundPointFor([st("09:00", ...UMEDA), st("10:00", ...NAMBA)], st("11:00", ...TENNOJI)), null);
});

test("面積: 点を足しても小さくならない(1日1点のまま)", () => {
  const day = [st("09:00", ...UMEDA), st("10:00", ...KYOBASHI), st("11:00", ...TENNOJI)];
  assert.ok(hullKm2([...day, st("12:00", ...NAMBA)]) >= hullKm2(day) - 1e-9);
  assert.equal(roundPointFor(day, st("12:00", ...NAMBA)), null);
});
