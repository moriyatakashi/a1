// common/auth.js — m1/n2/n4で共通のログインゲート実装(2026-07-13 共通化)
// GSIのdata-callbackから呼ばれる。ログイン成功後、呼び出し元ページが待っている
// カスタムイベント(window.AA_AUTH_EVENTで指定、未指定時は"aa-login-success")を発火する。
// 各ページのindex.htmlは、このスクリプトを読み込む前に
//   <script>window.AA_AUTH_EVENT = "n4-login-success";</script>
// のように1行だけ書けばよい(app.js側の待受けイベント名を変えずに済むための互換用)。
//
// atob()だけだと日本語名などマルチバイト文字が文字化けするため、UTF-8として明示的にデコードする。
// 書き込み(人間レーン)にはGoogle IDトークン自体をab-board-api側で検証するため、
// デコード結果だけでなく生のcredentialもwindow.__credentialに保持しておく。
//
// (以下 4行は 2026-07-19〜10-10 の Azure の頃の話。今は下の ab-166 の段落)
// 永続認証移行(ba-XX, 2026-07-19): Googleの生IDトークンは約1時間しか有効でないため、
// ログイン成功時にAA_API_BASE/session(POST)へ渡してサーバー発行の無期限セッション
// トークン("session:<id>.<署名>")に交換し、以後はそちらをwindow.__credentialとして使う。
// サーバー側が未対応(SESSION_SECRET未設定・通信不可等)の場合は、従来どおり生の
// Googleトークンを60分だけ保持するフォールバックに自動的に倒れる(段階移行を安全にするため)。
// 無期限トークンはログアウト(window.aaLogout、またはサーバー側の失効)でのみ失効する。
// m1/n2/n4で共通のキーを使うため、いずれか1つでログインすれば他も再ログイン不要になる。
// ab-162(2026-10-10): ログインの幕を通すのは持ち主(Takashi)のアカウントだけ。
// Google のトークンのメールを sha256 で持ち主と比べる(公開レポなのでメールそのものは書かない)。
// (10/10 までは Azure の /session が先に判定し、使えないときだけこれで見ていた)
// これは画面の幕で、本当の守りは Firestore の Rules とサーバー側(ab-162 段2〜4)。テストは window.AA_OWNER_EMAIL_SHA256 で差し替える。
//
// 2026-10-10(ab-166 ④、Takashi「A」): Azure の /session をやめた(Azure をなくすため)。
// - 持ち主かどうかは、Google のトークンのメール(sha256)で見る(上の判定を常に使う)
// - ログインを覚えておくのは Firebase のログインに任せる(端末に残る。ログアウトするまで切れない)。幕を開けたあと、
//   裏で Google のトークンを Firebase に渡してログインしておく(読み書きの前のログイン ensureReadLogin と同じ道)
// - 保存するのは「ログイン済み」の印だけ(kind:"firebase"、トークンは保存しない)。前の kind:"session"(Azure の無期限トークン)が
//   残っている端末は、ログアウトさせずにそのまま入れて、印を書き換える
// - window.__credential は「ログイン済みか」の印としてだけ残す(中身はどこにも送らない)
const OWNER_EMAIL_SHA256 = "53b299b790f73429d69af153213ea0a61e2ef6b4a61f03d36b9acb22510a5ca8";
const NOT_OWNER_MESSAGE = "このアカウントでは使えません(持ち主のアカウントでログインしてください)";
const STORAGE_KEY = "aa_credential";
const GOOGLE_TOKEN_SESSION_MS = 60 * 60 * 1000; // フォールバック(生Googleトークン)のみに適用
const LOGIN_EVENT = window.AA_AUTH_EVENT || "aa-login-success";
const LOGGED_IN_MARK = "firebase-login"; // window.__credential に入れる印(送らない)
// firebase.js の場所。auth.js は普通の script なので、読み込まれた時点の自分の URL から決める(ページの深さに依らない)
const FIREBASE_JS = (() => {
  try { return new URL("firebase.js", document.currentScript.src).href; } catch (e) { return null; }
})();
const loadFirebase = () => (FIREBASE_JS ? import(FIREBASE_JS) : Promise.reject(new Error("firebase.js の場所が分からない")));

function getElement(id) {
  return typeof document !== "undefined" ? document.getElementById(id) : null;
}

function setDisplay(id, display) {
  const el = getElement(id);
  if (el) el.style.display = display;
}

function setText(id, text) {
  const el = getElement(id);
  if (el) el.textContent = text;
}

const CORNER_LINK_STYLE =
  "position:fixed; top:8px; right:8px; font-size:0.72rem; color:#888; " +
  "background:rgba(0,0,0,0.35); padding:3px 8px; border-radius:5px; z-index:1000; text-decoration:none;";

function createCornerLink(id, text, onClick) {
  if (!document || !document.body) return null;
  if (document.getElementById(id)) return null;
  const a = document.createElement("a");
  a.id = id;
  a.href = "#";
  a.textContent = text;
  a.className = "aa-corner-link";
  a.style.cssText = CORNER_LINK_STYLE;
  a.addEventListener("click", onClick);
  document.body.appendChild(a);
  return a;
}

function decodeJwtPayload(credential) {
  if (typeof credential !== "string") throw new Error("Invalid credential");
  const parts = credential.split(".");
  if (parts.length < 2 || !parts[1]) throw new Error("Invalid credential");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch (e) {
    throw new Error("Invalid credential");
  }
}

// ba-35残課題(2、2026-07-20): 閲覧はログイン不要にするページ向けの表示モード。
// ページ側が<script>window.AA_PUBLIC_VIEW = true;</script>を1行足すだけで有効化する
// (未指定なら既定でfalse相当=従来通りのゲート必須動作、baは対象外のため無変更)。
function renderLoginLink() {
  createCornerLink("aa-login-link", "ログイン", (e) => {
    e.preventDefault();
    const gate = getElement("login-gate");
    if (gate) gate.style.display = "block";
    const link = getElement("aa-login-link");
    if (link) link.remove();
  });
}

// ba-35残課題(2) Stage5: 公開閲覧モードで書き込みを試みた際、ログインへ誘導するための
// 共通ヘルパー。「ログイン」リンクをクリックした時と同じ操作(フルゲート表示)を行う。
window.aaShowLoginGate = () => {
  const link = document.getElementById("aa-login-link");
  if (link) link.remove();
  const gate = getElement("login-gate");
  if (gate) gate.style.display = "block";
};

function renderLogoutLink() {
  createCornerLink("aa-logout-link", "ログアウト", (e) => {
    e.preventDefault();
    window.aaLogout();
  });
}

function activateSession(credential, name) {
  window.__loginState = { loggedIn: true, name: name || "" };
  window.__credential = credential;
  setDisplay("login-gate", "none");
  setDisplay("content", "block");
  renderLogoutLink();
  window.dispatchEvent(new CustomEvent(LOGIN_EVENT));
}

// issue #9対応の踏襲: 自前セッション復元後もGoogle One Tapが自動プロンプトを出してくる問題への対処。
// GSIスクリプトの読み込み完了を(onloadイベントに頼らずポーリングで)待ってから、
// 公式APIのdisableAutoSelect()で自動サインインだけを止める。
function suppressAutoPromptWhenGsiReady(retriesLeft = 100) {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
    return;
  }
  if (retriesLeft <= 0) return;
  setTimeout(() => suppressAutoPromptWhenGsiReady(retriesLeft - 1), 50);
}

function persistSession(name) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ kind: "firebase", name, savedAt: Date.now() }));
}

// 幕を開けたあと、裏で Firebase にログインしておく(次から端末が覚えている)。失敗しても幕は開いたまま
// (読むときに入れなければ「読むためにログイン」の帯が出る)。
function signInFirebaseInBackground(googleCredential) {
  loadFirebase()
    .then((m) => m.signInWithGoogleIdToken(googleCredential))
    .catch((e) => console.warn("Firebase へのログインに失敗(読むときにもう一度試す)", e));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Google のトークンの中身(payload)が持ち主のものか。メール確認済みであることも見る
async function isOwnerPayload(payload) {
  if (!payload || !payload.email) return false;
  if (payload.email_verified !== true && payload.email_verified !== "true") return false;
  const want = window.AA_OWNER_EMAIL_SHA256 || OWNER_EMAIL_SHA256;
  return (await sha256Hex(String(payload.email).trim().toLowerCase())) === want;
}

window.handleCredentialResponse = async (response) => {
  try {
    const payload = decodeJwtPayload(response.credential);
    const name = payload.name || "";
    if (!(await isOwnerPayload(payload))) {
      setText("status", NOT_OWNER_MESSAGE);
      return;
    }
    // ab-24: Firebase にログインするときに渡す生のIDトークン。メモリだけに置き、保存はしない(寿命1時間)。
    window.__googleIdToken = response.credential;
    persistSession(name);
    activateSession(LOGGED_IN_MARK, name);
    signInFirebaseInBackground(response.credential);
  } catch (e) {
    window.__loginState = { loggedIn: false, error: String(e) };
    setText("status", "ログインに失敗しました");
  }
};

// 明示的なログアウト。Firebase からもログアウトしてから、ローカルの印を消してページを再読み込みする(ログインゲートに戻すため)。
window.aaLogout = async () => {
  try {
    await loadFirebase().then((m) => m.signOutFirebase()).catch(() => {});
  } finally {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
};

// ページ読み込み時、保存済みのログインの印があれば幕を開ける。
// kind:"firebase"(今の印)と kind:"session"(Azure の無期限トークンの頃の印、ab-166 で印を書き換える)は期限なし
// (切れるのはログアウトしたとき)。kind:"google"(生の Google トークン)は60分で切る(トークンの寿命に合わせる)。
(function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const { credential, savedAt, kind, name } = JSON.parse(raw);
    const lasting = kind === "firebase" || (kind === "session" && credential);
    if (!lasting && (!credential || !savedAt || Date.now() - savedAt > GOOGLE_TOKEN_SESSION_MS)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    let displayName = name || "";
    if (!lasting) {
      try {
        displayName = name || decodeJwtPayload(credential).name || "";
      } catch (e) {
        displayName = name || "";
      }
    }
    if (kind === "session") persistSession(displayName); // Azure の頃の印を書き換える(トークンは捨てる)
    if (kind === "google") window.__googleIdToken = credential; // 60分以内なら、読むときの Firebase ログインに使える
    activateSession(LOGGED_IN_MARK, displayName);
    suppressAutoPromptWhenGsiReady();
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
  }
})();

// ba-35残課題(2): ログイン済み(restoreSessionで復元済み)でなければ、公開閲覧モードの
// ページでは即#contentを表示し、フルゲートの代わりに小さな「ログイン」リンクを出す。
// window.__credential/__loginStateはここでは設定しない(未ログインのまま=書き込みは
// 各ページ側でcredential有無を見て個別にログインを促す、ba-35 Stage5参照)。
if (window.AA_PUBLIC_VIEW && !(window.__loginState && window.__loginState.loggedIn)) {
  setDisplay("content", "block");
  setDisplay("login-gate", "none");
  renderLoginLink();
  suppressAutoPromptWhenGsiReady();
  // app.js(type="module")はauth.js(通常script)より後に実行されるため、ここで即dispatchすると
  // リスナー登録前にイベントが握りつぶされる。DOMContentLoadedまで待てば、moduleを含む
  // 全scriptの評価が完了している(HTML仕様上、DOMContentLoadedはdeferred/module実行後に発火)。
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      window.dispatchEvent(new CustomEvent(LOGIN_EVENT));
    });
  } else {
    window.dispatchEvent(new CustomEvent(LOGIN_EVENT));
  }
}
