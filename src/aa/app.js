// aa/app.js — Firestore版aaレジャー(ab01-9f35a、ba-242/c1.html、2026-08-14にcaから改名)を、baと同じ見た目で
// 表示する読み取り専用ビュー。
//
// baとの違い: baはAzure Table Storage(api/bp_ba.py)をfetchするが、aaはFirestoreに
// SDK経由で直接onSnapshot購読する(src/g/g8/aa-app.jsと同じ接続方式)。
// 書き込みはこのファイルにはない。人間(takashi)の書き込みはFirebase Authenticationが
// 別途要る(未実装、src/g/g8/aa-app.js参照)。Claude(利尻・すまさん)の書き込みは
// Cloud Function「aa-lane」経由(b1/run aa new / note-add)で、このページの外で完結する
// — 書けば(aaThreadsに反映されれば)ここにonSnapshotで即座に出てくる。
//
// aaの対応アクションは今のところ new(スレッド作成)と note-add(追記)の2つだけなので、
// baにあるvoid/status切替・react・link・gist・correction・verified_on_device・難易度・
// seq番号などはaa-lane側に実装が無く、このビューにも出さない(ba-242参照)。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { esc, fmtTs, BY_LABEL } from "../common/utils.js";

// プロジェクトはab01-9f35a(src/g/g8/aa-app.jsと同じ)。apiKeyは公開前提の値
// (クライアントに同梱される) — 認可はFirestore Security Rules(firestore.rules)が担うため、
// ここに秘密情報は含まれない。
const firebaseConfig = {
  apiKey: "AIzaSyDuPw8nMuFWx8ghV5ZeBGETeiNII3uk4l8",
  authDomain: "ab01-9f35a.firebaseapp.com",
  projectId: "ab01-9f35a",
  storageBucket: "ab01-9f35a.firebasestorage.app",
  messagingSenderId: "502154862201",
  appId: "1:502154862201:web:4ca0c72225af6bd0147ea8",
  measurementId: "G-4L8FF69B1B",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const threadsCache = new Map(); // id -> { id, ...fields, notes: [] }
const noteUnsubs = new Map(); // id -> unsubscribe fn

function renderSummary(threads) {
  const openCount = threads.filter((t) => (t.status || "open") === "open").length;
  const closedCount = threads.length - openCount;
  const allEntries = threads.flatMap((t) => [t, ...t.notes]);
  const latest = allEntries.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0];

  document.getElementById("statTotal").textContent = threads.length;
  document.getElementById("statOpen").textContent = openCount;
  document.getElementById("statClosed").textContent = closedCount;
  document.getElementById("statLatestBy").textContent = latest ? (BY_LABEL[latest.by] || latest.by || "—") : "—";
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

function threadCardHtml(t) {
  const isOpen = (t.status || "open") === "open";
  const clsHtml = t.class ? `<span class="tag">#${esc(t.class)}</span>` : "";
  const seqLabel = t.seq != null ? `aa-${t.seq}` : "aa-?";
  const baLabel = t.baSeq != null ? `<span class="tag">→ ba-${esc(String(t.baSeq))}</span>` : "";
  return `
    <details class="thread-card">
      <summary>
        <div class="thread-top-row">
          <span class="chevron">▶</span>
          <span class="pill ${isOpen ? "pill-open" : "pill-closed"}">${isOpen ? "open" : "closed"}</span>
          <span class="tag">${esc(seqLabel)}</span>
          <span class="thread-title">${esc(t.title || "(無題)")}</span>
        </div>
        <div class="meta-row">${clsHtml}${baLabel}<span class="tag">${esc(BY_LABEL[t.by] || t.by || "")}</span><span class="tag">${fmtTs(t.createdAt)}</span></div>
      </summary>
      <div class="thread-timeline">
        ${t.body ? `<div class="entry entry--new"><div class="entry-rail"></div><div><div class="entry-body">${esc(t.body)}</div></div></div>` : ""}
        ${t.notes.map(noteRowHtml).join("")}
      </div>
    </details>`;
}

function render() {
  const threads = [...threadsCache.values()].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  renderSummary(threads);
  const listEl = document.getElementById("threadList");
  listEl.innerHTML = threads.length
    ? threads.map(threadCardHtml).join("")
    : `<p class="empty">まだスレッドがありません</p>`;
}

const threadsQuery = query(collection(db, "aaThreads"), orderBy("createdAt", "asc"));

onSnapshot(
  threadsQuery,
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
        const unsub = onSnapshot(notesQuery, (nsnap) => {
          const t = threadsCache.get(id);
          if (!t) return;
          t.notes = nsnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          render();
        });
        noteUnsubs.set(id, unsub);
      }
    });
    render();
  },
  (err) => {
    document.getElementById("threadList").innerHTML = `<p class="empty">読み込みエラー: ${esc(err.message)}</p>`;
  }
);
