// e2e 用: gstatic の Firebase SDK(app / firestore / auth)を、ネットワークに出ない小さな偽モジュールに差し替える。
// ab-24(2026-09-29)で m1 の毎日スコアが Firestore 直になったため。scores は { "YYYY-MM-DD": {score, note} }。
// setDoc で書いたものは window.__fsWrites に積む(書き込みの中身を確かめるとき用)。scores 以外は others の
// { コレクション名: { id: 中身 } }(ab-43 のチェック項目 scoreConfig / scoreItems など)。
// 書き込みは scores のものだけ __fsWrites に、それ以外は window.__fsOtherWrites に { col, id, ...中身 } で積む。
// writeBatch(ab-53 の訪問)は commit のときに setDoc と同じく書く。
const BASE = "https://www.gstatic.com/firebasejs/";

function modules(scores, others) {
  return {
    "firebase-app.js": "export function initializeApp(config) { return { config }; }",
    "firebase-firestore.js": `
      const C = ${JSON.stringify({ ...others, scores })};
      const col_ = (name) => (C[name] = C[name] || {});
      let seq = 0;
      export const getFirestore = () => ({});
      export const collection = (db, name) => ({ name });
      export const doc = (db, name, id) => ({ name, id });
      export async function getDoc(ref) { const d = col_(ref.name)[ref.id]; return { exists: () => !!d, data: () => d }; }
      export async function getDocs(col) { return { docs: Object.entries(col_(col.name)).map(([id, d]) => ({ id, data: () => d })) }; }
      function record(name, id, data) {
        if (name === "scores") window.__fsWrites = (window.__fsWrites || []).concat([{ id, ...data }]);
        else window.__fsOtherWrites = (window.__fsOtherWrites || []).concat([{ col: name, id, ...data }]);
      }
      export async function setDoc(ref, data, opts) {
        const S = col_(ref.name);
        S[ref.id] = opts && opts.merge ? { ...(S[ref.id] || {}), ...data } : data;
        record(ref.name, ref.id, data);
      }
      export function writeBatch(db) {
        const ops = [];
        return { set: (ref, data) => { ops.push([ref, data]); }, commit: async () => { for (const [r, d] of ops) await setDoc(r, d); } };
      }
      export async function addDoc(col, data) {
        const id = "auto" + (++seq);
        col_(col.name)[id] = data;
        record(col.name, id, data);
        return { id };
      }`,
    "firebase-auth.js": `
      const auth = { currentUser: null, authStateReady: async () => {} };
      export const getAuth = () => auth;
      export class GoogleAuthProvider { static credential(t) { return { t }; } }
      export async function signInWithCredential(a, c) { auth.currentUser = { uid: "test" }; return { user: auth.currentUser }; }
      export async function signInWithPopup(a, p) { auth.currentUser = { uid: "test" }; return { user: auth.currentUser }; }`,
  };
}

export async function routeFirebaseStub(page, scores, others = {}) {
  const mods = modules(scores, others);
  await page.route(new RegExp("^" + BASE.replace(/[./]/g, "\\$&") + "[^/]+/(firebase-[a-z]+\\.js)$"), (route) => {
    const name = route.request().url().split("/").pop();
    route.fulfill({ contentType: "text/javascript", body: mods[name] || "" });
  });
}
