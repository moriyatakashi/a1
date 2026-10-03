// quiz-point.js — m6 の県あてクイズの加点(ab-44、2026-10-03 Takashi「50回あてて1ポイントくらい、数日で1ポイントでもいい」)。
// 正解はこの端末にためておき(localStorage)、50 たまったら pointEvents に1点を1件書く(訪問の初訪問加点と同じ置き場)。
// 書くのは Takashi 本人だけ(Rules)。書けなかったら正解はためたままにして、次の回の終わりにまた試す。
// Firebase は書くときだけ読み込む(クイズを解くだけなら要らない)。

export const PER_POINT = 50;
const BANK_KEY = "m6.quizBank";

export function loadBank() {
  try { return Math.max(0, Number(localStorage.getItem(BANK_KEY)) || 0); } catch { return 0; }
}
export function saveBank(n) {
  try { localStorage.setItem(BANK_KEY, String(n)); } catch { /* 覚えられなくても遊べる */ }
}

// 1点書く。成功したら true。
export async function writeQuizPoint() {
  const [{ doc, setDoc }, { db, ensureFirebaseLogin }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js"), import("../common/firebase.js"),
  ]);
  await ensureFirebaseLogin();
  await setDoc(doc(db, "pointEvents", crypto.randomUUID()), {
    axis: "地図クイズ", points: 1, note: `県あてクイズ 正解${PER_POINT}`, period: "week", catalogId: "map_quiz",
    createdAt: new Date().toISOString(), by: "takashi",
  });
  return true;
}
