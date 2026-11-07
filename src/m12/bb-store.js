// bb-store.js — bb(伊呂波家の台帳、Firestore の bbThreads)を m12(メモ2)から書く・読む・閉じる(2026-11-07 Takashi)。
// 形は m3 の af-store.js と同じ。読み・書きとも Takashi 本人だけ(Rules の isTakashi、ledgers.json の takashiWrites)。
// 番号(seq)は _meta/bb_seq を1つ進めるのと同じトランザクションで決める(aa-lane と同じカウンタ。番号が重ならない)。
// 種類(kind)はメモに固定。固定作業の頭の文字は題に手で書く。

const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const load = () => Promise.all([import(SDK), import("../common/firebase.js")]);

const BY = "takashi";
const KIND = "メモ";

// 開いているもの(済みでない)を番号の新しい順で
export async function fetchOpenBb() {
  const [{ collection, getDocs, query, where }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(query(collection(db, "bbThreads"), where("done", "==", false))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
}

// note の本文を古い順で(bbjob の返事もここで読む、af-139)
export async function fetchBbNotes(id) {
  const [{ collection, getDocs }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "bbThreads", id, "notes")));
  return snap.docs.map((d) => d.data()).sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

export async function createBb({ title, body = "" }) {
  const [{ collection, doc, runTransaction }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const counterRef = doc(db, "_meta", "bb_seq");
  const threadRef = doc(collection(db, "bbThreads"));
  const seq = await runTransaction(db, async (tx) => {
    const cur = await tx.get(counterRef);
    const next = cur.exists() ? Number(cur.data().value) + 1 : 1;
    tx.set(counterRef, { value: next });
    tx.set(threadRef, {
      title, body, kind: KIND, related: [], done: false, by: BY,
      createdAt: new Date().toISOString(), noteMeta: [], seq: next,
    });
    return next;
  });
  return { id: threadRef.id, seq };
}

export async function doneBb(id) {
  const [{ doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  await updateDoc(doc(db, "bbThreads", id), { done: true, doneBy: BY, doneAt: new Date().toISOString() });
}

export async function addBbNote(id, text) {
  const [{ addDoc, arrayUnion, collection, doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const createdAt = new Date().toISOString();
  await addDoc(collection(db, "bbThreads", id, "notes"), { body: text, by: BY, createdAt });
  await updateDoc(doc(db, "bbThreads", id), { noteMeta: arrayUnion({ by: BY, createdAt, retitle: false }) });
}
