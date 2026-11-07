// app.js — 7つの関門(bc、b1 ah-163)。トップの札から来る。読むだけ。
// 親(bc)を押すと、子(related に bc-n を持つ ah・af・ae)の番号と題が出る。色の決め方は bc.js。
import "../common/config.js";
import { fetchAllAh, fetchOpenOf, isDenied } from "../m3/af-store.js";
import { gates } from "./bc.js?v=202611081300";

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
  const list = gates(bcs, { ah: ah.filter((t) => t.state !== "済"), af, ae }, today());
  box.textContent = "";
  if (!list.length) { box.append(el("p", { class: "empty" }, "関門はまだありません")); return; }
  for (const g of list) {
    const head = el("summary", { class: "gate-head" },
      el("span", { class: "gate-no" }, String(g.seq)),
      el("span", { class: "gate-title" }, g.title || "(題なし)"),
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
  }
}

if (window.__loginState && window.__loginState.loggedIn) render();
else window.addEventListener("bc-login-success", render, { once: true });
