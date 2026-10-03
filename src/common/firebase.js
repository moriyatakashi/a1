// firebase.js — Firebase ab01-9f35a の初期化と、書き込み前のログイン。score-store.js(毎日スコア)と
// visit-store.js(訪問、ab-53)で共用する(initializeApp を2回呼ぶとエラーになるので、ここで1回だけ)。
// 読みは誰でも(Rules)。書きは Takashi 本人のみ(Rules の isTakashi)で、Firebase Auth のログインが要る。
// ログインは GSI のIDトークンがあればそれを渡し(Firebase 側で m1 のクライアントIDを許可済み)、無ければポップアップ。
// Firebase 側がログインを覚えるので、ポップアップは初回だけ。apiKey は公開前提の値(認可は Firestore の rules 側)。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDuPw8nMuFWx8ghV5ZeBGETeiNII3uk4l8",
  authDomain: "ab01-9f35a.firebaseapp.com",
  projectId: "ab01-9f35a",
  storageBucket: "ab01-9f35a.firebasestorage.app",
  messagingSenderId: "502154862201",
  appId: "1:502154862201:web:4ca0c72225af6bd0147ea8",
};
const fbApp = initializeApp(firebaseConfig);
export const db = getFirestore(fbApp);
const fbAuth = getAuth(fbApp);

// ページを開いた時点で Firebase のログイン状態の復元を始めておく。保存ボタンを押したとき、
// ここが済んでいれば「ログイン済みか」を待たずに判断でき、ポップアップをタップ直後に出せる
// (スマホのブラウザは、タップから間が空いたポップアップをブロックすることがあるため)。
let authReady = false;
fbAuth.authStateReady().then(() => { authReady = true; });

export async function ensureFirebaseLogin() {
  if (!authReady) await fbAuth.authStateReady();
  if (fbAuth.currentUser) return fbAuth.currentUser;
  if (window.__googleIdToken) {
    try {
      return (await signInWithCredential(fbAuth, GoogleAuthProvider.credential(window.__googleIdToken))).user;
    } catch (e) {
      console.warn("GSIトークンでのFirebaseログインに失敗、ポップアップへ", e);
    }
  }
  return (await signInWithPopup(fbAuth, new GoogleAuthProvider())).user;
}

// 失敗したときに画面に出す文。Firebase のエラーコードを人が読める形にする。
export function saveErrorText(e) {
  const code = (e && e.code) || "";
  if (code === "auth/popup-blocked") return "エラー: ログイン画面がブロックされました。もう一度「保存」を押してください";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "ログインが中断されました。もう一度「保存」を押してください";
  if (code === "permission-denied") return "エラー: 保存の権限がありません(Takashi のアカウントでログインしてください)";
  return "エラー: " + ((e && e.message) || String(e)) + (code ? ` (${code})` : "");
}
