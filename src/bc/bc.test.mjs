import test from "node:test";
import assert from "node:assert/strict";
import { gates, kidColor, gateColor } from "./bc.js";

const bc = (seq, title = `関門${seq}`) => ({ seq, title });

test("子の色は期日超えが赤、3日以内がオレンジ、期日なしは色なし", () => {
  assert.equal(kidColor("2026-11-07", "2026-11-08"), "red");
  assert.equal(kidColor("2026-11-11", "2026-11-08"), "orange");
  assert.equal(kidColor("2026-11-12", "2026-11-08"), "");
  assert.equal(kidColor("", "2026-11-08"), "");
});

test("枠の色は赤が勝ち、オレンジだけならオレンジ、0件は薄く", () => {
  assert.equal(gateColor([{ color: "orange" }, { color: "red" }]), "red");
  assert.equal(gateColor([{ color: "orange" }, { color: "" }]), "orange");
  assert.equal(gateColor([{ color: "" }]), "");
  assert.equal(gateColor([]), "faint");
});

test("related の bc-n で子をつなぐ。どこも指していない ae だけ、もろもろに出す", () => {
  const out = gates([bc(2), bc(1), bc(7, "もろもろ")], {
    ah: [{ seq: 143, title: "票", related: ["BC-2", "af-1"] }, { seq: 9, title: "どこでもない票" }],
    af: [{ seq: 98, title: "メモ", related: ["bc-1"] }],
    ae: [{ seq: 9, title: "冬服", dueDate: "2026-11-01" }, { seq: 25, title: "的", related: ["bc-2"] }],
  }, "2026-11-08");
  assert.deepEqual(out.map((g) => g.seq), [7, 2, 1]);
  assert.deepEqual(out.map((g) => g.kids.map((k) => k.key)), [["ae-9"], ["ae-25", "ah-143"], ["af-98"]]);
  assert.equal(out[0].color, "red");
  assert.equal(out[2].color, "");
});

test("無い bc を指していても落ちない。bc が無ければ空", () => {
  assert.deepEqual(gates([], { ae: [{ seq: 1 }] }, "2026-11-08"), []);
  const out = gates([bc(1)], { ah: [{ seq: 1, related: ["bc-99"] }] }, "2026-11-08");
  assert.equal(out[0].color, "faint");
});

test("並びは期日の色が強く、同じ色なら子の多い順、そのあと番号順", () => {
  const out = gates([bc(1), bc(2), bc(3), bc(4), bc(5)], {
    ah: [{ seq: 1, related: ["bc-1"] }, { seq: 2, related: ["bc-1"] }, { seq: 3, related: ["bc-1"] },
      { seq: 4, related: ["bc-2"], dueDate: "2026-11-10" },
      { seq: 5, related: ["bc-3"], dueDate: "2026-11-01" },
      { seq: 6, related: ["bc-4"] }, { seq: 7, related: ["bc-4"], dueDate: "2026-11-09" }],
  }, "2026-11-08");
  assert.deepEqual(out.map((g) => [g.seq, g.color]), [[3, "red"], [4, "orange"], [2, "orange"], [1, ""], [5, "faint"]]);
});
