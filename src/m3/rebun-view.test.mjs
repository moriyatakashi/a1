// ah-38(2026-10-19): m3 の「礼文の票」の分け方。握っている・回っている・最近済んだ、印が30分より古い作業中は stale
import { test } from "node:test";
import assert from "node:assert/strict";
import { ahCounts, ahGroup, ahHeld, clipBody, rebunView, sortGoals, takashiView } from "./af-store.js";

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

// ah-41: 保留は礼文の票にも3つの数にも出さず、保留の区画に。見直す日(日本の日付)を過ぎたら late
test("ahHeld: 保留は数えず礼文の票にも出さない。見直す日を過ぎたものは late", () => {
  const H = [
    { seq: 18, title: "睡眠", state: "保留", owner: "rebun", next: "", holdUntil: "af-48 で決まったら", holdReview: "2026-11-02" },
    { seq: 2, title: "古い保留", state: "保留", owner: "rebun", next: "", holdUntil: "x", holdReview: "2026-10-18" },
    { seq: 3, title: "今日が見直す日", state: "保留", owner: "rebun", next: "", holdUntil: "x", holdReview: "2026-10-19" },
    { seq: 4, state: "渡し先待ち", owner: "rebun", next: "takashi" },
  ];
  assert.deepEqual(ahCounts(H, NOW), { "たかしさん待ち": 1, "窓を開けば進む": 0, "礼文が進めている": 0 });
  assert.deepEqual(rebunView(H, NOW).assigned.map((t) => t.seq), [4]);
  assert.deepEqual(ahHeld(H, NOW).map((t) => [t.seq, t.late]), [[2, true], [3, false], [18, false]]);
});

// ah-44: Takashi の番。次が Takashi の票が4件以上ならそれだけ、3件以下なら全 aX の未決から古い順に足して4件(ag は入れない)
test("takashiView: 次が Takashi の票が4件以上なら足さない", () => {
  const A = [1, 2, 3, 4, 5].map((seq) => ({ seq, state: "渡し先待ち", owner: "rebun", next: "takashi", createdAt: at(seq) }));
  const open = { ab: [{ seq: 1, by: "claude-mobile", done: false, createdAt: at(9999) }] };
  assert.deepEqual(takashiView(A, open, NOW).map((t) => [t.key, !!t.fill]), [1, 2, 3, 4, 5].map((s) => [`ah-${s}`, false]));
});

test("takashiView: 3件以下なら ab・ac・af・ah の未決から古い順に足して4件。済・done・保留は足さない", () => {
  const A = [
    { seq: 4, state: "渡し先待ち", owner: "rebun", next: "takashi", createdAt: at(10) },
    { seq: 6, state: "待ち", owner: "suma", next: "rebun", createdAt: at(500) },
    { seq: 7, state: "済", owner: "rebun", next: "", createdAt: at(9000) },
    { seq: 8, state: "保留", owner: "rebun", next: "", createdAt: at(9000) },
  ];
  const open = {
    ab: [{ seq: 3, by: "claude-pc", done: false, createdAt: at(800) }, { seq: 2, by: "claude-pc", done: true, createdAt: at(9000) }],
    ac: [{ seq: 25, by: "claude-pc", done: false, createdAt: at(700) }],
    af: [{ seq: 9, by: "takashi", done: false, createdAt: at(100) }],
  };
  const v = takashiView(A, open, NOW);
  assert.deepEqual(v.map((t) => [t.key, !!t.fill]), [["ah-4", false], ["ab-3", true], ["ac-25", true], ["ah-6", true]]);
  assert.equal(v[1].who, "claude-pc");
  assert.equal(takashiView(A, {}, NOW).length, 2); // ab・ac・af が読めなければ ah の分だけ
});

// 目標(ae、b1 af-25): 期限の近い順、期限なしは後ろ、同じ期限は番号順
test("sortGoals は期限の近い順で、期限なしは後ろ", () => {
  const ts = [{ seq: 4 }, { seq: 3, dueDate: "2026-12-31" }, { seq: 2, dueDate: "2026-11-01" }, { seq: 1, dueDate: "2026-12-31" }];
  assert.deepEqual(sortGoals(ts).map((t) => t.seq), [2, 1, 3, 4]);
});

// b1 ah-52: 一覧の本文は先頭3行か200字の短いほう。短ければ切らない
test("clipBody は3行か200字の短いほうで切り、続きがあれば cut", () => {
  assert.deepEqual(clipBody("a\nb\nc\nd"), { short: "a\nb\nc", cut: true });
  assert.deepEqual(clipBody("x".repeat(250)), { short: "x".repeat(200), cut: true });
  assert.deepEqual(clipBody("a\nb\nc"), { short: "a\nb\nc", cut: false });
  assert.deepEqual(clipBody(""), { short: "", cut: false });
});