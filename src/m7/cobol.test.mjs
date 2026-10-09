// m7 の小さな COBOL 解釈系(cobol.js)のテスト。node --test で流れる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, parsePic } from "./cobol.js";

const prog = (ws, proc) => `       IDENTIFICATION DIVISION.
       PROGRAM-ID. T.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
${ws.map((l) => "       " + l).join("\n")}
       PROCEDURE DIVISION.
${proc.map((l) => "           " + l).join("\n")}
           STOP RUN.
`;
const out = (ws, proc, input) => {
  const r = run(prog(ws, proc), { input });
  assert.equal(r.error, null);
  return r.output;
};

test("PIC: 9(n)・X(n)・V・S を読む", () => {
  assert.deepEqual(parsePic("9(3)"), { kind: "9", signed: false, int: 3, dec: 0 });
  assert.deepEqual(parsePic("S9(3)V99"), { kind: "9", signed: true, int: 3, dec: 2 });
  assert.deepEqual(parsePic("X(5)"), { kind: "X", len: 5 });
});

test("DISPLAY: 文字と項目をつなげて1行", () => {
  assert.deepEqual(out(["01 WS-NAME PIC X(5) VALUE \"TARO\"."], ['DISPLAY "HELLO, " WS-NAME "!".']), ["HELLO, TARO !"]);
});

test("MOVE: 文字は左詰めで右を空白、数は左を0埋め、あふれた上の桁は落ちる", () => {
  const ws = ["01 A PIC X(3).", "01 N PIC 9(3)."];
  assert.deepEqual(out(ws, ['MOVE "ABCDE" TO A.', 'DISPLAY "[" A "]".', "MOVE 7 TO N.", "DISPLAY N.", "MOVE 12345 TO N.", "DISPLAY N."]),
    ["[ABC]", "007", "345"]);
  assert.deepEqual(out(ws, ['MOVE "Z" TO A.', 'DISPLAY "[" A "]".']), ["[Z  ]"]);
});

test("計算: ADD/SUBTRACT/MULTIPLY/DIVIDE と GIVING、COMPUTE はかっこも", () => {
  const ws = ["01 A PIC 9(3) VALUE 10.", "01 B PIC 9(3) VALUE 3.", "01 C PIC 9(3)."];
  assert.deepEqual(out(ws, [
    "ADD 5 TO A.", "DISPLAY A.",                 // 15
    "SUBTRACT B FROM A.", "DISPLAY A.",          // 12
    "MULTIPLY 2 BY A.", "DISPLAY A.",            // 24
    "DIVIDE B INTO A.", "DISPLAY A.",            // 8
    "DIVIDE A BY B GIVING C.", "DISPLAY C.",     // 2(切り捨て)
    "ADD A B GIVING C.", "DISPLAY C.",           // 11
    "COMPUTE C = (A + 2) * B - 1.", "DISPLAY C.", // 29
  ]), ["015", "012", "024", "008", "002", "011", "029"]);
});

test("V は見えない小数点、S は頭に符号", () => {
  const ws = ["01 P PIC 9(3)V99.", "01 S PIC S9(3)."];
  assert.deepEqual(out(ws, ["COMPUTE P = 10 / 4.", "DISPLAY P.", "COMPUTE S = 3 - 8.", "DISPLAY S."]), ["00250", "-005"]);
});

test("IF/ELSE/END-IF と AND・OR・NOT、GREATER THAN の言い方", () => {
  const ws = ["01 N PIC 9(3) VALUE 70."];
  const proc = (n) => [`MOVE ${n} TO N.`,
    'IF N >= 60 AND N NOT = 100', '   DISPLAY "PASS"', "ELSE", '   DISPLAY "FAIL"', "END-IF.",
    'IF N IS GREATER THAN 90 OR N < 10 DISPLAY "EDGE" END-IF.'];
  assert.deepEqual(out(ws, proc(70)), ["PASS"]);
  assert.deepEqual(out(ws, proc(5)), ["FAIL", "EDGE"]);
  assert.deepEqual(out(ws, proc(100)), ["FAIL", "EDGE"]);
});

test("PERFORM n TIMES と PERFORM VARYING … UNTIL", () => {
  const ws = ["01 I PIC 9(2).", "01 T PIC 9(3) VALUE 0."];
  assert.deepEqual(out(ws, ["PERFORM 3 TIMES", '  DISPLAY "HI"', "END-PERFORM."]), ["HI", "HI", "HI"]);
  assert.deepEqual(out(ws, ["PERFORM VARYING I FROM 1 BY 1 UNTIL I > 4", "  ADD I TO T", "END-PERFORM.", "DISPLAY T."]), ["010"]);
});

test("ACCEPT は入力を1行ずつ読む", () => {
  const ws = ["01 NAME PIC X(10).", "01 AGE PIC 9(3)."];
  assert.deepEqual(out(ws, ["ACCEPT NAME.", "ACCEPT AGE.", 'DISPLAY NAME "/" AGE.'], ["HANAKO", "42"]), ["HANAKO    /042"]);
  assert.match(run(prog(ws, ["ACCEPT NAME."]), { input: [] }).error, /^\d+行目: ACCEPT で読む入力がもう無い/);
});

test("STOP RUN で止まり、そのあとは動かない。7桁目の * は注釈", () => {
  const src = `       PROCEDURE DIVISION.
      * ここは注釈
           DISPLAY "A".
           STOP RUN.
           DISPLAY "B".
`;
  assert.deepEqual(run(src).output, ["A"]);
});

test("まちがいは行番号つきで止まる(知らない語・知らない項目・0で割る・終わらない繰り返し)", () => {
  assert.match(run(prog([], ['EVALUATE TRUE.'])).error, /^7行目: 「EVALUATE」はまだ使えない語/);
  assert.match(run(prog([], ["MOVE 1 TO NOPE."])).error, /「NOPE」という項目は WORKING-STORAGE に無い/);
  assert.match(run(prog(["01 A PIC 9 VALUE 0."], ["COMPUTE A = 1 / A."])).error, /0 で割ろうとした/);
  assert.match(run(prog(["01 A PIC 9 VALUE 0."], ["PERFORM UNTIL A > 5", "  CONTINUE", "END-PERFORM."])).error, /繰り返しが終わらない/);
  assert.match(run(prog([], ['DISPLAY "ABC.'])).error, /文字列の終わり/);
});
