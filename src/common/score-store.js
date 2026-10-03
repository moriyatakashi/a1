// score-store.js — 毎日スコア(Firestore ab01-9f35a の scores/{日付})の読み書き。m1 と a2/x4 で共用。
// ab-24(2026-09-29、方式B): 正本は Firestore(Azure の /api/scores は書き込み 410 で停止)。
// 2026-10-02: x4 が Azure に PUT し続けて「保存に失敗しました」になっていたため、m1 の実装をここへ切り出して共用にした。
// 読みは誰でも(Rules)。書きは Takashi 本人のみ(Rules の isTakashi)で、Firebase Auth のログインが要る。
// Firebase の初期化とログインは common/firebase.js(visit-store.js と共用、ab-53 で切り出し)。
import { collection, doc, getDoc, getDocs, setDoc, addDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureFirebaseLogin, saveErrorText } from "./firebase.js";

export { saveErrorText };

export const SCORE_MIN = 0;
export const SCORE_MAX = 120; // ab-43: 100=感覚の満点、超えた分はそれ以上やった分(Rules も 120)

export async function fetchScore(date) {
  const snap = await getDoc(doc(db, "scores", date));
  return snap.exists() ? snap.data() : null;
}

export async function fetchAllScores() {
  const snap = await getDocs(collection(db, "scores"));
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }));
}

// check(任意、ab-43)= { items: [{id, text, done}], score(0〜100), at }。merge で書くので、
// check を渡さない保存(x4 など)でも同じ日の check は消えない。
export async function saveScore(date, score, note, check) {
  await ensureFirebaseLogin();
  const data = { score, note, createdAt: new Date().toISOString(), by: "takashi" };
  if (check) data.check = check;
  await setDoc(doc(db, "scores", date), data, { merge: true });
}

// --- チェック項目(2026-10-03、ab-43) ---
// 棚 scoreItems/{id} = {text, createdAt, by}(消さずに貯めて使い回す)、今の項目 scoreConfig/current = {items: [{id, text}], at, by}。
// 家人(利尻など)は b1/run score items set で、Takashi は m1 の画面から入れ替える。
export async function fetchCheckItems() {
  const snap = await getDoc(doc(db, "scoreConfig", "current"));
  return snap.exists() ? (snap.data().items || []) : [];
}

export async function fetchItemShelf() {
  const snap = await getDocs(collection(db, "scoreItems"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 今の項目を入れ替える。棚に同じ文面があれば使い回し、無ければ棚に足す。
export async function saveCheckItems(texts) {
  await ensureFirebaseLogin();
  const shelf = await fetchItemShelf();
  const now = new Date().toISOString();
  const items = [];
  for (const text of texts) {
    const hit = shelf.find((s) => s.text === text);
    const id = hit ? hit.id : (await addDoc(collection(db, "scoreItems"), { text, createdAt: now, by: "takashi" })).id;
    items.push({ id, text });
  }
  await setDoc(doc(db, "scoreConfig", "current"), { items, at: now, by: "takashi" });
  return items;
}

// 押した数から点を出す(全部押せば100)。
export function checkScore(items) {
  return items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0;
}
