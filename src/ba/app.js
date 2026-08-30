// [a2学習用] baの投稿・返信・close等はlocalStorageのみ。本番baにもネットにも一切送らない。


import "../common/config.js";
import { esc, fmtTs, CLASSIFICATIONS, CLS_KEY, BY_LABEL, filterFreeTags, withCredential } from "../common/utils.js";
import { groupThreads, entryTypeLabel } from "../common/thread-logic.js";

const API_BASE = window.AA_API_BASE;
const BA_API = `${API_BASE}/ba`;

// ▼ a2学習用 localStorage層(本番baの代わり) ---------------------------------
const LS_KEY = "a2_ba_entries";
function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch (e) { return []; }
}
function lsSetAll(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
const SEED = [
  { id: "t1", threadId: "t1", seq: 1, type: "new", title: "サンプル：はじめてのスレッド", body: "学習用のサンプルです。返信・リアクション・クローズを試せます。", by: "takashi", tags: ["記録"], createdAt: "2026-08-20T01:00:00.000Z" },
  { id: "t1n1", threadId: "t1", seq: 2, type: "note", body: "これは返信（note）のサンプルです。", by: "takashi", createdAt: "2026-08-20T02:30:00.000Z" },
  { id: "t2", threadId: "t2", seq: 3, type: "new", title: "サンプル：案件スレッド", body: "分類タグが「案件」。クローズやタグ変更を試せます。", by: "takashi", tags: ["案件"], createdAt: "2026-08-21T04:00:00.000Z" },
  { id: "t3", threadId: "t3", seq: 4, type: "new", title: "サンプル：気づきスレッド", body: "タイトル訂正やタグ付け替えを試せます。", by: "takashi", tags: ["気づき"], createdAt: "2026-08-22T06:00:00.000Z" },
];
function seedIfEmpty() { if (lsGetAll().length === 0) lsSetAll(SEED); }
// ▲ ------------------------------------------------------------------------

const HUMAN_TYPES = ["note", "void", "status"];

function renderSummary(threads) {
  const openCount = threads.filter((t) => t.status === "open").length;
  const closedCount = threads.length - openCount;
  const allEntries = threads.flatMap((t) => t.entries);
  const latest = allEntries.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

  document.getElementById("statTotal").textContent = threads.length;
  document.getElementById("statOpen").textContent = openCount;
  document.getElementById("statClosed").textContent = closedCount;
  document.getElementById("statLatestBy").textContent = latest ? latest.by : "—";
}

function entryRowHtml(e) {
  const voidClass = e.type === "void" ? (e.value ? " entry--void-true" : " entry--void-false") : "";
  const typeClass = e.type === "correction" ? " entry--correction" : e.type === "priority" ? " entry--priority" : e.type === "status" ? " entry--status" : e.type === "new" ? " entry--new" : e.type === "verified_on_device" ? " entry--verified" : "";

  const titleLine = e.title && (e.type === "new" || e.type === "correction")
    ? `<div class="entry-title">${e.type === "correction" ? "タイトル → " : ""}${esc(e.title)}</div>` : "";

  const approvalHtml = e.pendingApproval
    ? `<span class="approval-badge approval-badge--pending">takashi代筆・承認待ち</span><button type="button" class="btn-approve" data-approve-id="${esc(e.id)}">承認</button>`
    : e.approved
      ? `<span class="approval-badge approval-badge--approved">takashi代筆・承認済み</span>`
      : "";
  return `
    <div class="entry${voidClass || typeClass}">
      <div class="entry-rail"></div>
      <div>
        <div class="entry-head"><span class="entry-type">${entryTypeLabel(e)}</span><span>${fmtTs(e.createdAt)}</span><span>${esc(e.by)}</span>${approvalHtml}</div>
        ${titleLine}
        <div class="entry-body">${esc(e.body || e.reason || "")}</div>
      </div>
    </div>`;
}

const REACT_LANES = ["claude-pc", "claude-mobile", "takashi"];
function reactRowHtml(reactByLane) {
  const chips = REACT_LANES.map((lane) => {
    const val = reactByLane[lane];
    return `<span class="react-chip${val ? " react-chip--on" : ""}">${esc(BY_LABEL[lane] || lane)}${val ? "✓" : ""}</span>`;
  }).join("");
  return `<div class="react-row"><span class="react-label" title="参考程度の反応であり、正式な承認・決定条件ではない">反応:</span>${chips}</div>`;
}

function perspectiveRowHtml(voidView) {
  const c = voidView.claude;
  const t = voidView.takashi;
  if (c === undefined && t === undefined) return "";
  const chip = (val, label) =>
    val === undefined
      ? ""
      : `<span class="perspective-chip ${val ? "perspective-chip--void" : "perspective-chip--active"}">${label}: ${val ? "無効" : "有効"}</span>`;
  return `<div class="perspective-row"><span class="perspective-label">無効フラグ:</span>${chip(c, "C")}${chip(t, "T")}</div>`;
}

function relatedRowHtml(relatedSeqs, seqTitle) {
  if (!relatedSeqs || !relatedSeqs.length) return "";
  const chips = relatedSeqs
    .map((seq) => {
      const preview = (seqTitle && seqTitle[seq]) || "";
      return `<button type="button" class="related-chip" data-jump-seq="${seq}">ba-${seq}${preview ? " " + esc(preview) : ""}</button>`;
    })
    .join("");
  return `<div class="related-row"><span class="related-label">関連:</span>${chips}</div>`;
}

function threadCardHtml(thread, seqTitle, autoExpand) {
  const { threadId, root, children, status } = thread;
  const title = thread.displayTitle || root.body || "(無題)";
  const tags = Array.isArray(root.tags) ? root.tags : [];

  const tagsHtml = filterFreeTags(tags).map((t) => `<span class="tag">#${esc(t)}</span>`).join("");
  const ghHtml = root.github_issue ? `<span class="gh-chip">gh #${esc(root.github_issue)}</span>` : "";

  const clsHtml = thread.cls
    ? `<span class="cls-badge cls-badge--${CLS_KEY[thread.cls]}">${thread.cls}${thread.clsVia === "note" ? '<span class="cls-via">note</span>' : ""}</span>`
    : "";
  const isOpen = status === "open";

  const expand = isOpen && autoExpand;
  const takashiVoid = thread.voidView.takashi;
  const takashiReact = thread.reactByLane.takashi;

  return `
    <details class="thread-card${thread.hiddenVoid ? " thread-card--void" : ""}" data-thread-id="${threadId}" data-seq="${root.seq || ""}" ${expand ? "open" : ""}>
      <summary>
        <div class="thread-top-row">
          <span class="chevron">▶</span>
          ${root.seq ? `<span class="seq-chip">ba-${root.seq}</span>` : ""}
          <span class="pill ${isOpen ? "pill-open" : "pill-closed"}">${isOpen ? "open" : "closed"}</span>
          ${clsHtml}
          <span class="thread-title">${esc(title)}</span>
          ${thread.titleCorrected ? `<span class="title-corrected-chip">タイトル訂正済</span>` : ""}
        </div>
        ${thread.gist ? `<div class="thread-gist">${esc(thread.gist)}</div>` : ""}
        <div class="meta-row">${tagsHtml}${ghHtml}</div>
        ${relatedRowHtml(thread.relatedSeqs, seqTitle)}
        ${perspectiveRowHtml(thread.voidView)}
        ${reactRowHtml(thread.reactByLane)}
      </summary>
      <div class="thread-timeline">
        ${entryRowHtml(root)}
        ${children.map(entryRowHtml).join("")}
        <div class="lane-form">
          <span class="lane-form-label">人間レーンから追記</span>
          <div class="lane-form-row">
            <input type="text" class="note-input" placeholder="ひとこと">
            <button type="button" class="btn-add-note">追加</button>
          </div>
          <div class="lane-form-row" style="margin-top:6px;">
            <button type="button" class="btn-toggle-void">${takashiVoid ? "有効に戻す(T)" : "無効にする(T)"}</button>
            <button type="button" class="btn-toggle-status">${isOpen ? "クローズ" : "再オープン"}</button>
            <button type="button" class="btn-toggle-react">${takashiReact ? "反応を取り消す" : "反応する"}</button>
          </div>
          <div class="lane-form-row" style="margin-top:6px;">
            <select class="reclass-select">
              <option value="" selected disabled>分類を変更…</option>
              ${CLASSIFICATIONS.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
            </select>
            <button type="button" class="btn-reclassify">変更</button>
          </div>
          <div class="lane-form-row" style="margin-top:6px;">
            <input type="text" class="title-fix-input" value="${esc(title)}">
            <button type="button" class="btn-fix-title">タイトルを直す</button>
          </div>
          <div class="lane-form-hint">使える種別: note / void / status / react / 分類変更 / タイトル訂正(id・時刻・by は自動)</div>
        </div>
      </div>
    </details>`;
}

async function postEntry(body) {
  const all = lsGetAll();
  const id = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = Object.assign({}, body, {
    id,
    threadId: body.ref || id,
    seq: Math.max(0, ...all.map((e) => e.seq || 0)) + 1,
    by: "takashi",
    createdAt: new Date().toISOString(),
  });
  all.push(entry);
  lsSetAll(all);
  return entry;
}

function attachThreadHandlers(container, thread) {
  const card = container.querySelector(`[data-thread-id="${thread.threadId}"]`);
  if (!card) return;

  const noteInput = card.querySelector(".note-input");
  card.querySelector(".btn-add-note").addEventListener("click", async () => {
    const body = noteInput.value.trim();
    if (!body) return;
    try {
      await postEntry({ ref: thread.threadId, type: "note", body });
      noteInput.value = "";
      load();
    } catch (e) {
      alert("追記に失敗しました: " + e.message);
    }
  });

  card.querySelector(".btn-toggle-void").addEventListener("click", async () => {
    try {
      await postEntry({ ref: thread.threadId, type: "void", value: !thread.voidView.takashi });
      load();
    } catch (e) {
      alert("無効フラグの切り替えに失敗しました: " + e.message);
    }
  });

  card.querySelector(".btn-toggle-status").addEventListener("click", async () => {
    try {
      await postEntry({ ref: thread.threadId, type: "status", status: thread.status === "open" ? "closed" : "open" });
      load();
    } catch (e) {
      alert("ステータス変更に失敗しました: " + e.message);
    }
  });

  card.querySelector(".btn-toggle-react").addEventListener("click", async () => {
    try {
      await postEntry({ ref: thread.threadId, type: "react", value: !thread.reactByLane.takashi });
      load();
    } catch (e) {
      alert("反応の切り替えに失敗しました: " + e.message);
    }
  });

  const reclassSelect = card.querySelector(".reclass-select");
  card.querySelector(".btn-reclassify").addEventListener("click", async () => {
    const value = reclassSelect.value;
    if (!value) return;
    try {
      await postEntry({ ref: thread.threadId, type: "note", tags: [value] });
      load();
    } catch (e) {
      alert("分類の変更に失敗しました: " + e.message);
    }
  });

  const titleFixInput = card.querySelector(".title-fix-input");
  card.querySelector(".btn-fix-title").addEventListener("click", async () => {
    const newTitle = titleFixInput.value.trim();
    if (!newTitle || newTitle === (thread.displayTitle || "")) return;
    try {
      await postEntry({ ref: thread.threadId, type: "correction", title: newTitle });
      load();
    } catch (e) {
      alert("タイトルの訂正に失敗しました: " + e.message);
    }
  });

  card.querySelectorAll(".btn-approve").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await postEntry({ ref: thread.threadId, type: "approval", approvesId: btn.dataset.approveId });
        load();
      } catch (e) {
        alert("承認に失敗しました: " + e.message);
      }
    });
  });
}

let showVoided = false;

let showClosed = false;

let filterCls = "all";

let searchQuery = "";
let cachedThreads = [];

const AUTO_EXPAND_MAX = 6;

function parseSeqInput(q) {
  const m = q.trim().match(/^(?:ba-|#)?(\d+)$/i);
  return m ? m[1] : null;
}

function jumpToSeq(seq) {
  showVoided = true;
  showClosed = true;
  filterCls = "all";
  searchQuery = "";
  const searchEl = document.getElementById("baSearch");
  if (searchEl) searchEl.value = "";
  render();
  const target = document.querySelector(`[data-seq="${seq}"]`);
  if (target) {
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function threadMatchesTag(thread, q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const allTags = (thread.entries || []).flatMap((e) => (Array.isArray(e.tags) ? e.tags : []));
  return allTags.some((t) => String(t).toLowerCase().includes(needle));
}

function render() {
  const listEl = document.getElementById("threadList");
  const hiddenCount = cachedThreads.filter((t) => t.hiddenVoid).length;
  const closedCount = cachedThreads.filter((t) => t.status !== "open").length;
  const searching = searchQuery.trim() !== "";
  let visible = showVoided ? cachedThreads : cachedThreads.filter((t) => !t.hiddenVoid);

  if (!showClosed && !searching) visible = visible.filter((t) => t.status === "open");
  if (filterCls !== "all") visible = visible.filter((t) => t.cls === filterCls);
  if (searching) visible = visible.filter((t) => threadMatchesTag(t, searchQuery));

  renderSummary(cachedThreads);
  renderClsFilter();

  const toggleEl = document.getElementById("btnToggleVoid");
  toggleEl.style.display = hiddenCount ? "" : "none";
  toggleEl.textContent = showVoided ? `無効スレッドを隠す(${hiddenCount})` : `無効スレッドも表示(${hiddenCount})`;

  const closedEl = document.getElementById("btnToggleClosed");
  closedEl.textContent = showClosed ? `closedを隠す(${closedCount})` : `closedも表示(${closedCount})`;

  const resetEl = document.getElementById("btnSearchReset");
  if (resetEl) resetEl.style.display = searching ? "" : "none";

  const emptyMsg = searching
    ? `<p class="empty">タグ「${esc(searchQuery.trim())}」に一致するスレッドはありません</p>`
    : `<p class="empty">表示できるスレッドがありません(分類フィルタと「closedも表示」を確認)</p>`;

  const autoExpand = visible.length <= AUTO_EXPAND_MAX;
  listEl.innerHTML = visible.map((t) => threadCardHtml(t, cachedThreads.seqTitle, autoExpand)).join("") || emptyMsg;
  visible.forEach((t) => attachThreadHandlers(listEl, t));
}

function renderClsFilter() {
  const el = document.getElementById("clsFilter");
  if (!el) return;
  const count = (c) => cachedThreads.filter((t) => t.cls === c).length;
  const chip = (value, label, n) =>
    `<button type="button" class="cls-chip${filterCls === value ? " cls-chip--on" : ""}${value !== "all" ? ` cls-chip--${CLS_KEY[value]}` : ""}" data-cls="${value}">${label}<span class="cls-cnt">[${n}]</span></button>`;
  el.innerHTML = chip("all", "すべて", cachedThreads.length) + CLASSIFICATIONS.map((c) => chip(c, c, count(c))).join("");
}

async function load() {
  const listEl = document.getElementById("threadList");
  try {
    const items = lsGetAll();
    cachedThreads = groupThreads(items);
    render();
  } catch (e) {
    listEl.innerHTML = `<p class="empty">読み込みエラー: ${e.message}</p>`;
  }
}

function onLoginSuccess() {
  document.getElementById("btnToggleVoid").addEventListener("click", () => {
    showVoided = !showVoided;
    render();
  });
  document.getElementById("btnToggleClosed").addEventListener("click", () => {
    showClosed = !showClosed;
    render();
  });
  document.getElementById("clsFilter").addEventListener("click", (ev) => {
    const btn = ev.target.closest(".cls-chip");
    if (!btn) return;
    filterCls = btn.dataset.cls;
    render();
  });
  const searchEl = document.getElementById("baSearch");
  const searchResetEl = document.getElementById("btnSearchReset");
  if (searchEl) {

    searchEl.addEventListener("input", (ev) => {
      const val = ev.target.value;
      if (parseSeqInput(val) !== null) {
        if (searchQuery !== "") { searchQuery = ""; render(); }
        return;
      }
      searchQuery = val;
      render();
    });

    searchEl.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const seq = parseSeqInput(ev.target.value);
      if (seq !== null) {
        ev.preventDefault();
        jumpToSeq(seq);
      }
    });
  }

  if (searchResetEl) {
    searchResetEl.addEventListener("click", () => {
      searchQuery = "";
      if (searchEl) searchEl.value = "";
      render();
    });
  }

  document.getElementById("threadList").addEventListener("click", (ev) => {
    const btn = ev.target.closest(".related-chip");
    if (!btn) return;
    jumpToSeq(btn.dataset.jumpSeq);
  });
  load();
}

(function bootSandbox() {
  const gate = document.getElementById("login-gate");
  const content = document.getElementById("content");
  if (gate) gate.style.display = "none";
  if (content) content.style.display = "block";
  seedIfEmpty();
  onLoginSuccess();
})();
