// cobol.js — m7 の COBOL 学習ページで例題を動かす、小さな COBOL 解釈系(ab-147、2026-10-09 礼文)。
// GnuCOBOL を WASM で載せるのではなく、例題に要る構文だけを1つずつ足していく(すまの推し・Takashi「すすめて」、2026-08-06)。
// 分かること:
//   ・固定形式: 1〜6桁目は番号、7桁目が * の行は注釈、8桁目から。6桁目までが空白か数字でない行は、そのまま読む(気楽に書けるように)
//   ・DATA DIVISION の WORKING-STORAGE SECTION: 01/05/77 の項目、PIC 9(n) / X(n) / 9(n)V9(m) / S9(n)、VALUE
//   ・PROCEDURE DIVISION: DISPLAY・ACCEPT・MOVE・COMPUTE・ADD・SUBTRACT・MULTIPLY・DIVIDE(GIVING も)・
//     IF/ELSE/END-IF・PERFORM n TIMES・PERFORM VARYING … UNTIL・STOP RUN
// 分からない語は「まだ使えない語」として行番号つきで止まる。run(source, { input }) は { output: [行], error } を返し、例外は投げない。

const KEYWORDS_END = new Set(["ELSE", "END-IF", "END-PERFORM"]);

class CobolError extends Error {
  constructor(message, line) { super(message); this.line = line; }
}

// ---- 字句 ----
function sourceLines(source) {
  return String(source).replace(/\t/g, "    ").split(/\r?\n/).map((raw, i) => {
    let text = raw;
    if (raw.length >= 7 && /^[\d ]{6}$/.test(raw.slice(0, 6))) {
      if (raw[6] === "*" || raw[6] === "/") return { line: i + 1, text: "" };
      text = raw.slice(7, 72);
    } else if (/^\s*\*>/.test(raw)) {
      return { line: i + 1, text: "" };
    }
    return { line: i + 1, text: text.replace(/\*>.*$/, "") };
  });
}

function tokenize(source) {
  const out = [];
  for (const { line, text } of sourceLines(source)) {
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (/\s/.test(c) || c === ",") { i++; continue; }
      if (c === '"' || c === "'") {
        const j = text.indexOf(c, i + 1);
        if (j < 0) throw new CobolError("文字列の終わりの " + c + " がない", line);
        out.push({ t: "str", v: text.slice(i + 1, j), line });
        i = j + 1; continue;
      }
      const two = text.slice(i, i + 2);
      if (two === ">=" || two === "<=") { out.push({ t: "op", v: two, line }); i += 2; continue; }
      if ("()+*/=<>".includes(c) || (c === "-" && !/[A-Za-z0-9]/.test(text[i - 1] || ""))) {
        // 数字の前の - は数の符号(「-5」)、それ以外は引き算
        if (c === "-" && /\d/.test(text[i + 1] || "") && !/[\w)]/.test(lastSignificant(out, line))) {
          const m = /^-\d+(\.\d+)?/.exec(text.slice(i));
          out.push({ t: "num", v: m[0], line }); i += m[0].length; continue;
        }
        out.push({ t: "op", v: c, line }); i++; continue;
      }
      if (c === ".") {
        if (/\d/.test(text[i + 1] || "") && /[\s(]/.test(text[i - 1] || " ")) { // .5 のような数
          const m = /^\.\d+/.exec(text.slice(i));
          out.push({ t: "num", v: "0" + m[0], line }); i += m[0].length; continue;
        }
        out.push({ t: "dot", v: ".", line }); i++; continue;
      }
      const m = /^[A-Za-z0-9][A-Za-z0-9-]*(\([0-9]+\))?([A-Za-z0-9-]*(\([0-9]+\))?)*/.exec(text.slice(i));
      if (!m) throw new CobolError(`読めない文字「${c}」`, line);
      let w = m[0];
      // 数(12 や 3.14)。小数点の後ろが数字なら小数点、そうでなければ文の終わりのピリオド
      if (/^\d+$/.test(w) && text[i + w.length] === "." && /\d/.test(text[i + w.length + 1] || "")) {
        const n = /^\d+\.\d+/.exec(text.slice(i))[0];
        out.push({ t: "num", v: n, line }); i += n.length; continue;
      }
      i += w.length;
      if (w.endsWith("-") && w.length > 1) { w = w.slice(0, -1); i--; } // 「A-」で切れたら - は引き算
      out.push(/^\d+$/.test(w) ? { t: "num", v: w, line } : { t: "word", v: w.toUpperCase(), line });
    }
  }
  return out;
}
function lastSignificant(out, line) {
  const p = out[out.length - 1];
  if (!p || p.line !== line) return "";
  return p.t === "op" ? p.v : "w";
}

// ---- 項目(PIC) ----
// PIC 9(3) → { kind: "9", int: 3, dec: 0, signed: false }、PIC X(5) → { kind: "X", len: 5 }
export function parsePic(pic, line) {
  const p = pic.toUpperCase().replace(/(.)\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n)));
  if (/^X+$/.test(p) || /^A+$/.test(p)) return { kind: "X", len: p.length };
  const m = /^(S?)(9+)(?:V(9+))?$/.exec(p);
  if (!m) throw new CobolError(`まだ使えない PIC「${pic}」(9 と X と V と S だけ)`, line);
  return { kind: "9", signed: m[1] === "S", int: m[2].length, dec: m[3] ? m[3].length : 0 };
}

// 数を PIC に入れる: 上の桁はあふれたら落とし(COBOL と同じく黙って切れる)、小数は切り捨て、符号が無ければ絶対値。
function fitNumber(n, pic) {
  let v = Number.isFinite(n) ? n : 0;
  if (!pic.signed) v = Math.abs(v);
  const scale = 10 ** pic.dec;
  let scaled = Math.trunc(Math.round(v * scale * 1e6) / 1e6);
  const mod = 10 ** (pic.int + pic.dec);
  scaled = scaled % mod;
  return scaled / scale;
}
function fitText(s, pic) {
  const t = String(s);
  return t.length >= pic.len ? t.slice(0, pic.len) : t + " ".repeat(pic.len - t.length);
}
// DISPLAY で見える形: 数字は PIC の桁ぶん0埋め(小数点は出さない、V は「見えない小数点」)。
// S の付いた項目は頭に + か - (GnuCOBOL の DISPLAY と同じ)。
export function showValue(item) {
  const { pic, value } = item;
  if (pic.kind === "X") return value;
  const digits = String(Math.round(Math.abs(value) * 10 ** pic.dec)).padStart(pic.int + pic.dec, "0");
  return (pic.signed ? (value < 0 ? "-" : "+") : "") + digits;
}

// ---- 構文 ----
class Parser {
  constructor(tokens) { this.toks = tokens; this.i = 0; }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  atWord(...ws) { const t = this.peek(); return !!t && t.t === "word" && ws.includes(t.v); }
  line() { const t = this.peek() || this.toks[this.toks.length - 1]; return t ? t.line : 0; }
  expectWord(w) {
    const t = this.next();
    if (!t || t.t !== "word" || t.v !== w) throw new CobolError(`ここには ${w} が来るはず${t ? `(「${t.v}」があった)` : "(行が終わった)"}`, t ? t.line : this.line());
  }
  skipDots() { while (this.peek() && this.peek().t === "dot") this.i++; }
}

function parseProgram(source) {
  const p = new Parser(tokenize(source));
  const items = new Map();
  const order = [];
  // PROCEDURE DIVISION までは DATA の項目だけ読む(IDENTIFICATION・ENVIRONMENT は読み飛ばす)
  let inWS = false;
  while (p.peek() && !(p.atWord("PROCEDURE") && p.peek(1)?.v === "DIVISION")) {
    const t = p.next();
    if (t.t === "word" && t.v === "WORKING-STORAGE") { inWS = true; continue; }
    if (t.t === "word" && (t.v === "DIVISION" || t.v === "SECTION")) continue;
    if (inWS && t.t === "num" && /^(01|05|10|77)$/.test(t.v.padStart(2, "0"))) {
      const name = p.next();
      if (!name || name.t !== "word") throw new CobolError("項目の番号のあとには名前が来るはず", t.line);
      let pic = null, value;
      while (p.peek() && p.peek().t !== "dot") {
        const w = p.next();
        if (w.t === "word" && (w.v === "PIC" || w.v === "PICTURE")) {
          if (p.atWord("IS")) p.next();
          const pt = p.next();
          if (!pt) throw new CobolError("PIC のあとに形(9(3) など)がない", w.line);
          // 「9(3)V9(2)」は1語、「S9(3)」も1語。数だけ(「999」)は num で来る
          pic = parsePic(pt.v, w.line);
        } else if (w.t === "word" && w.v === "VALUE") {
          if (p.atWord("IS")) p.next();
          const vt = p.next();
          if (!vt) throw new CobolError("VALUE のあとに値がない", w.line);
          value = vt.t === "word" && (vt.v === "SPACE" || vt.v === "SPACES") ? "" : vt.t === "word" && (vt.v === "ZERO" || vt.v === "ZEROS" || vt.v === "ZEROES") ? 0 : vt.t === "num" ? Number(vt.v) : vt.v;
        } else {
          throw new CobolError(`項目の書き方で、まだ使えない語「${w.v}」`, w.line);
        }
      }
      if (!pic) continue; // 01 のまとめ項目(下に 05 が並ぶ)は、値を持たないので読み飛ばす
      const item = { name: name.v, pic, value: pic.kind === "X" ? fitText("", pic) : 0 };
      if (value !== undefined) item.value = pic.kind === "X" ? fitText(value, pic) : fitNumber(Number(value), pic);
      items.set(name.v, item); order.push(name.v);
    }
  }
  if (!p.peek()) throw new CobolError("PROCEDURE DIVISION が見つからない", p.line());
  p.next(); p.next(); p.skipDots();
  // 段落名(「MAIN-PARA.」)は読み飛ばす
  const body = parseBlock(p, items, new Set(), true);
  return { items, order, body };
}

// stop にある語か、文の終わりのピリオドで止まる。top のときはピリオドを越えて最後まで読む。
function parseBlock(p, items, stop, top = false) {
  const stmts = [];
  for (;;) {
    const t = p.peek();
    if (!t) return stmts;
    if (t.t === "dot") { if (top) { p.next(); continue; } return stmts; }
    if (t.t === "word" && stop.has(t.v)) return stmts;
    if (t.t === "word" && p.peek(1)?.t === "dot" && !items.has(t.v) && !isVerb(t.v)) { p.next(); continue; } // 段落名
    stmts.push(parseStatement(p, items));
  }
}

const VERBS = ["DISPLAY", "ACCEPT", "MOVE", "COMPUTE", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "IF", "PERFORM", "STOP", "CONTINUE", "GOBACK"];
const isVerb = (w) => VERBS.includes(w);

function operand(p, items) {
  const t = p.next();
  if (!t) throw new CobolError("値か項目の名前が来るはず", p.line());
  if (t.t === "str") return { lit: t.v, line: t.line };
  if (t.t === "num") return { lit: Number(t.v), line: t.line };
  if (t.t === "word") {
    if (t.v === "SPACE" || t.v === "SPACES") return { lit: " ", line: t.line };
    if (t.v === "ZERO" || t.v === "ZEROS" || t.v === "ZEROES") return { lit: 0, line: t.line };
    if (!items.has(t.v)) throw new CobolError(`「${t.v}」という項目は WORKING-STORAGE に無い`, t.line);
    return { ref: t.v, line: t.line };
  }
  throw new CobolError(`ここに「${t.v}」は置けない`, t.line);
}
function target(p, items) {
  const o = operand(p, items);
  if (!o.ref) throw new CobolError("入れる先は項目の名前のはず", o.line);
  return o.ref;
}
function isOperandStart(p, items) {
  const t = p.peek();
  return !!t && (t.t === "str" || t.t === "num" || (t.t === "word" && (items.has(t.v) || ["SPACE", "SPACES", "ZERO", "ZEROS", "ZEROES"].includes(t.v))));
}

// 算術式(COMPUTE と条件で使う)。+ - * / ( ) と ** は無し。
function parseExpr(p, items) {
  let left = parseTerm(p, items);
  while (p.peek()?.t === "op" && (p.peek().v === "+" || p.peek().v === "-")) {
    const op = p.next().v; left = { op, a: left, b: parseTerm(p, items) };
  }
  return left;
}
function parseTerm(p, items) {
  let left = parseFactor(p, items);
  while (p.peek()?.t === "op" && (p.peek().v === "*" || p.peek().v === "/")) {
    const op = p.next().v; left = { op, a: left, b: parseFactor(p, items) };
  }
  return left;
}
function parseFactor(p, items) {
  const t = p.peek();
  if (t?.t === "op" && t.v === "(") {
    p.next();
    const e = parseExpr(p, items);
    const c = p.next();
    if (!c || c.v !== ")") throw new CobolError("かっこ ) が閉じていない", t.line);
    return e;
  }
  if (t?.t === "op" && t.v === "-") { p.next(); return { op: "neg", a: parseFactor(p, items) }; }
  return operand(p, items);
}

// 条件: 式 比べ方 式 [AND|OR 条件]。比べ方は = > < >= <= と NOT、EQUAL/GREATER/LESS [THAN|TO]
function parseCond(p, items) {
  let left = parseSimpleCond(p, items);
  while (p.atWord("AND", "OR")) { const op = p.next().v; left = { op, a: left, b: parseSimpleCond(p, items) }; }
  return left;
}
function parseSimpleCond(p, items) {
  if (p.atWord("NOT")) { p.next(); return { op: "NOT", a: parseSimpleCond(p, items) }; }
  const a = parseExpr(p, items);
  if (p.atWord("IS")) p.next();
  let neg = false;
  if (p.atWord("NOT")) { p.next(); neg = true; }
  let rel;
  const t = p.next();
  if (!t) throw new CobolError("比べ方(= や > など)が来るはず", p.line());
  if (t.t === "op" && ["=", ">", "<", ">=", "<="].includes(t.v)) rel = t.v;
  else if (t.t === "word" && t.v === "EQUAL") { rel = "="; if (p.atWord("TO")) p.next(); }
  else if (t.t === "word" && t.v === "GREATER") { rel = ">"; if (p.atWord("THAN")) p.next(); if (p.atWord("OR")) { p.next(); p.expectWord("EQUAL"); if (p.atWord("TO")) p.next(); rel = ">="; } }
  else if (t.t === "word" && t.v === "LESS") { rel = "<"; if (p.atWord("THAN")) p.next(); if (p.atWord("OR")) { p.next(); p.expectWord("EQUAL"); if (p.atWord("TO")) p.next(); rel = "<="; } }
  else throw new CobolError(`比べ方がわからない「${t.v}」`, t.line);
  const b = parseExpr(p, items);
  return { rel, neg, a, b };
}

function parseStatement(p, items) {
  const t = p.next();
  const line = t.line;
  if (t.t !== "word") throw new CobolError(`文のはじめに「${t.v}」は置けない`, line);
  switch (t.v) {
    case "DISPLAY": {
      const parts = [];
      while (isOperandStart(p, items)) parts.push(operand(p, items));
      if (!parts.length) throw new CobolError("DISPLAY のあとに出すものがない", line);
      return { kind: "DISPLAY", parts, line };
    }
    case "ACCEPT": return { kind: "ACCEPT", to: target(p, items), line };
    case "MOVE": {
      const from = operand(p, items);
      p.expectWord("TO");
      const to = [target(p, items)];
      while (p.peek()?.t === "word" && items.has(p.peek().v)) to.push(target(p, items));
      return { kind: "MOVE", from, to, line };
    }
    case "COMPUTE": {
      const to = target(p, items);
      if (p.atWord("ROUNDED")) p.next();
      const eq = p.next();
      if (!eq || (eq.v !== "=" && eq.v !== "EQUAL")) throw new CobolError("COMPUTE 項目 = 式 の形のはず", line);
      return { kind: "COMPUTE", to, expr: parseExpr(p, items), line };
    }
    case "ADD": case "SUBTRACT": case "MULTIPLY": case "DIVIDE": {
      const verb = t.v;
      const prep = { ADD: ["TO"], SUBTRACT: ["FROM"], MULTIPLY: ["BY"], DIVIDE: ["INTO", "BY"] }[verb];
      const xs = [operand(p, items)];
      while (isOperandStart(p, items)) xs.push(operand(p, items));
      let how = null;
      if (p.atWord(...prep)) how = p.next().v;
      else if (!(verb === "ADD" && p.atWord("GIVING"))) throw new CobolError(`${verb} のあとには ${prep.join(" か ")} が来るはず`, line);
      const ys = how ? [operand(p, items)] : [];
      while (how && isOperandStart(p, items)) ys.push(operand(p, items));
      let giving = null;
      if (p.atWord("GIVING")) { p.next(); giving = target(p, items); }
      if (verb === "DIVIDE" && how === "BY" && !giving) throw new CobolError("DIVIDE A BY B のときは GIVING が要る", line);
      if (!giving && ys.some((y) => !y.ref)) throw new CobolError(`${verb} の答えを入れる先が数そのものになっている(GIVING を使う)`, line);
      return { kind: "ARITH", verb, how, xs, ys, giving, line };
    }
    case "IF": {
      const cond = parseCond(p, items);
      if (p.atWord("THEN")) p.next();
      const then = parseBlock(p, items, KEYWORDS_END);
      let otherwise = [];
      if (p.atWord("ELSE")) { p.next(); otherwise = parseBlock(p, items, KEYWORDS_END); }
      if (p.atWord("END-IF")) p.next();
      else if (p.peek()?.t !== "dot" && p.peek()) throw new CobolError("IF の終わりに END-IF がない", line);
      return { kind: "IF", cond, then, otherwise, line };
    }
    case "PERFORM": {
      if (p.atWord("VARYING")) {
        p.next();
        const v = target(p, items);
        p.expectWord("FROM"); const from = parseExpr(p, items);
        p.expectWord("BY"); const by = parseExpr(p, items);
        p.expectWord("UNTIL"); const until = parseCond(p, items);
        const body = parseBlock(p, items, new Set(["END-PERFORM"]));
        if (!p.atWord("END-PERFORM")) throw new CobolError("PERFORM VARYING の終わりに END-PERFORM がない", line);
        p.next();
        return { kind: "VARYING", v, from, by, until, body, line };
      }
      if (p.atWord("UNTIL")) {
        p.next();
        const until = parseCond(p, items);
        const body = parseBlock(p, items, new Set(["END-PERFORM"]));
        if (!p.atWord("END-PERFORM")) throw new CobolError("PERFORM UNTIL の終わりに END-PERFORM がない", line);
        p.next();
        return { kind: "UNTIL", until, body, line };
      }
      const n = operand(p, items);
      p.expectWord("TIMES");
      const body = parseBlock(p, items, new Set(["END-PERFORM"]));
      if (!p.atWord("END-PERFORM")) throw new CobolError("PERFORM … TIMES の終わりに END-PERFORM がない(段落を呼ぶ PERFORM はまだ使えない)", line);
      p.next();
      return { kind: "TIMES", n, body, line };
    }
    case "STOP": p.expectWord("RUN"); return { kind: "STOP", line };
    case "GOBACK": return { kind: "STOP", line };
    case "CONTINUE": return { kind: "NOP", line };
    default:
      throw new CobolError(`「${t.v}」はまだ使えない語(あとで足す予定)`, line);
  }
}

// ---- 実行 ----
const MAX_STEPS = 100000;
class Stop {}

export function run(source, { input = [] } = {}) {
  const output = [];
  let prog;
  try { prog = parseProgram(source); }
  catch (e) { return { output, error: errText(e), items: new Map() }; }
  const { items } = prog;
  const inputs = [...input];
  let steps = 0;
  const valueOf = (o) => ("lit" in o ? o.lit : items.get(o.ref).value);
  const num = (o) => {
    const v = valueOf(o);
    if (typeof v === "number") return v;
    const n = Number(String(v).trim());
    if (!Number.isFinite(n)) throw new CobolError(`「${String(v).trim()}」は数として使えない`, o.line);
    return n;
  };
  const evalExpr = (e) => {
    if (e.op === "neg") return -evalExpr(e.a);
    if (e.op) {
      const a = evalExpr(e.a), b = evalExpr(e.b);
      if (e.op === "/" && b === 0) throw new CobolError("0 で割ろうとした", e.b.line);
      return e.op === "+" ? a + b : e.op === "-" ? a - b : e.op === "*" ? a * b : a / b;
    }
    return "lit" in e && typeof e.lit === "string" ? e.lit : num(e);
  };
  const store = (name, v) => {
    const it = items.get(name);
    if (it.pic.kind === "X") it.value = fitText(typeof v === "number" ? String(v) : v, it.pic);
    else {
      const n = typeof v === "number" ? v : Number(String(v).trim());
      if (!Number.isFinite(n)) throw new CobolError(`数の項目 ${name} に「${v}」は入らない`, 0);
      it.value = fitNumber(n, it.pic);
    }
  };
  const cmp = (a, b) => {
    if (typeof a === "number" && typeof b === "number") return a - b;
    const x = String(a).trimEnd(), y = String(b).trimEnd();
    return x === y ? 0 : x < y ? -1 : 1;
  };
  const evalCond = (c) => {
    if (c.op === "AND") return evalCond(c.a) && evalCond(c.b);
    if (c.op === "OR") return evalCond(c.a) || evalCond(c.b);
    if (c.op === "NOT") return !evalCond(c.a);
    const d = cmp(evalSide(c.a), evalSide(c.b));
    const r = c.rel === "=" ? d === 0 : c.rel === ">" ? d > 0 : c.rel === "<" ? d < 0 : c.rel === ">=" ? d >= 0 : d <= 0;
    return c.neg ? !r : r;
  };
  // 比べるときは、文字の項目は文字のまま、数の項目は数で
  const evalSide = (e) => (!e.op && "ref" in e && items.get(e.ref).pic.kind === "X" ? items.get(e.ref).value : evalExpr(e));
  const exec = (stmts) => {
    for (const s of stmts) {
      if (++steps > MAX_STEPS) throw new CobolError("繰り返しが終わらない(10万歩で止めた)", s.line);
      try { execOne(s); }
      catch (e) { if (e instanceof CobolError && !e.line) e.line = s.line; throw e; }
    }
  };
  const execOne = (s) => {
    switch (s.kind) {
      case "DISPLAY":
        output.push(s.parts.map((o) => ("lit" in o ? String(o.lit) : showValue(items.get(o.ref)))).join(""));
        break;
      case "ACCEPT": {
        if (!inputs.length) throw new CobolError("ACCEPT で読む入力がもう無い(入力欄に1行ずつ書く)", s.line);
        store(s.to, inputs.shift());
        break;
      }
      case "MOVE": {
        const v = "lit" in s.from ? s.from.lit : items.get(s.from.ref);
        for (const to of s.to) {
          const it = items.get(to);
          if (v && typeof v === "object") { // 項目から項目: 文字へは見える形で、数へは値で
            if (it.pic.kind === "X") store(to, v.pic.kind === "X" ? v.value : showValue(v));
            else store(to, v.pic.kind === "X" ? Number(v.value.trim() || 0) : v.value);
          } else if (it.pic.kind === "X" && v === " ") store(to, "");
          else store(to, v);
        }
        break;
      }
      case "COMPUTE": store(s.to, evalExpr(s.expr)); break;
      case "ARITH": {
        const xs = s.xs.map(num);
        const sumX = xs.reduce((a, b) => a + b, 0);
        const apply = (y) => {
          if (s.verb === "ADD") return y + sumX;
          if (s.verb === "SUBTRACT") return y - sumX;
          if (s.verb === "MULTIPLY") return xs[0] * y;
          // DIVIDE A INTO B → B / A、DIVIDE A BY B → A / B
          const [d, n] = s.how === "INTO" ? [xs[0], y] : [y, xs[0]];
          if (d === 0) throw new CobolError("0 で割ろうとした", s.line);
          return n / d;
        };
        if (s.giving) {
          // ADD A B GIVING C は A+B、ほかは「A 前置詞 B GIVING C」で B を相手にした答え
          store(s.giving, s.verb === "ADD" && !s.ys.length ? sumX : apply(num(s.ys[0])));
        } else for (const y of s.ys) store(y.ref, apply(num(y)));
        break;
      }
      case "IF": exec(evalCond(s.cond) ? s.then : s.otherwise); break;
      case "TIMES": { const n = num(s.n); for (let k = 0; k < n; k++) exec(s.body); break; }
      case "UNTIL": while (!evalCond(s.until)) { exec(s.body); if (++steps > MAX_STEPS) throw new CobolError("繰り返しが終わらない(10万歩で止めた)", s.line); } break;
      case "VARYING": {
        store(s.v, evalExpr(s.from));
        while (!evalCond(s.until)) {
          exec(s.body);
          store(s.v, items.get(s.v).value + evalExpr(s.by));
          if (++steps > MAX_STEPS) throw new CobolError("繰り返しが終わらない(10万歩で止めた)", s.line);
        }
        break;
      }
      case "STOP": throw new Stop();
      case "NOP": break;
    }
  };
  try { exec(prog.body); }
  catch (e) {
    if (!(e instanceof Stop)) return { output, error: errText(e), items };
  }
  return { output, error: null, items };
}

function errText(e) {
  if (e instanceof CobolError) return (e.line ? `${e.line}行目: ` : "") + e.message;
  return "解釈系の中で止まった: " + (e && e.message ? e.message : e);
}
