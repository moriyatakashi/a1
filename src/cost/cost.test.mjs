// 課金の指数(ab-171)。並べ方・0 の続き・折れ線の点を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesByProvider, zeroStreak, points, md } from "./cost.js";

test("課金元ごとに古い週から並べ、形のおかしい行は捨てる", () => {
  const s = seriesByProvider([
    { provider: "azure", week: "2026-10-12", index: 0 },
    { provider: "azure", week: "2026-08-03", index: 100 },
    { provider: "azure", week: "bad", index: 1 },
    { provider: "azure", week: "2026-08-10", index: "100" },
    null,
  ]);
  assert.deepEqual(s, { azure: [{ week: "2026-08-03", index: 100 }, { week: "2026-10-12", index: 0 }] });
});

test("0 が続いている週の数", () => {
  for (const [idx, want] of [[[100, 0, 0], 2], [[0, 100], 0], [[], 0], [[0], 1]]) {
    assert.equal(zeroStreak(idx.map((index, i) => ({ week: `w${i}`, index }))), want, JSON.stringify(idx));
  }
});

test("折れ線の点: 100 が上の端、0 が下の端、100 を超えたら超えた分が上の端", () => {
  const p = points([{ week: "a", index: 100 }, { week: "b", index: 0 }], 100, 100, 0);
  assert.deepEqual(p.map(({ x, y }) => [x, y]), [[0, 0], [100, 100]]);
  const q = points([{ week: "a", index: 200 }, { week: "b", index: 100 }], 100, 100, 0);
  assert.deepEqual(q.map(({ y }) => y), [0, 50]);
  assert.deepEqual(points([], 100, 100), []);
  assert.equal(md("2026-08-03"), "8/3");
});
