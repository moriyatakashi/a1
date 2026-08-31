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
// ba-289改訂(2026-08-15、aa_lane/main.py参照)でstatus/classは廃止済み、void/tags/baSeqが
// 追加された。open/closedの概念自体が無い(void=trueのスレッドを単純に出さないだけ)ので、
// このビューにもopen/closedのpill表示は持たない。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, collection, query, orderBy, onSnapshot, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { esc, fmtTs, BY_LABEL, parseTags } from "../common/utils.js";

// 新c1(旧c2、a2リポジトリ)のBaLog Index。ba番号タグのリンク先。
const BA_INDEX_URL = "https://moriyatakashi.github.io/a2/c1.html";

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

// htmlDocs(2026-08-16、「窓の窓」): aaThreads本体のフィールドではなくサブコレクション
// (aa_lane/main.pyのhtml-add参照)。既定では出さず、件数だけ軽量に取得(getCountFromServer、
// 中身は読まない)しておき、「解説を見る」が押された時だけ本文を取りに行く(容量対策)。
const htmlDocsMeta = new Map(); // id -> { count: number|null, docs: array|null, expanded: bool }

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
  ensureHtmlDocsCount(t.id); // 未取得ならここで件数取得を1回だけ発火(結果はrenderで反映)
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
  // タグは今は押しても何も起きない(将来: タグ絞り込み)。summary内なのでクリックがカードの
  // 開閉トグルへ抜けないようstopPropagationしておく
  const tagsHtml = parseTags(t.tags || "")
    .map((x) => `<span class="aa-tag" onclick="event.stopPropagation()">#${esc(x)}</span>`)
    .join("");
  // ba番号は新c1(a2)の該当行への外部リンク。gh-chip(既存の「外部参照」チップ)を流用し、
  // タグ・aa番号と見た目で区別する。カード自体の開閉トグルとは独立させる
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
  // voidは単純に出さない(open/closedのような状態表示は持たず、voidだけが特別扱い)
  const threads = [...threadsCache.values()]
    .filter((t) => t.void !== true)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const listEl = document.getElementById("threadList");
  listEl.innerHTML = threads.length
    ? threads.map(threadCardHtml).join("")
    : `<p class="empty">まだスレッドがありません</p>`;
}

// 「解説を見る」クリックの委譲。render()がinnerHTMLを丸ごと差し替えるため、要素自体には
// リスナーを付けず、常に存在するthreadListに1回だけ付ける。
document.getElementById("threadList").addEventListener("click", (e) => {
  const btn = e.target.closest(".detail-toggle");
  if (!btn) return;
  const id = btn.dataset.id;
  const meta = htmlDocsMeta.get(id);
  if (!meta) return;
  meta.expanded = !meta.expanded;
  if (meta.expanded && meta.docs === null) {
    render(); // まず「読み込み中…」を出す
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

// 見出し・説明文はcopy.jsonから読む(ba-289後の再構成で認識がずれたため、コードを触らず
// このファイルだけ書き換えれば文言を直せるようにした)。失敗してもページ全体は止めない。
fetch("copy.json")
  .then((r) => r.json())
  .then((c) => {
    if (c.title) document.getElementById("pageTitle").textContent = c.title;
    if (c.lede) document.getElementById("pageLede").textContent = c.lede;
  })
  .catch(() => {});
