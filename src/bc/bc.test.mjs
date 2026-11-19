import test from "node:test";
import assert from "node:assert/strict";
import { gates, kidColor, gateColor, parseMorning, parseJudge, morning } from "./bc.js";

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

const M20 = "【朝の課題】2026-11-20（発生日 11/20、判定 11/21 朝）\na チラ裏のミニロレキ → 有田 Sb5tDk7p65mxb2h9W2yF\nb 倒れた朝礼の束を拾う → 筑波 xfOmRHlepGWxmHOVNCy0\nc ah-167 の照合 → 有田 Sb5tDk7p65mxb2h9W2yF\n判定: 翌朝すまが付ける";

test("朝の課題は a・b・c と発生日・振り先を読む。1行でも欠けたら null", () => {
  const p = parseMorning(M20);
  assert.equal(p.date, "2026-11-20");
  assert.equal(p.origin, "11/20");
  assert.equal(p.judgeOn, "11/21");
  assert.deepEqual(p.items.map((i) => [i.letter, i.to]), [["a", "有田"], ["b", "筑波"], ["c", "有田"]]);
  assert.equal(p.items[0].title, "チラ裏のミニロレキ");
  assert.equal(parseMorning(M20.replace(/\nb [^\n]*/, "")), null);
  assert.equal(parseMorning("朝の課題 2026-11-20"), null);
});

test("判定は できた／できない と一言、n/3 は できた の数", () => {
  const j = parseJudge("【課題の判定】2026-11-20 a できた（年表4行）/ b できない（束が見つからず）/ c できた ＝ 2/3。頼み方の見立て: 短く");
  assert.equal(j.date, "2026-11-20");
  assert.equal(j.n, 2);
  assert.deepEqual(j.verdicts.b, { ok: false, word: "束が見つからず" });
  assert.deepEqual(j.verdicts.c, { ok: true, word: "" });
  assert.equal(parseJudge("【課題の判定】2026-11-20 a できた / b できた"), null);
  const k = parseJudge("【課題の判定】2026-11-20 a できない（11/21 に回す）／ b できた ／ c できた ＝ 2/3");
  assert.equal(k.n, 2);
  assert.equal(k.verdicts.a.word, "11/21 に回す");
});

test("いちばん新しい朝の課題に判定を重ね、直近7日を n/3 で並べる", () => {
  const notes = [
    { body: M20.replace(/2026-11-20/, "2026-11-12"), createdAt: "2026-11-12T00:00:00Z" },
    { body: M20.replace(/2026-11-20/, "2026-11-18"), createdAt: "2026-11-18T00:00:00Z" },
    { body: "【課題の判定】2026-11-19 a できた / b できた / c できない（止まった）＝ 2/3", createdAt: "2026-11-19T00:00:00Z" },
    { body: M20, createdAt: "2026-11-20T00:00:00Z" },
    { body: "ほかの note", createdAt: "2026-11-20T01:00:00Z" },
  ];
  const out = morning(notes, "2026-11-20");
  assert.equal(out.unreadable, false);
  assert.equal(out.latest.date, "2026-11-20");
  assert.equal(out.latest.n, null);
  assert.equal(out.latest.items[0].verdict, null);
  assert.deepEqual(out.days, [{ date: "2026-11-18", n: 2 }, { date: "2026-11-20", n: null }]);
  const judged = morning([...notes, { body: "【課題の判定】2026-11-20 a できた / b できない（一言）/ c できた ＝ 2/3", createdAt: "2026-11-21T00:00:00Z" }], "2026-11-21");
  assert.equal(judged.latest.n, 2);
  assert.deepEqual(judged.latest.items[1].verdict, { ok: false, word: "一言" });
});

test("いちばん新しい朝の課題が崩れていれば読めず。朝の課題が無ければ空", () => {
  const out = morning([{ body: M20, createdAt: "1" }, { body: "【朝の課題】2026-11-21\na だけ → 有田", createdAt: "2" }], "2026-11-21");
  assert.equal(out.unreadable, true);
  assert.equal(out.latest, null);
  assert.deepEqual(morning([], "2026-11-21"), { latest: null, unreadable: false, days: [] });
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
