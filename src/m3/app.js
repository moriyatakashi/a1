// app.js — m3(たかし専用の記入面)。
// 2026-10-10(ab-161、Takashi 決定): 書き先を ba(Azure)から af(「ほぼba」、Firestore の afThreads)に切り替えた。
// 画面の場所はそのまま。できるのは「書く・読む(開いているもの)・閉じる・note を足す」だけ(要るものはあとで足す)。
// 2026-10-10(ab-166 ②): Rules 第1段が出て m3 から af に書けるのを確かめたので、ba(Azure)への逃げ道は外した。
import "../common/config.js";
import { CLASSIFICATIONS, parseTags } from "../common/utils.js";
import { addAfNote, AH_GROUPS, ahCounts, ahHeld,cleanAfTags, createAf, doneAf, fetchAllAh, fetchOpenAf, fetchOpenAh, fetchOpenOf, fetchRecentAg, fetchTicketJob, isDenied, rebunView, STALE_MIN, TAKASHI_MIN, takashiView } from "./af-store.js";

// af に書く。書けなければ(この端末で Firebase に未ログインなど)そのまま失敗を出す
async function writeEntry({ title, tags, body }) {
  try {
    const r = await createAf({ title, body, tags: cleanAfTags(tags) });
    return `追加しました: af-${r.seq}`;
  } catch (e) {
    if (isDenied(e)) throw new Error("af に書けませんでした(この端末でログインし直してください)");
    throw e;
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
    box.textContent = isDenied(e) ? "まだ読めません(この端末で未ログイン)" : "読めませんでした: " + (e.message || e);
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

// 2026-10-18(ab-185、Takashi explain Q1 A): ag は家人が書き、Takashi はここで読むだけ
async function renderAg() {
  const box = document.getElementById("agList");
  if (!box) return;
  box.textContent = "読み込み中…";
  let items;
  try {
    items = await fetchRecentAg();
  } catch (e) {
    box.textContent = isDenied(e) ? "まだ読めません(この端末で未ログイン)" : "読めませんでした: " + (e.message || e);
    return;
  }
  box.textContent = "";
  if (!items.length) { box.append(el("p", { class: "af-empty" }, "まだありません")); return; }
  for (const t of items) {
    const notes = Array.isArray(t.noteMeta) ? t.noteMeta.length : 0;
    const related = Array.isArray(t.related) && t.related.length ? "関連 " + t.related.join(",") : "";
    const meta = [`ag-${t.seq}`, (t.createdAt || "").slice(0, 10), t.by || "", related, notes ? `note ${notes}` : ""]
      .filter(Boolean).join(" · ");
    const row = el("div", { class: "af-item" },
      el("div", { class: "af-meta" }, meta),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)"));
    if (t.body) row.append(el("div", { class: "af-body" }, t.body));
    box.append(row);
  }
}

// 2026-10-18(b1 ab-193): ah(作業票)は家人が握って動かし、Takashi はここで読むだけ。次が Takashi の票が先頭
const AH_NAMES = { takashi: "Takashi", rishiri: "利尻", suma: "すま", rebun: "礼文", teuri: "天売",
  "claude-mobile": "すま", "claude-pc": "利尻", "claude-pi": "礼文" };
const who = (id) => AH_NAMES[id] || id || "-";
async function renderAh() {
  const box = document.getElementById("ahList");
  if (!box) return;
  box.textContent = "読み込み中…";
  const rb = document.getElementById("rebunAh");
  if (rb) rb.textContent = "読み込み中…";
  let all, items;
  try {
    all = await fetchAllAh();
    items = await fetchOpenAh(Date.now(), all);
  } catch (e) {
    box.textContent = isDenied(e) ? "まだ読めません(この端末で未ログイン)" : "読めませんでした: " + (e.message || e);
    if (rb) rb.textContent = box.textContent;
    return;
  }
  renderRebun(all);
  renderTakashi(all);
  box.textContent = "";
  // ah-37: 頭に3つの数(b1/run ah list の頭と同じ分け方)。ah-40: 上に移した礼文の票の頭にも同じ行
  const n = ahCounts(all);
  const counts = AH_GROUPS.map((g) => `${g} ${n[g]}`).join(" · ");
  box.append(el("div", { class: "af-meta ah-counts" }, counts));
  if (rb) rb.prepend(el("div", { class: "af-meta ah-counts" }, counts));
  if (!items.length) box.append(el("p", { class: "af-empty" }, "まだありません"));
  for (const t of items) {
    const meta = [`ah-${t.seq}`, t.state || "待ち", `次:${who(t.next)}`, t.holder ? `握り:${who(t.holder)}` : ""]
      .filter(Boolean).join(" · ");
    box.append(el("div", { class: "af-item" + (t.next === "takashi" ? " ah-mine" : "") },
      el("div", { class: "af-meta" }, meta),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)")));
  }
  // ah-41: 保留の小さな区画(戻す条件・見直す日。見直す日を過ぎたものは目立たせる)
  const held = ahHeld(all);
  if (!held.length) return;
  box.append(el("div", { class: "rb-sub" }, `保留(${held.length}件)`));
  for (const t of held) {
    box.append(el("div", { class: "af-item" + (t.late ? " rb-stale" : "") },
      el("div", { class: "af-meta" }, [`ah-${t.seq}`, `戻す条件:${t.holdUntil || "-"}`, `見直す日:${t.holdReview || "-"}`,
        t.late ? "見直す日を過ぎた" : ""].filter(Boolean).join(" · ")),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)")));
  }
}

// 2026-10-19(ah-38): 礼文の票だけに絞った見え方。下の ah 一覧はそのまま。読むだけ
const ago = (m) => (m == null ? "-" : m < 60 ? `${m}分前` : `${Math.floor(m / 60)}時間${m % 60}分前`);
const hm = (s) => (s ? new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
function renderRebun(all) {
  const box = document.getElementById("rebunAh");
  if (!box) return;
  const { holding, assigned, done } = rebunView(all);
  box.textContent = "";
  // ah-42: 家人向けの細かい情報(cron の最後の回・握ってからの時間・最近済んだ票)は下にたたむ
  const more = el("details", { class: "rb-more" }, el("summary", {}, "くわしく"));
  const part = (head, rows, to = box) => {
    to.append(el("div", { class: "rb-sub" }, head));
    if (!rows.length) to.append(el("p", { class: "af-empty" }, "なし"));
    for (const [meta, title, cls] of rows) {
      to.append(el("div", { class: "af-item" + (cls ? " " + cls : "") }, el("div", { class: "af-meta" }, meta), el("div", { class: "af-title" }, title || "(タイトルなし)")));
    }
  };
  part("握っている票(作業中)", holding.map((t) => [
    [`ah-${t.seq}`, t.view, t.stale ? `印が${STALE_MIN}分より古い(止まっているかも)` : ""].filter(Boolean).join(" · "),
    t.title, t.stale ? "rb-stale" : ""]));
  part("礼文に回っている票", assigned.map((t) => [[`ah-${t.seq}`, t.state || "待ち", `次:${who(t.next)}`].join(" · "), t.title, t.next === "takashi" ? "ah-mine" : ""]));
  box.append(more);
  for (const t of holding) more.append(el("div", { class: "af-meta" }, [`ah-${t.seq}`, `握って ${ago(t.claimedMin)}`, `最後の印 ${ago(t.beatMin)}`].join(" · ")));
  part(`最近済んだ票(${done.length}件)`, done.map((t) => [[`ah-${t.seq}`, "済", hm(t.doneAt)].join(" · "), t.title]), more);
  fetchTicketJob().then((j) => {
    if (!j) return;
    const ok = Date.parse(j.okAt || "") || 0, ng = Date.parse(j.ngAt || "") || 0;
    const line = ng > ok ? `票の cron の最後の回: ${hm(j.ngAt)} うまくいかなかった${j.ngNote ? `(${j.ngNote})` : ""}` : `票の cron の最後の回: ${hm(j.okAt)} うまくいった`;
    more.querySelector("summary").after(el("div", { class: "af-meta rb-job" + (ng > ok ? " rb-stale" : "") }, line));
  });
}

// 2026-10-20(ah-44): Takashi の番。次が Takashi の票、TAKASHI_MIN 件より少なければ全 aX の未決から古い順に足す。読むだけ
async function renderTakashi(all) {
  const box = document.getElementById("takashiAh");
  if (!box) return;
  let items = takashiView(all);
  if (items.some((t) => t.fill) || items.length < TAKASHI_MIN) {
    try {
      const [ab, ac, af] = await Promise.all([fetchOpenOf("abThreads"), fetchOpenOf("acThreads"), fetchOpenAf()]);
      items = takashiView(all, { ab, ac, af });
    } catch { /* 読めなければ ah の分だけ */ }
  }
  box.textContent = "";
  if (!items.length) { box.append(el("p", { class: "af-empty" }, "なし")); return; }
  for (const t of items) {
    box.append(el("div", { class: "af-item" + (t.fill ? "" : " ah-mine") },
      el("div", { class: "af-meta" }, [t.key, `持ち主:${who(t.who)}`, t.fill ? "未決から" : ""].filter(Boolean).join(" · ")),
      el("div", { class: "af-title" }, t.title || "(タイトルなし)")));
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
  renderAg();
  renderAh();
}

if (window.__loginState && window.__loginState.loggedIn) {
  initNewEntryForm();
} else {
  window.addEventListener("m3-login-success", initNewEntryForm, { once: true });
}
