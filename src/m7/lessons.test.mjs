// m7 の例題(lessons.js)が、解釈系で動かした結果と正解で合っているか。解説の行番号がコードの中にあるか。
import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "./cobol.js";
import { LESSONS, joinOutput } from "./lessons.js";

for (const l of LESSONS) {
  test(`例題 ${l.id}: 動かした出力が正解の選択肢と同じ`, () => {
    const r = run(l.code.join("\n"), { input: l.input || [] });
    assert.equal(r.error, null);
    assert.equal(joinOutput(r.output), l.choices[l.answer]);
  });
  test(`例題 ${l.id}: 選択肢は4つでかぶらない、解説の行はコードの中`, () => {
    assert.equal(l.choices.length, 4);
    assert.equal(new Set(l.choices).size, 4);
    for (const [n] of l.lines) assert.ok(n >= 1 && n <= l.code.length, `${n}行目`);
    for (const line of l.code) assert.ok(line.length <= 72, "72桁をこえている: " + line);
  });
}
