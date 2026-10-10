// ab-166 ③(2026-10-10 すま): 週の得点をページ側で数える式(common/week-score.js)。Azure の bp_weekly.py と同じ。
// 移すときに、実データの8週(W30〜W41)で Azure の答えと全部一致するのを確かめた。ここでは式の要点を見る。
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekBounds, ruleAt, baCloseEvents, weekScore } from "../src/common/week-score.js";

test("weekBounds: ISO 週の月曜と、日本時間の月曜0時から7日", () => {
  const b = weekBounds("2026-W41");
  assert.equal(b.monday, "2026-10-05");
  assert.equal(new Date(b.startMs).toISOString(), "2026-10-04T15:00:00.000Z");
  assert.equal(weekBounds("2026-W01").monday, "2025-12-29");
  assert.equal(weekBounds("2027-W01").monday, "2027-01-04");
});

test("ruleAt: その週の月曜に効いていた版。版が無ければ既定", () => {
  const rules = [{ effectiveFrom: "2026-08-01", difficultyPoints: { low: 1, normal: 3, high: 6 } },
                 { effectiveFrom: "2026-10-01", difficultyPoints: { low: 2, normal: 4, high: 8 } }];
  assert.deepEqual(ruleAt(rules, "2026-07-31"), { low: 2, normal: 5, high: 10 });
  assert.equal(ruleAt(rules, "2026-09-07").normal, 3);
  assert.equal(ruleAt(rules, "2026-10-05").normal, 4);
});

test("baCloseEvents: 開→閉の瞬間だけ。続けて閉じたのは1回、取り消したスレッドは数えない、難易度は親から", () => {
  const e = [
    { type: "new", id: "t1", threadId: "t1", difficulty: "high" },
    { type: "status", threadId: "t1", status: "closed", createdAt: "2026-10-06T01:00:00Z" },
    { type: "status", threadId: "t1", status: "closed", createdAt: "2026-10-06T02:00:00Z" },
    { type: "status", threadId: "t1", status: "open", createdAt: "2026-10-07T00:00:00Z" },
    { type: "status", threadId: "t1", status: "closed", createdAt: "2026-10-08T00:00:00Z" },
    { type: "new", id: "t2", threadId: "t2" },
    { type: "status", threadId: "t2", status: "closed", createdAt: "2026-10-06T00:00:00Z" },
    { type: "void", threadId: "t2", ref: "t2" },
    { type: "status", threadId: "t3", status: "closed", createdAt: "2026-10-06T00:00:00Z" },
  ];
  const c = baCloseEvents(e);
  assert.equal(c.length, 3);
  assert.equal(c.filter((x) => x.difficulty === "high").length, 2);
  assert.equal(c.filter((x) => x.difficulty === "normal").length, 1);
});

test("weekScore: 毎日スコア + 閉じた点 + 加点。週の境目は日本時間", () => {
  const r = weekScore("2026-W41", {
    scores: { "2026-10-04": 99, "2026-10-05": 80, "2026-10-11": 70, "2026-10-12": 99 },
    pointEvents: [{ createdAt: "2026-10-04T15:00:00Z", points: 5 }, { createdAt: "2026-10-04T14:59:59Z", points: 100 }],
    rules: [],
    closes: [{ at: "2026-10-06T00:00:00Z", difficulty: "high" }, { at: "2026-10-11T15:00:00Z", difficulty: "low" }],
  });
  assert.equal(r.dailyScoreSum, 150);
  assert.equal(r.closeCount, 1);
  assert.equal(r.closeValue, 10);
  assert.equal(r.pointEventSum, 5);
  assert.equal(r.weekScore, 165);
  assert.equal(r.weekStart, "2026-10-05");
  assert.equal(r.weekEnd, "2026-10-11");
});
