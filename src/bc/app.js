// app.js — 7つの関門(bc、b1 ah-163)。トップの札から来る。読むだけ。
// 親(bc)を押すと、子(related に bc-n を持つ ah・af・ae)の番号と題が出る。色の決め方は bc.js。
import "../common/config.js";
import { fetchAllAh, fetchOpenOf, isDenied } from "../m3/af-store.js";
import { gates, morning, MORNING_BC } from "./bc.js?v=202611200800";

const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

// bc の note を読む(朝の課題、ah-202。形は m12 の fetchBbNotes と同じ)
async function fetchBcNotes(id) {
  const [{ collection, getDocs }, { db, ensureReadLogin, guardRead }] = await Promise.all([import(SDK), import("../common/firebase.js")]);
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "bcThreads", id, "notes")));
  return snap.docs.map((d) => d.data());
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
const COLOR_WORD = { red: "期日超えあり", orange: "期日が近い", faint: "子なし" };

async function render() {
  const box = document.getElementById("gates");
  let bcs, ah, af, ae;
  try {
    [bcs, ah, af, ae] = await Promise.all([fetchOpenOf("bcThreads"), fetchAllAh(), fetchOpenOf("afThreads"), fetchOpenOf("aeThreads")]);
  } catch (e) {
    box.textContent = isDenied(e) ? "まだ読めません(この端末で未ログイン)" : "読めませんでした: " + (e.message || e);
    return;
  }
  renderMorning(bcs.find((b) => Number(b.seq) === MORNING_BC));
  const list = gates(bcs, { ah: ah.filter((t) => t.state !== "済"), af, ae }, today());
  box.textContent = "";
  if (!list.length) { box.append(el("p", { class: "empty" }, "関門はまだありません")); return; }
  list.forEach((g, i) => {
    // 頭の数字は上からの順。bc の番号は題のあとに(Takashi 11/8)
    const head = el("summary", { class: "gate-head" },
      el("span", { class: "gate-no" }, String(i + 1)),
      el("span", { class: "gate-title" }, `${g.title || "(題なし)"}(bc-${g.seq})`),
      el("span", { class: "gate-n" }, `${g.kids.length}件${COLOR_WORD[g.color] ? "・" + COLOR_WORD[g.color] : ""}`));
    const kids = el("ul", { class: "kids" });
    for (const k of g.kids) {
      kids.append(el("li", { class: `kid ${k.color}` },
        el("span", { class: "kid-key" }, k.key),
        el("span", { class: "kid-title" }, k.title),
        k.dueDate ? el("span", { class: "kid-due" }, `期日 ${k.dueDate.slice(5).replace("-", "/")}`) : ""));
    }
    if (!g.kids.length) kids.append(el("li", { class: "kid none" }, "まだ子がありません"));
    box.append(el("details", { class: `gate ${g.color}`, "data-bc": `bc-${g.seq}` }, head, kids));
  });
}

const mmdd = (iso) => iso.slice(5).replace("-", "/");

// 朝の課題(ah-202): bc-4 の【朝の課題】【課題の判定】から、いちばん新しい a・b・c と直近7日の n/3
async function renderMorning(bc) {
  const box = document.getElementById("morning");
  if (!bc) { box.textContent = ""; return; }
  let m;
  try {
    m = morning(await fetchBcNotes(bc.id), today());
  } catch (e) {
    box.textContent = "朝の課題: 読めませんでした: " + (e.message || e);
    return;
  }
  box.textContent = "";
  const head = el("h2", { class: "morning-head" }, `朝の課題(bc-${MORNING_BC})`);
  if (m.unreadable) { box.append(head, el("p", { class: "empty" }, "読めず(いちばん新しい【朝の課題】の形が崩れています)")); return; }
  if (!m.latest) { box.append(head, el("p", { class: "empty" }, "まだありません")); return; }
  const l = m.latest;
  const sub = el("p", { class: "morning-sub" },
    `${mmdd(l.date)} の課題・発生日 ${l.origin || mmdd(l.date)}${l.n === null ? "・判定まち" : `・${l.n}/3`}`);
  const items = el("ul", { class: "morning-items" });
  for (const i of l.items) {
    const v = i.verdict;
    items.append(el("li", { class: `morning-item ${v ? (v.ok ? "ok" : "ng") : "wait"}` },
      el("span", { class: "kid-key" }, i.letter),
      el("span", { class: "kid-title" }, i.title),
      el("span", { class: "morning-to" }, `→ ${i.to}`),
      el("span", { class: "morning-verdict" }, v ? `${v.ok ? "できた" : "できない"}${v.word ? "(" + v.word + ")" : ""}` : "判定まち")));
  }
  const days = el("div", { class: "morning-days" });
  for (const d of m.days) {
    days.append(el("span", { class: "morning-day", title: d.date },
      el("span", { class: "morning-bar" }, el("span", { style: `height:${d.n === null ? 0 : (d.n / 3) * 100}%` })),
      el("span", { class: "morning-n" }, d.n === null ? "–" : `${d.n}/3`),
      el("span", { class: "morning-date" }, mmdd(d.date))));
  }
  box.append(head, sub, items, days);
}

window.aaWhenLoggedIn(render);
