// b1 ah-55(ah-51 の5): 日々記録の点。記録は1回2点・最大6点、面積は 2km² で満点3点(上限あり)、小数1けた。
import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyBonus, bonusText, mergeWeights, DEFAULT_BONUS_WEIGHTS } from "../src/common/daily-bonus.js";

test("dailyBonus: 記録は1つ2点、面積は ÷2×3 で上限3点", () => {
  assert.deepEqual(dailyBonus(null), { record: 0, area: 0, total: 0 });
  assert.deepEqual(dailyBonus({ trips: { home: { at: "x" } } }), { record: 2, area: 0, total: 2 });
  const all = { home: {}, station: {}, office: {} };
  assert.deepEqual(dailyBonus({ trips: all, areaKm2: 1 }), { record: 6, area: 1.5, total: 7.5 });
  assert.deepEqual(dailyBonus({ trips: all, areaKm2: 5 }), { record: 6, area: 3, total: 9 });
  assert.equal(dailyBonus({ trips: all, areaKm2: 0.123 }).area, 0.2);
  assert.equal(dailyBonus({ trips: { other: {} } }).record, 0);
});

test("mergeWeights: scoreConfig/weights のある欄だけ上書き", () => {
  assert.deepEqual(mergeWeights(null), DEFAULT_BONUS_WEIGHTS);
  assert.deepEqual(mergeWeights({ recordPoints: 3, areaMax: "x", recordMax: null }), { ...DEFAULT_BONUS_WEIGHTS, recordPoints: 3 });
  assert.equal(dailyBonus({ trips: { home: {}, station: {}, office: {} } }, { recordPoints: 3, recordMax: 9 }).record, 9);
});

test("bonusText: 足した分が分かる形。無ければ空", () => {
  assert.equal(bonusText(98, { record: 6, area: 1.5, total: 7.5 }), "スコア 98 ＋記録 6 ＋面積 1.5");
  assert.equal(bonusText(98, { record: 2, area: 0, total: 2 }), "スコア 98 ＋記録 2");
  assert.equal(bonusText(98, { record: 0, area: 0, total: 0 }), "");
});
