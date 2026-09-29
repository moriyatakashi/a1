// e2e 用: gstatic の Firebase SDK(app / firestore / auth)を、ネットワークに出ない小さな偽モジュールに差し替える。
// ab-24(2026-09-29)で m1 の毎日スコアが Firestore 直になったため。scores は { "YYYY-MM-DD": {score, note} }。
// setDoc で書いたものは window.__fsWrites に積む(書き込みの中身を確かめるとき用)。
const BASE = "https://www.gstatic.com/firebasejs/";

function modules(scores) {
  return {
    "firebase-app.js": "export function initializeApp(config) { return { config }; }",
    "firebase-firestore.js": `
      const S = ${JSON.stringify(scores)};
      export const getFirestore = () => ({});
      export const collection = (db, name) => ({ name });
      export const doc = (db, name, id) => ({ name, id });
      export async function getDoc(ref) { const d = S[ref.id]; return { exists: () => !!d, data: () => d }; }
      export async function getDocs(col) { return { docs: Object.entries(S).map(([id, d]) => ({ id, data: () => d })) }; }
      export async function setDoc(ref, data) {
        S[ref.id] = data;
        window.__fsWrites = (window.__fsWrites || []).concat([{ id: ref.id, ...data }]);
      }`,
    "firebase-auth.js": `
      const auth = { currentUser: null, authStateReady: async () => {} };
      export const getAuth = () => auth;
      export class GoogleAuthProvider { static credential(t) { return { t }; } }
      export async function signInWithCredential(a, c) { auth.currentUser = { uid: "test" }; return { user: auth.currentUser }; }
      export async function signInWithPopup(a, p) { auth.currentUser = { uid: "test" }; return { user: auth.currentUser }; }`,
  };
}

export async function routeFirebaseStub(page, scores) {
  const mods = modules(scores);
  await page.route(new RegExp("^" + BASE.replace(/[./]/g, "\\$&") + "[^/]+/(firebase-[a-z]+\\.js)$"), (route) => {
    const name = route.request().url().split("/").pop();
    route.fulfill({ contentType: "text/javascript", body: mods[name] || "" });
  });
}
