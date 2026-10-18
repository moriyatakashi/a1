// ah-38(2026-10-19): m3 の「礼文の票」の分け方。握っている・回っている・最近済んだ、印が30分より古い作業中は stale
import { test } from "node:test";
import assert from "node:assert/strict";
import { ahCounts, ahGroup, rebunView } from "./af-store.js";

const NOW = Date.parse("2026-10-19T00:00:00.000Z");
const at = (min) => new Date(NOW - min * 60000).toISOString();
const T = [
  { seq: 1, title: "握って動いている", state: "作業中", holder: "rebun", owner: "rebun", next: "rebun", claimedAt: at(20), beatAt: at(5) },
  { seq: 2, title: "印が古い", state: "作業中", holder: "rebun", owner: "suma", next: "rebun", claimedAt: at(90), beatAt: at(45) },
  { seq: 3, title: "礼文待ち", state: "待ち", holder: "", owner: "suma", next: "rebun" },
  { seq: 4, title: "Takashi 待ち", state: "渡し先待ち", holder: "", owner: "rebun", next: "takashi" },
  { seq: 5, title: "すまに回した", state: "渡し先待ち", holder: "", owner: "rebun", next: "suma" },
  { seq: 6, title: "利尻が握っている", state: "作業中", holder: "rishiri", owner: "rishiri", next: "rishiri", beatAt: at(1) },
  { seq: 7, title: "古い済", state: "済", owner: "rebun", noteMeta: [{ createdAt: at(300) }] },
  { seq: 8, title: "新しい済", state: "済", owner: "rebun", noteMeta: [{ createdAt: at(600) }, { createdAt: at(10) }] },
  { seq: 9, title: "すまの済", state: "済", owner: "suma", noteMeta: [{ createdAt: at(1) }] },
];

test("rebunView: 握っている票は礼文が holder の作業中だけ。印が30分より古いと stale", () => {
  const { holding } = rebunView(T, NOW);
  assert.deepEqual(holding.map((t) => [t.seq, t.claimedMin, t.beatMin, t.stale]), [[1, 20, 5, false], [2, 90, 45, true]]);
});

test("rebunView: 回っている票は次が礼文、または持ち主が礼文で次が Takashi のもの", () => {
  assert.deepEqual(rebunView(T, NOW).assigned.map((t) => t.seq), [3, 4]);
});

test("rebunView: 最近済んだ票は持ち主が礼文の済を、最後の note の新しい順に", () => {
  const { done } = rebunView(T, NOW);
  assert.deepEqual(done.map((t) => t.seq), [8, 7]);
  assert.equal(done[0].doneAt, at(10));
  assert.equal(rebunView(T, NOW, 1).done.length, 1);
});

// ah-37: 3つの数(b1 の run_lock.group と同じ分け方)
test("ahCounts: 次が Takashi / 利尻・すま / それ以外に分け、落ちた票は持ち主の分、済は数えない", () => {
  const U = [
    { seq: 1, state: "渡し先待ち", owner: "rebun", next: "takashi" },
    { seq: 2, state: "待ち", owner: "suma", next: "suma" },
    { seq: 3, state: "作業中", owner: "rishiri", next: "rishiri", holder: "rishiri", beatAt: at(5) },
    { seq: 4, state: "待ち", owner: "rebun", next: "rebun" },
    { seq: 5, state: "作業中", owner: "suma", next: "rebun", holder: "rebun", beatAt: at(180) },
    { seq: 6, state: "済", owner: "rebun", next: "" },
  ];
  assert.deepEqual(ahCounts(U, NOW), { "たかしさん待ち": 1, "窓を開けば進む": 3, "礼文が進めている": 1 });
  assert.equal(ahGroup(U[4], NOW), "窓を開けば進む");
});
