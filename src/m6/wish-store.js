// wish-store.js — m6 の願望マップ(ab-84 の1、2026-10-04 Takashi「すすめたい、ルールも」)。
// 行きたい場所を Firestore の wishes/{id} = {label, lat, lng, pref, createdAt, by} に置く(スマホとPCで同じものが見える)。
// 読みは誰でも、置く・外すは Takashi 本人だけ(Rules)。直すことはしない(置き直す)。かなったかどうかは書かず、訪問から決める(geo.js)。
// Firebase は使うときだけ読み込む(quiz-point.js と同じ)。

const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const load = () => Promise.all([import(SDK), import("../common/firebase.js")]);

export async function fetchWishes() {
  const [{ collection, getDocs }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin(); // ab-162
  const snap = await guardRead(() => getDocs(collection(db, "wishes")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// 置いた行きたい場所({id, ...中身})を返す。
export async function addWish({ label, lat, lng, pref }) {
  const [{ doc, setDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const id = crypto.randomUUID();
  const w = { label, lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, pref: pref || "",
    createdAt: new Date().toISOString(), by: "takashi" };
  await setDoc(doc(db, "wishes", id), w);
  return { id, ...w };
}

export async function removeWish(id) {
  const [{ doc, deleteDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  await deleteDoc(doc(db, "wishes", id));
}
