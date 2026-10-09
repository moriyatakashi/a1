// ab-155: ba 画面の件数は、一覧に出るスレッドだけで数える(はぐれた・void されたものは hidden)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { summaryCounts } from "./thread-logic.js";

test("隠れたスレッドは件数に入れず hidden に数える", () => {
  const threads = [
    { status: "open", hiddenVoid: false },
    { status: "closed", hiddenVoid: false },
    { status: "closed", hiddenVoid: false },
    { status: "open", hiddenVoid: true },
    { status: "open", hiddenVoid: true },
  ];
  assert.deepEqual(summaryCounts(threads), { total: 3, open: 1, closed: 2, hidden: 2 });
});

test("全部隠れていれば 0 オープン(「9 オープンなのに一覧が空」にならない)", () => {
  const threads = Array.from({ length: 9 }, () => ({ status: "open", hiddenVoid: true }));
  assert.deepEqual(summaryCounts(threads), { total: 0, open: 0, closed: 0, hidden: 9 });
});
