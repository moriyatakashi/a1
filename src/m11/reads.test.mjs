// m11 どこまで読んだ(b1 ah-47)。作品ごとの最新・前回の場所・保存する形を確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { latestByTitle, lastPlace, clampNum, makeRead, md } from "./reads.js";

const rows = [
  { title: "A", vol: 1, ch: 3, place: "銭湯", date: "2026-10-20", createdAt: "2026-10-20T10:00:00Z" },
  { title: "B", vol: 5, ch: 40, date: "2026-10-21", createdAt: "2026-10-21T10:00:00Z" },
  { title: "A", vol: 2, ch: 9, place: "家", date: "2026-10-19", createdAt: "2026-10-19T10:00:00Z" },
  { title: "", vol: 1, ch: 1, createdAt: "2026-10-22T00:00:00Z" },
];

test("作品ごとに一番新しい1件を、新しい順に", () => {
  const got = latestByTitle(rows);
  assert.deepEqual(got.map((r) => [r.title, r.vol, r.ch]), [["B", 5, 40], ["A", 1, 3]]);
  assert.deepEqual(latestByTitle([]), []);
});

test("前回の場所は場所のある一番新しい件", () => {
  assert.equal(lastPlace(rows), "銭湯");
  assert.equal(lastPlace([]), "");
});

test("巻・話は 0〜9999 の整数", () => {
  assert.equal(clampNum("12"), 12);
  assert.equal(clampNum(3.7), 3);
  assert.equal(clampNum(-1), 0);
  assert.equal(clampNum("x"), 0);
  assert.equal(clampNum(123456), 9999);
});

test("保存する形は Rules のキーだけ・日付は JST", () => {
  const r = makeRead({ title: " 作品 ", vol: "2", ch: 10, place: "" }, new Date("2026-10-21T16:00:00Z"));
  assert.deepEqual(r, { title: "作品", vol: 2, ch: 10, date: "2026-10-22", createdAt: "2026-10-21T16:00:00.000Z", by: "takashi" });
  assert.equal(makeRead({ title: "あ", vol: 1, ch: 1, place: "銭湯" }).place, "銭湯");
  assert.equal(makeRead({ title: "  ", vol: 1, ch: 1 }), null);
  assert.equal(makeRead({ title: "x".repeat(61), vol: 1, ch: 1 }), null);
  assert.equal(md("2026-10-05"), "10/5");
  assert.equal(md(""), "");
});
