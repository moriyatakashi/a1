import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { esc, fmtTs, BY_LABEL, parseTags } from "../common/utils.js";
const BA_INDEX_URL = "https://moriyatakashi.github.io/a2/c1.html";
const firebaseConfig = {
  apiKey: "AIzaSyDuPw8nMuFWx8ghV5ZeBGETeiNII3uk4l8",
  authDomain: "ab01-9f35a.firebaseapp.com",
  projectId: "ab01-9f35a",
  storageBucket: "ab01-9f35a.firebasestorage.app",
  messagingSenderId: "502154862201",
  appId: "1:502154862201:web:4ca0c72225af6bd0147ea8",
  measurementId: "G-4L8FF69B1B",
};
const db = getFirestore(initializeApp(firebaseConfig));
const threadsCache = new Map();
const noteUnsubs = new Map();
const htmlDocsMeta = new Map();
function ensureHtmlDocsCount(id) {
  if (htmlDocsMeta.has(id)) return;
  htmlDocsMeta.set(id, { count: null, docs: null, expanded: false });
  getCountFromServer(collection(db, "aaThreads", id, "htmlDocs"))
    .then((snap) => {
      const meta = htmlDocsMeta.get(id);
      if (!meta) return;
      meta.count = snap.data().count;
      render();
    })
    .catch(() => {
      const meta = htmlDocsMeta.get(id);
      if (meta) meta.count = 0;
    });
}
function noteRowHtml(n) {
  return `
    <div class="entry entry--note">
      <div class="entry-rail"></div>
      <div>
        <div class="entry-head"><span class="entry-type">note</span><span>${fmtTs(n.createdAt)}</span><span>${esc(BY_LABEL[n.by] || n.by || "")}</span></div>
        <div class="entry-body">${esc(n.body || "")}</div>
      </div>
    </div>`;
}
function detailBlockHtml(t) {
  ensureHtmlDocsCount(t.id);
  const meta = htmlDocsMeta.get(t.id);
  if (!meta || !meta.count) return "";
  const label = meta.expanded ? "解説をとじる ▲" : `解説を見る(${meta.count}) ▼`;
  const framesHtml = !meta.expanded
    ? ""
    : meta.docs === null
      ? `<p class="detail-loading">読み込み中…</p>`
      : meta.docs.map((d) => `<iframe class="detail-frame" sandbox="allow-scripts" srcdoc="${esc(d.html || "")}"></iframe>`).join("");
  return `
    <div class="detail-block">
      <button type="button" class="related-chip detail-toggle" data-id="${esc(t.id)}">${label}</button>
      ${framesHtml}
    </div>`;
}
function threadCardHtml(t) {
  const seqLabel = t.seq != null ? `aa-${t.seq}` : "aa-?";
  const tagsHtml = parseTags(t.tags || "")
    .map((x) => `<span class="aa-tag" onclick="event.stopPropagation()">#${esc(x)}</span>`)
    .join("");
  const baHtml = t.baSeq != null
    ? `<a class="gh-chip" href="${BA_INDEX_URL}#ba-${esc(String(t.baSeq))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">→ ba-${esc(String(t.baSeq))}</a>`
    : "";
  return `
    <details class="thread-card">
      <summary>
        <div class="thread-top-row">
          <span class="chevron">▶</span>
          <span class="expand-hint">内容を見る</span>
          <span class="tag">${esc(seqLabel)}</span>
          <span class="thread-title">${esc(t.title || "(無題)")}</span>
        </div>
        <div class="meta-row">${tagsHtml}${baHtml}</div>
      </summary>
      <div class="thread-timeline">
        ${t.body ? `<div class="entry entry--new"><div class="entry-rail"></div><div><div class="entry-body">${esc(t.body)}</div></div></div>` : ""}
        ${t.notes.map(noteRowHtml).join("")}
      </div>
      ${detailBlockHtml(t)}
    </details>`;
}
function render() {
  const threads = [...threadsCache.values()]
    .filter((t) => t.void !== true)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  document.getElementById("threadList").innerHTML = threads.length
    ? threads.map(threadCardHtml).join("")
    : `<p class="empty">まだスレッドがありません</p>`;
}
document.getElementById("threadList").addEventListener("click", (e) => {
  const btn = e.target.closest(".detail-toggle");
  if (!btn) return;
  const id = btn.dataset.id;
  const meta = htmlDocsMeta.get(id);
  if (!meta) return;
  meta.expanded = !meta.expanded;
  if (meta.expanded && meta.docs === null) {
    render();
    getDocs(collection(db, "aaThreads", id, "htmlDocs")).then((snap) => {
      const m = htmlDocsMeta.get(id);
      if (!m) return;
      m.docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      render();
    });
    return;
  }
  render();
});
onSnapshot(
  query(collection(db, "aaThreads"), orderBy("createdAt", "asc")),
  (snap) => {
    snap.docChanges().forEach((change) => {
      const id = change.doc.id;
      if (change.type === "removed") {
        threadsCache.delete(id);
        const unsub = noteUnsubs.get(id);
        if (unsub) { unsub(); noteUnsubs.delete(id); }
        return;
      }
      const prev = threadsCache.get(id);
      threadsCache.set(id, { id, ...change.doc.data(), notes: prev ? prev.notes : [] });
      if (!noteUnsubs.has(id)) {
        const notesQuery = query(collection(db, "aaThreads", id, "notes"), orderBy("createdAt", "asc"));
        noteUnsubs.set(id, onSnapshot(notesQuery, (nsnap) => {
          const t = threadsCache.get(id);
          if (!t) return;
          t.notes = nsnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          render();
        }));
      }
    });
    render();
  },
  (err) => {
    document.getElementById("threadList").innerHTML = `<p class="empty">読み込みエラー: ${esc(err.message)}</p>`;
  }
);
