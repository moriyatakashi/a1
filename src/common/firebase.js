// firebase.js — Firebase ab01-9f35a の初期化と、書き込み前のログイン。score-store.js(毎日スコア)と
// visit-store.js(訪問、ab-53)で共用する(initializeApp を2回呼ぶとエラーになるので、ここで1回だけ)。
// 読みは誰でも(Rules)。書きは Takashi 本人のみ(Rules の isTakashi)で、Firebase Auth のログインが要る。
// ログインは GSI のIDトークンがあればそれを渡し(Firebase 側で m1 のクライアントIDを許可済み)、無ければポップアップ。
// Firebase 側がログインを覚えるので、ポップアップは初回だけ。apiKey は公開前提の値(認可は Firestore の rules 側)。
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithCredential, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";

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

// ab-166 ④(2026-10-10): ログインの幕(common/auth.js)が開いたあとに呼ぶ。Azure の /session の代わりに、
// Firebase のログインを端末に覚えておいてもらう。済んでいればそのまま。
export async function signInWithGoogleIdToken(idToken) {
  if (!authReady) await fbAuth.authStateReady();
  if (fbAuth.currentUser) return fbAuth.currentUser;
  return (await signInWithCredential(fbAuth, GoogleAuthProvider.credential(idToken))).user;
}

// ab-166 ④: ログアウト(auth.js の aaLogout から)
export function signOutFirebase() {
  return signOut(fbAuth);
}

// ab-162(2026-10-10): 読む前のログイン。いずれ Rules の読みを Takashi 本人だけに絞るので、読む側も先にログインしておく。
// 書くときと違い、ポップアップは出さない(ページを開いただけで出すとブロックされるうえ煩わしい)。
// ログイン済みならそのまま、GSI のIDトークンがあればそれで入る。どちらも無ければ null(今の Rules では匿名でも読める)。
export async function ensureReadLogin() {
  try {
    if (!authReady) await fbAuth.authStateReady();
    if (fbAuth.currentUser) return fbAuth.currentUser;
    if (window.__googleIdToken) {
      return (await signInWithCredential(fbAuth, GoogleAuthProvider.credential(window.__googleIdToken))).user;
    }
  } catch (e) {
    console.warn("読むための Firebase ログインに失敗(匿名で読む)", e);
  }
  return null;
}

// ab-162: Rules の読みを本人だけに絞ったあと、この端末で Firebase にログインしていないと読めない(permission-denied)。
// そのときだけ、画面の上に「読むためにログイン」の帯を1回出す。押すとポップアップでログインし、読み直す(再読み込み)。
let readLoginBannerShown = false;
export function isReadDenied(e) {
  return !!e && (e.code === "permission-denied" || e.status === 403 || /PERMISSION_DENIED|Missing or insufficient permissions/i.test(e.message || ""));
}
export function showReadLoginBanner() {
  if (readLoginBannerShown || typeof document === "undefined" || !document.body) return;
  readLoginBannerShown = true;
  const bar = document.createElement("div");
  bar.id = "aa-read-login";
  bar.setAttribute("role", "alert");
  bar.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2000;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;"
    + "padding:10px 16px calc(10px + env(safe-area-inset-top,0px));background:#1d2a3a;color:#fff;font-size:0.9rem;";
  const msg = document.createElement("span");
  msg.textContent = "データを読むには、この端末でもう一度ログインが要ります";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "ログインして読み直す";
  btn.style.cssText = "padding:6px 14px;border-radius:6px;border:1px solid #fff;background:#fff;color:#1d2a3a;font-weight:700;cursor:pointer;";
  btn.addEventListener("click", async () => {
    try {
      await signInWithPopup(fbAuth, new GoogleAuthProvider());
      location.reload();
    } catch (e) {
      msg.textContent = saveErrorText(e);
    }
  });
  bar.append(msg, btn);
  document.body.appendChild(bar);
}
// 読む処理を包む: 読めなかった理由が「本人でない/ログインしていない」なら帯を出してから、そのまま投げ直す
export async function guardRead(fn) {
  try {
    return await fn();
  } catch (e) {
    if (isReadDenied(e)) showReadLoginBanner();
    throw e;
  }
}

// 失敗したときに画面に出す文。Firebase のエラーコードを人が読める形にする。
export function saveErrorText(e) {
  const code = (e && e.code) || "";
  if (code === "auth/popup-blocked") return "エラー: ログイン画面がブロックされました。もう一度「保存」を押してください";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "ログインが中断されました。もう一度「保存」を押してください";
  if (code === "permission-denied") return "エラー: 保存の権限がありません(Takashi のアカウントでログインしてください)";
  return "エラー: " + ((e && e.message) || String(e)) + (code ? ` (${code})` : "");
}
