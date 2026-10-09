// m7 / COBOL 入門(ab-147、2026-10-09 礼文)。例題は lessons.js、動かすのは cobol.js(どちらもテストあり)。
// Firestore には何も書かない。正解した問いだけ、この端末(localStorage)に覚える。
// 選択肢は例題ごとに決まった順でまぜる(正解がいつも1番目にならないように。開くたびに変わると「さっきの2番」が言えないので固定)。
import { run } from "./cobol.js?v=202610100000";
import { LESSONS, joinOutput } from "./lessons.js?v=202610100000";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DONE_KEY = "m7:done";

const loadDone = () => { try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY) || "[]")); } catch { return new Set(); } };
const saveDone = (s) => { try { localStorage.setItem(DONE_KEY, JSON.stringify([...s])); } catch { /* 覚えられなくても遊べる */ } };
let done = loadDone();

// id から決まる順でまぜる(小さな線形合同法)
function shuffled(arr, seedText) {
  let seed = [...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const a = arr.map((v, i) => [v, i]);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// 桁の目盛りとコード。8〜11桁(A 領域)に色を付ける。
const RULER = "----+----1----+----2----+----3----+----4----+----5";
function codeHtml(lines) {
  const rows = lines.map((line, i) => {
    const body = line.length > 7 ? esc(line.slice(0, 7)) + `<span class="a">${esc(line.slice(7, 11))}</span>` + esc(line.slice(11)) : esc(line);
    return `<tr><td class="n">${i + 1}</td><td class="t">${body}</td></tr>`;
  }).join("");
  return `<div class="code"><table><tr class="ruler"><td class="n"></td><td class="t">${RULER}</td></tr>${rows}</table></div>`;
}

function outputHtml(r, input) {
  const parts = [];
  if (input && input.length) parts.push(`<span class="in">入力: ${esc(input.join(" / "))}</span>`);
  if (r.output.length) parts.push(r.output.map(esc).join("\n"));
  else if (!r.error) parts.push(`<span class="in">(何も出なかった)</span>`);
  if (r.error) parts.push(`<span class="err">止まった: ${esc(r.error)}</span>`);
  return parts.join("\n");
}

function renderLessons() {
  $("lessons").innerHTML = LESSONS.map((l, n) => {
    const order = shuffled(l.choices, l.id);
    return `<div class="section lesson" id="l-${l.id}" data-id="${l.id}">
      <h2><span class="no">${n + 1}/${LESSONS.length}</span>${esc(l.title)}<span class="done-mark"${done.has(l.id) ? "" : " hidden"}>✓ 正解ずみ</span></h2>
      <p class="point">${esc(l.point)}</p>
      ${codeHtml(l.code)}
      <div class="ask">${esc(l.ask)}</div>
      <div class="choices">${order.map(([c, i], k) => `<button type="button" data-i="${i}">${"ABCD"[k]}. ${esc(c)}</button>`).join("")}</div>
      <div class="feedback" aria-live="polite"></div>
      <div class="tools">
        <button type="button" data-act="run">動かしてみる</button>
        <button type="button" data-act="copy">Playground に写す</button>
      </div>
      <div class="out" hidden></div>
      <details class="notes"${done.has(l.id) ? " open" : ""}><summary>1行ずつの解説</summary>
        <ol>${l.lines.map(([no, text]) => `<li><b>${no}行目</b><span>${esc(text)}</span></li>`).join("")}</ol>
      </details>
    </div>`;
  }).join("");
  // 正解ずみの問いは、正解の選択肢に印を付けておく
  for (const l of LESSONS) if (done.has(l.id)) markAnswered(l);
  drawProgress();
}

function markAnswered(l) {
  const card = $("l-" + l.id);
  for (const b of card.querySelectorAll(".choices button")) {
    if (Number(b.dataset.i) === l.answer) b.classList.add("ok");
  }
}

function drawProgress() {
  const n = LESSONS.filter((l) => done.has(l.id)).length;
  $("progressText").textContent = `正解 ${n} / ${LESSONS.length}`;
  $("progressBar").style.width = `${(n / LESSONS.length) * 100}%`;
}

$("lessons").addEventListener("click", (e) => {
  const card = e.target.closest(".lesson");
  if (!card) return;
  const l = LESSONS.find((x) => x.id === card.dataset.id);
  const choice = e.target.closest(".choices button");
  if (choice && !choice.disabled) {
    const fb = card.querySelector(".feedback");
    if (Number(choice.dataset.i) === l.answer) {
      choice.classList.add("ok");
      for (const b of card.querySelectorAll(".choices button")) if (b !== choice) b.disabled = true;
      fb.className = "feedback ok";
      fb.textContent = "正解！ 下の「1行ずつの解説」で、どの行が何をしているか確かめられます。";
      card.querySelector(".notes").open = true;
      card.querySelector(".done-mark").hidden = false;
      done.add(l.id); saveDone(done); drawProgress();
    } else {
      choice.classList.add("ng");
      choice.disabled = true;
      fb.className = "feedback ng";
      fb.textContent = "ちがいました。ヒント: " + l.hint;
    }
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (act === "run") {
    const out = card.querySelector(".out");
    out.innerHTML = outputHtml(run(l.code.join("\n"), { input: l.input || [] }), l.input);
    out.hidden = false;
  } else if (act === "copy") {
    $("playCode").value = l.code.join("\n");
    $("playInput").value = (l.input || []).join("\n");
    $("playOut").hidden = true;
    $("play").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

$("btnReset").addEventListener("click", () => {
  done = new Set(); saveDone(done); renderLessons();
});

// ---- Playground ----
const SAMPLE = [
  "       IDENTIFICATION DIVISION.",
  "       PROGRAM-ID. PLAY.",
  "       DATA DIVISION.",
  "       WORKING-STORAGE SECTION.",
  "       01  I         PIC 9(2).",
  "       01  WS-PRICE  PIC 9(5) VALUE 1200.",
  "       01  WS-TAX    PIC 9(5).",
  "       PROCEDURE DIVISION.",
  "      * 消費税(10%)を足した値段を3回出す",
  "           PERFORM VARYING I FROM 1 BY 1 UNTIL I > 3",
  "               COMPUTE WS-TAX = WS-PRICE * I * 110 / 100",
  "               DISPLAY I \"こ: \" WS-TAX \"円\"",
  "           END-PERFORM.",
  "           STOP RUN.",
].join("\n");
const playReset = () => { $("playCode").value = SAMPLE; $("playInput").value = ""; $("playOut").hidden = true; };
$("btnPlayReset").addEventListener("click", playReset);
$("btnPlay").addEventListener("click", () => {
  const input = $("playInput").value.split(/\r?\n/).filter((s, i, a) => s !== "" || i < a.length - 1);
  $("playOut").innerHTML = outputHtml(run($("playCode").value, { input }), input);
  $("playOut").hidden = false;
});

renderLessons();
playReset();
