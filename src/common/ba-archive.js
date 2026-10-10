// common/ba-archive.js — 旧 ba(Azure の BaLog、2026-10-10 に書き込みを止めて凍結)の読むだけの写し(ab-166、2026-10-11)。
// Firestore の baArchive に1回だけ置いた(b1 infra/firebase/ab01/copy_ba_archive.py)。読みは本人だけ(Rules)。
//   baArchive/closes     … 週の点数で数える close の一覧 [{at, difficulty}](week-score.js の baCloseEvents で数えたもの)
//   baArchive/entries-N  … 生ログ(本文抜き、600件ずつ)。bc が分類・状態・作った月を数えるのに使う
// 増えないので、1回読んだらこのページの間は使い回す。
const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
let entriesPromise = null;
let closesPromise = null;

async function load() {
  const [{ doc, getDoc }, { db, ensureReadLogin, guardRead }] = await Promise.all([import(SDK), import("./firebase.js")]);
  await ensureReadLogin();
  const read = async (id) => {
    const snap = await guardRead(() => getDoc(doc(db, "baArchive", id)));
    return snap.exists() ? snap.data() : null;
  };
  return { read };
}

// 生ログ全部(entries-1 から順に、無くなるまで)
export function loadBaArchiveEntries() {
  if (!entriesPromise) {
    entriesPromise = (async () => {
      const { read } = await load();
      const out = [];
      for (let n = 1; ; n++) {
        const d = await read(`entries-${n}`);
        if (!d) break;
        out.push(...(d.items || []));
        if (d.of && n >= d.of) break;
      }
      return out;
    })().catch((e) => { entriesPromise = null; throw e; });
  }
  return entriesPromise;
}

// 週の点数で数える close の一覧
export function loadBaArchiveCloses() {
  if (!closesPromise) {
    closesPromise = load().then(({ read }) => read("closes")).then((d) => (d && d.items) || [])
      .catch((e) => { closesPromise = null; throw e; });
  }
  return closesPromise;
}
