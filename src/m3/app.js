// app.js — m3(たかし専用の記入面)。
// 2026-10-10(ab-161、Takashi 決定): 書き先を ba(Azure)から af(「ほぼba」、Firestore の afThreads)に切り替えた。
// 画面の場所はそのまま。できるのは「書く・読む(開いているもの)・閉じる・note を足す」だけ(要るものはあとで足す)。
// af の Rules がまだ反映されていない(permission-denied)うちは、今までどおり ba に書く(ab-163 の反映待ちの間の逃げ道)。
import "../common/config.js";
import { CLASSIFICATIONS, parseTags, withCredential } from "../common/utils.js";
import { addAfNote, cleanAfTags, createAf, doneAf, fetchOpenAf, isDenied } from "./af-store.js";

const API_BASE = window.AA_API_BASE; // common/config.js から
const BA_API = `${API_BASE}/ba`;

async function postBaEntry(body) {
  const res = await fetch(BA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withCredential(body)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// af に書く。Rules がまだで書けなければ ba に書き、どちらに書いたかを返す
async function writeEntry({ title, tags, body }) {
  try {
    const r = await createAf({ title, body, tags: cleanAfTags(tags) });
    return `追加しました: af-${r.seq}`;
  } catch (e) {
    if (!isDenied(e)) throw e;
    const r = await postBaEntry({ type: "new", title, tags, body });
    return `af はまだ使えないので(Rules の反映待ち)、ba に書きました: ba-${r.seq}`;
  }
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k.startsWith("on")) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

async function renderList() {
  const box = document.getElementById("afList");
  if (!box) return;
  box.textContent = "読み込み中…";
  let items;
  try {
    items = await fetchOpenAf();
  } catch (e) {
    box.textContent = isDenied(e) ? "まだ読めません(af の Rules の反映待ち、またはこの端末で未ログイン)" : "読めませんでした: " + (e.message || e);
    return;
  }
  box.textContent = "";
  document.getElementById("afCount").textContent = `(${items.length}件)`;
  if (!items.length) { box.append(el("p", { class: "af-empty" }, "開いているものはありません")); return; }
  for (const t of items) {
    const notes = Array.isArray(t.noteMeta) ? t.noteMeta.length : 0;
    const meta = [`af-${t.seq}`, (t.createdAt || "").slice(0, 10), t.by && t.by !== "takashi" ? t.by : "",
      t.migratedFrom ? `旧${t.migratedFrom}` : "", notes ? `note ${notes}` : ""].filter(Boolean).join(" · ");
    const row = el("div", { class: "af-item", "data-id": t.id },
      el("div", { class: "af-meta" }, meta),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)"));
    if (t.body) row.append(el("div", { class: "af-body" }, t.body));
    if (t.tags && t.tags.length) row.append(el("div", { class: "af-tags" }, t.tags.map((x) => "#" + x).join(" ")));
    const msg = el("span", { class: "af-msg" });
    row.append(el("div", { class: "af-actions" },
      el("button", { type: "button", class: "af-btn", onclick: async () => {
        const text = (prompt(`af-${t.seq} に足す note`) || "").trim();
        if (!text) return;
        try { await addAfNote(t.id, text); await renderList(); } catch (e) { msg.textContent = "失敗: " + (e.message || e); }
      } }, "note を足す"),
      el("button", { type: "button", class: "af-btn", onclick: async () => {
        if (!confirm(`af-${t.seq} を済みにしますか(消えはしません)`)) return;
        try { await doneAf(t.id); await renderList(); } catch (e) { msg.textContent = "失敗: " + (e.message || e); }
      } }, "済みにする"),
      msg));
    box.append(row);
  }
}

function initNewEntryForm() {
  const elTitle = document.getElementById("newTitle");
  const elTags = document.getElementById("newTags");
  const elBody = document.getElementById("newBody");
  const elJson = document.getElementById("newJson");
  const elSubmit = document.getElementById("btnAddThread");
  const elResult = document.getElementById("postResult");

  elSubmit.addEventListener("click", async () => {
    try {
      let entry;
      if (elJson.value.trim()) {
        const parsed = JSON.parse(elJson.value);
        entry = { title: String(parsed.title || "").trim(), tags: Array.isArray(parsed.tags) ? parsed.tags : [], body: String(parsed.body || "") };
        if (!entry.title) throw new Error("JSON に title がありません");
      } else {
        const title = elTitle.value.trim();
        if (!title) { elTitle.focus(); return; }
        entry = { title, tags: parseTags(elTags.value), body: elBody.value.trim() };
      }
      // 分類を tags に入れる(ba-32 の名残。af では分類は必須でないが、選んだものは付けておく)
      if (!entry.tags.some((t) => CLASSIFICATIONS.includes(t))) {
        const clsEl = document.querySelector('input[name="newCls"]:checked');
        if (clsEl) entry.tags = [clsEl.value, ...entry.tags];
      }
      elSubmit.disabled = true;
      const text = await writeEntry(entry);
      elTitle.value = "";
      elTags.value = "";
      elBody.value = "";
      elJson.value = "";
      if (elResult) elResult.textContent = text;
      renderList();
    } catch (e) {
      if (elResult) elResult.textContent = "";
      alert("追加に失敗しました: " + e.message);
    } finally {
      elSubmit.disabled = false;
    }
  });
  renderList();
}

if (window.__loginState && window.__loginState.loggedIn) {
  initNewEntryForm();
} else {
  window.addEventListener("m3-login-success", initNewEntryForm, { once: true });
}
