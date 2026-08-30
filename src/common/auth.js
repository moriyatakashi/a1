const STORAGE_KEY = "aa_credential";
const GOOGLE_TOKEN_SESSION_MS = 60 * 60 * 1000;
const LOGIN_EVENT = window.AA_AUTH_EVENT || "aa-login-success";
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
function renderLoginLink() {
  createCornerLink("aa-login-link", "ログイン", (e) => {
    e.preventDefault();
    const gate = getElement("login-gate");
    if (gate) gate.style.display = "block";
    const link = getElement("aa-login-link");
    if (link) link.remove();
  });
}
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
function suppressAutoPromptWhenGsiReady(retriesLeft = 100) {
  if (window.google && window.google.accounts && window.google.accounts.id) {
    window.google.accounts.id.disableAutoSelect();
    return;
  }
  if (retriesLeft <= 0) return;
  setTimeout(() => suppressAutoPromptWhenGsiReady(retriesLeft - 1), 50);
}
function persistSession(credential, name, kind) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ credential, name, kind, savedAt: Date.now() }));
}
async function exchangeForPersistentSession(googleCredential) {
  const base = window.AA_API_BASE;
  if (!base) return null;
  try {
    const res = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: googleCredential }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.sessionToken || null;
  } catch (e) {
    return null;
  }
}
window.handleCredentialResponse = async (response) => {
  try {
    const payload = decodeJwtPayload(response.credential);
    const name = payload.name || "";
    const sessionToken = await exchangeForPersistentSession(response.credential);
    if (sessionToken) {
      persistSession(sessionToken, name, "session");
      activateSession(sessionToken, name);
    } else {
      persistSession(response.credential, name, "google");
      activateSession(response.credential, name);
    }
  } catch (e) {
    window.__loginState = { loggedIn: false, error: String(e) };
    setText("status", "ログインに失敗しました");
  }
};
window.aaLogout = async () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { credential, kind } = JSON.parse(raw);
      if (kind === "session" && credential && window.AA_API_BASE) {
        await fetch(`${window.AA_API_BASE}/session`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential }),
        }).catch(() => {});
      }
    }
  } finally {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
};
(function restoreSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const { credential, savedAt, kind, name } = JSON.parse(raw);
    if (!credential) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (kind !== "session" && (!savedAt || Date.now() - savedAt > GOOGLE_TOKEN_SESSION_MS)) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    let displayName = name || "";
    if (kind !== "session") {
      try {
        displayName = name || decodeJwtPayload(credential).name || "";
      } catch (e) {
        displayName = name || "";
      }
    }
    activateSession(credential, displayName);
    suppressAutoPromptWhenGsiReady();
  } catch (e) {
    localStorage.removeItem(STORAGE_KEY);
  }
})();
if (window.AA_PUBLIC_VIEW && !(window.__loginState && window.__loginState.loggedIn)) {
  setDisplay("content", "block");
  setDisplay("login-gate", "none");
  renderLoginLink();
  suppressAutoPromptWhenGsiReady();
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
      window.dispatchEvent(new CustomEvent(LOGIN_EVENT));
    });
  } else {
    window.dispatchEvent(new CustomEvent(LOGIN_EVENT));
  }
}
