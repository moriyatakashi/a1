// 家の枠の横棒(b1 ah-190)。家ごとにいちばん新しい日の割合を出す・割合の無いものは出さない・文字は逃がす。
import { test } from "node:test";
import assert from "node:assert/strict";
import { latestByHouse, renderRows } from "./house-limits.js";

test("家ごとにいちばん新しい日の1件、割合の無いもの・知らない家は外す", () => {
  const rows = latestByHouse([
    { house: "oi", date: "2026-11-16", usedPercent: 4 },
    { house: "oi", date: "2026-11-17", usedPercent: 5, window: "30日", resetsAt: "2026-12-08 00:10" },
    { house: "ando", date: "2026-11-17", amount: 100, unit: "tokens" },
    { house: "iroha", date: "2026-11-17", usedPercent: 1 },
  ]);
  assert.deepEqual(rows.map((d) => [d.house, d.date]), [["oi", "2026-11-17"]]);
});

test("横棒の長さは割合、横に枠と戻る日", () => {
  const html = renderRows([{ house: "oi", date: "2026-11-17", usedPercent: 5, window: "30日", resetsAt: "2026-12-08 00:10" }]);
  assert.match(html, /大井家/);
  assert.match(html, /width:5%/);
  assert.match(html, /30日の枠・2026-12-08 00:10 に戻る・2026-11-17 時点/);
});

test("100 を超えても棒ははみ出さない、文字は逃がす", () => {
  const html = renderRows([{ house: "oi", date: "2026-11-17", usedPercent: 130, window: "<b>" }]);
  assert.match(html, /width:100%/);
  assert.match(html, /&lt;b&gt;の枠/);
});
