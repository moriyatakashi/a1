// app.js — m12(メモ2)。Takashi が bb に書く面(2026-11-07)。m3 と別ページにして、af と書きちがえないようにした。
// できるのは「書く・読む(開いているもの)・閉じる・note を足す」だけ。書くだけで、書いたものが実行されることはない。
import "../common/config.js";
import { clipBody, isDenied } from "../m3/af-store.js";
import { addBbNote, createBb, doneBb, fetchBbNotes, fetchOpenBb } from "./bb-store.js?v=202611071700";

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

// 長い本文はたたんで出す(m3 と同じ)
function bodyEl(text) {
  const { short, cut } = clipBody(text);
  const box = el("div", { class: "af-body" }, cut ? short + "…" : short);
  if (!cut) return box;
  let open = false;
  const btn = el("button", { type: "button", class: "af-fold" }, "開く");
  btn.addEventListener("click", () => {
    open = !open;
    box.firstChild.textContent = open ? text : short + "…";
    btn.textContent = open ? "たたむ" : "開く";
    if (!open) (box.closest(".af-item") || box).scrollIntoView({ block: "start" });
  });
  box.append(" ", btn);
  return box;
}

// note の本文。一覧を先に出して、あとから埋める。読めなければ件数のまま(一覧は止めない)
const jst = (iso) => new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
function notesEl(id) {
  const box = el("div", { class: "af-notes" });
  fetchBbNotes(id).then((notes) => {
    for (const n of notes) {
      box.append(el("div", { class: "af-note" },
        el("div", { class: "af-meta" }, [n.by && n.by !== "takashi" ? n.by : "", n.createdAt ? jst(n.createdAt) : ""].filter(Boolean).join(" · ")),
        el("div", { class: "af-body" }, n.body || "")));
    }
  }).catch(() => { box.append(el("div", { class: "af-msg" }, "note を読めませんでした")); });
  return box;
}

async function renderList() {
  const box = document.getElementById("bbList");
  box.textContent = "読み込み中…";
  let items;
  try {
    items = await fetchOpenBb();
  } catch (e) {
    box.textContent = isDenied(e) ? "まだ読めません(この端末で未ログイン)" : "読めませんでした: " + (e.message || e);
    return;
  }
  box.textContent = "";
  document.getElementById("bbCount").textContent = `(${items.length}件)`;
  if (!items.length) { box.append(el("p", { class: "af-empty" }, "開いているものはありません")); return; }
  for (const t of items) {
    const notes = Array.isArray(t.noteMeta) ? t.noteMeta.length : 0;
    const meta = [`bb-${t.seq}`, (t.createdAt || "").slice(0, 10), t.by && t.by !== "takashi" ? t.by : "",
      notes ? `note ${notes}` : ""].filter(Boolean).join(" · ");
    const row = el("div", { class: "af-item", "data-id": t.id },
      el("div", { class: "af-meta" }, meta),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)"));
    if (t.body) row.append(bodyEl(t.body));
    if (notes) row.append(notesEl(t.id));
    const msg = el("span", { class: "af-msg" });
    row.append(el("div", { class: "af-actions" },
      el("button", { type: "button", class: "af-btn", onclick: async () => {
        const text = (prompt(`bb-${t.seq} に足す note`) || "").trim();
        if (!text) return;
        try { await addBbNote(t.id, text); await renderList(); } catch (e) { msg.textContent = "失敗: " + (e.message || e); }
      } }, "note を足す"),
      el("button", { type: "button", class: "af-btn", onclick: async () => {
        if (!confirm(`bb-${t.seq} を済みにしますか(消えはしません)`)) return;
        try { await doneBb(t.id); await renderList(); } catch (e) { msg.textContent = "失敗: " + (e.message || e); }
      } }, "済みにする"),
      msg));
    box.append(row);
  }
}

function init() {
  const elTitle = document.getElementById("newTitle");
  const elBody = document.getElementById("newBody");
  const elSubmit = document.getElementById("btnAdd");
  const elResult = document.getElementById("postResult");
  elSubmit.addEventListener("click", async () => {
    const title = elTitle.value.trim();
    if (!title) { elTitle.focus(); return; }
    elSubmit.disabled = true;
    try {
      const r = await createBb({ title, body: elBody.value.trim() });
      elTitle.value = "";
      elBody.value = "";
      elResult.textContent = `追加しました: bb-${r.seq}`;
      renderList();
    } catch (e) {
      elResult.textContent = "";
      alert("追加に失敗しました: " + (isDenied(e) ? "bb に書けませんでした(この端末でログインし直してください)" : e.message));
    } finally {
      elSubmit.disabled = false;
    }
  });
  renderList();
}

if (window.__loginState && window.__loginState.loggedIn) {
  init();
} else {
  window.addEventListener("m12-login-success", init, { once: true });
}
