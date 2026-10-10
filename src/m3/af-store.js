// af-store.js — af(「ほぼba」、Firestore の afThreads)を m3 から書く・読む・閉じる(ab-161、2026-10-10 Takashi 決定)。
// 読み・書きとも Takashi 本人だけ(Rules の isTakashi)。家人は aa-lane(鍵)から書く。番号(seq)は _meta/af_seq を
// 1つ進めるのと同じトランザクションで決める(aa-lane と同じカウンタ。番号が重ならない)。
// 直すのは「済み」と noteMeta(note を足した印)だけ。書き足しは note で。
// Firebase は使うときだけ読み込む(wish-store.js と同じ)。

const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const load = () => Promise.all([import(SDK), import("../common/firebase.js")]);

const BY = "takashi";

// 開いているもの(済みでない)を番号の新しい順で
export async function fetchOpenAf() {
  const [{ collection, getDocs, query, where }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(query(collection(db, "afThreads"), where("done", "==", false))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
}

// 新しく作る。返すのは {id, seq}
export async function createAf({ title, body = "", tags = [] }) {
  const [{ collection, doc, runTransaction }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const counterRef = doc(db, "_meta", "af_seq");
  const threadRef = doc(collection(db, "afThreads"));
  const seq = await runTransaction(db, async (tx) => {
    const cur = await tx.get(counterRef);
    const next = cur.exists() ? Number(cur.data().value) + 1 : 1;
    tx.set(counterRef, { value: next });
    tx.set(threadRef, {
      title, body, tags: tags.slice(0, 10), related: [], done: false, by: BY,
      createdAt: new Date().toISOString(), noteMeta: [], seq: next,
    });
    return next;
  });
  return { id: threadRef.id, seq };
}

export async function doneAf(id) {
  const [{ doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  await updateDoc(doc(db, "afThreads", id), { done: true, doneBy: BY, doneAt: new Date().toISOString() });
}

export async function addAfNote(id, text) {
  const [{ addDoc, arrayUnion, collection, doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const createdAt = new Date().toISOString();
  await addDoc(collection(db, "afThreads", id, "notes"), { body: text, by: BY, createdAt });
  await updateDoc(doc(db, "afThreads", id), { noteMeta: arrayUnion({ by: BY, createdAt, retitle: false }) });
}

// af のタグは空白・カンマなしの短い語(aa-lane と同じ)
export function cleanAfTags(tags) {
  return (tags || []).map((t) => String(t).replace(/^#/, "").trim()).filter((t) => t && !/[\s,]/.test(t) && t.length <= 30).slice(0, 10);
}

export const isDenied = (e) => !!e && (e.code === "permission-denied" || /PERMISSION_DENIED|insufficient permissions/i.test(e.message || ""));
