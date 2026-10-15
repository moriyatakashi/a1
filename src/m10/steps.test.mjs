// m10 歩数の週まとめ(ab-128)。週の区切り・記録なしの日と週・1日あたりを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStart, groupByWeek, dailyAverage, md } from "./steps.js";

test("週は月曜はじまり(月・水・日・月またぎ)", () => {
  for (const [date, start] of [
    ["2026-10-12", "2026-10-12"], // 月
    ["2026-10-14", "2026-10-12"], // 水
    ["2026-10-18", "2026-10-12"], // 日
    ["2026-11-01", "2026-10-26"], // 日・月またぎ
  ]) assert.equal(weekStart(date), start, date);
});

test("週ごと: 記録の無い日は null、間の週も並べ、今日の週まで出す", () => {
  const weeks = groupByWeek([
    { date: "2026-10-13", steps: 190 },
    { date: "2026-10-14", steps: 31 },
    { date: "2026-10-28", steps: 5000 },
    { date: "bad", steps: 1 },
  ], "2026-11-03");
  assert.deepEqual(weeks.map((w) => w.start), ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  assert.deepEqual(weeks[0].days.map((d) => d.steps), [null, 190, 31, null, null, null, null]);
  assert.equal(weeks[0].total, 221);
  assert.equal(weeks[0].recorded, 2);
  assert.equal(dailyAverage(weeks[0]), 111);
  assert.equal(weeks[1].recorded, 0);
  assert.equal(dailyAverage(weeks[1]), null);
  assert.deepEqual(groupByWeek([], "2026-10-15"), []);
  assert.equal(md("2026-10-05"), "10/5");
});
