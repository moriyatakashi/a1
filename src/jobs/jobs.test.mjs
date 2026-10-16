// 処理の様子(2026-10-17)。いまの状態の決め方・トップに出すもの・「見た」・記録の読み替えを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, evaluate, alerts, alertKey, hasUnseen, fromWorkflowRuns, fromSteps, fromJobDoc, jst } from "./jobs.js";

const NOW = Date.parse("2026-10-17T12:00:00+09:00");
const daily = { everyHours: 24 };
const ago = (h) => new Date(NOW - h * 3600000).toISOString();

test("いまの状態: 成功の時刻と失敗の時刻から決める", () => {
  const cases = [
    [{ okAt: ago(9) }, "ok"],
    [{ okAt: ago(29) }, "ok"], // 24時間+遅れてよい6時間まで
    [{ okAt: ago(31) }, "late"], // 電池切れなどで来ていない
    [{ okAt: ago(30), ngAt: ago(9), note: "x" }, "ng"],
    [{ okAt: ago(9), ngAt: ago(30) }, "ok"], // 失敗のあと直った
    [{ ngAt: ago(9) }, "ng"],
    [{ okAt: null, ngAt: null }, "none"],
    [{ error: "permission-denied" }, "unknown"],
    [undefined, "unknown"],
  ];
  for (const [rec, want] of cases) assert.equal(judge(daily, rec, NOW).state, want, JSON.stringify(rec));
  assert.equal(judge({ everyHours: 168 }, { okAt: ago(100) }, NOW).state, "ok"); // 週1回
});

test("トップに出すのは 失敗・来ていない だけ。「見た」は同じ失敗のあいだだけ効く", () => {
  const checks = [{ id: "a", everyHours: 24 }, { id: "b", everyHours: 24 }, { id: "c", everyHours: 24 }, { id: "d", everyHours: 24 }];
  const items = evaluate({ a: { okAt: ago(1) }, b: { okAt: ago(2), ngAt: ago(1) }, c: { okAt: ago(40) }, d: {} }, NOW, checks);
  const list = alerts(items);
  assert.deepEqual(list.map((i) => i.id), ["b", "c"]);
  const seen = list.map(alertKey);
  assert.equal(hasUnseen(list, seen), false);
  // b がまた失敗した(時刻が変わった)→ また出る
  const again = alerts(evaluate({ b: { okAt: ago(2), ngAt: ago(0.5) }, c: { okAt: ago(40) } }, NOW, checks));
  assert.equal(hasUnseen(again, seen), true);
  assert.equal(hasUnseen([], seen), false);
});

test("GitHub の実行結果: 最後の成功と、最後の実行が失敗ならその時刻", () => {
  const run = (conclusion, at, status = "completed") => ({ conclusion, status, updated_at: at, html_url: "u" });
  assert.deepEqual(fromWorkflowRuns([run("success", "t2"), run("failure", "t1")]), { okAt: "t2", ngAt: null, note: "" });
  assert.deepEqual(fromWorkflowRuns([run(null, "t3", "in_progress"), run("failure", "t2"), run("success", "t1")]),
    { okAt: "t1", ngAt: "t2", note: "failure(u)" });
  assert.deepEqual(fromWorkflowRuns([]), { okAt: null, ngAt: null, note: "" });
});

test("歩数は at のいちばん新しいもの、jobStatus はそのまま", () => {
  assert.deepEqual(fromSteps([{ at: "2026-10-13T14:50" }, { at: "2026-10-14T14:50" }, {}, null]), { okAt: "2026-10-14T14:50", ngAt: null });
  assert.deepEqual(fromSteps([]), { okAt: null, ngAt: null });
  assert.deepEqual(fromJobDoc({ okAt: "a", ngAt: "b", ngNote: "n" }), { okAt: "a", ngAt: "b", note: "n" });
  assert.deepEqual(fromJobDoc(undefined), { okAt: null, ngAt: null, note: "" });
  assert.equal(jst("2026-10-16T18:02:00Z"), "10/17 03:02");
  assert.equal(jst(null), "—");
});
