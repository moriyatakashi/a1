// e2e 用: gstatic の Firebase SDK(app / firestore / auth)を、ネットワークに出ない小さな偽モジュールに差し替える。
// ab-24(2026-09-29)で m1 の毎日スコアが Firestore 直になったため。scores は { "YYYY-MM-DD": {score, note} }。
// setDoc で書いたものは window.__fsWrites に積む(書き込みの中身を確かめるとき用)。scores 以外は others の
// { コレクション名: { id: 中身 } }(ab-43 のチェック項目 scoreConfig / scoreItems など)。
// 書き込みは scores のものだけ __fsWrites に、それ以外は window.__fsOtherWrites に { col, id, ...中身 } で積む。
// writeBatch(ab-53 の訪問)は commit のときに setDoc と同じく書く。query+where は == だけ(ab-95、全件読みを絞る形)。
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
      // COUNT 集計(ab-97 のまとめ文書の照合)。数えたコレクション名を window.__fsCounts に積む
      export async function getCountFromServer(col) {
        window.__fsCounts = (window.__fsCounts || []).concat([col.name]);
        return { data: () => ({ count: Object.keys(col_(col.name)).length }) };
      }
      // arrayUnion / increment は setDoc(merge)のときだけ効かせる(ab-97 のまとめ文書に1件足す形)
      export const arrayUnion = (...values) => ({ __op: "arrayUnion", values });
      export const increment = (n) => ({ __op: "increment", n });
      function applyOps(old, data) {
        const out = { ...(old || {}) };
        for (const [k, v] of Object.entries(data)) {
          if (v && v.__op === "arrayUnion") out[k] = [...(out[k] || []), ...v.values];
          else if (v && v.__op === "increment") out[k] = (out[k] || 0) + v.n;
          else out[k] = v;
        }
        return out;
      }
      // query(collection, where(...)) は == だけ(読む件数を絞る形を確かめる用)。
      export const where = (field, op, value) => ({ field, op, value });
      export const query = (col, ...conds) => ({ name: col.name, conds });
      // 読んだコレクション名を window.__fsReads に積む(全件読みの回数を確かめる用、ab-97)
      export async function getDocs(col) {
        // ab-162: Rules で読めない(本人でない/ログインしていない)ときの形。window.__fsDenyRead に名前を入れると、そのコレクションは読めない
        if ((window.__fsDenyRead || []).includes(col.name) && !window.__fsSignedIn) {
          const e = new Error("Missing or insufficient permissions."); e.code = "permission-denied"; throw e;
        }
        window.__fsReads = (window.__fsReads || []).concat([col.name]);
        const ok = (d) => (col.conds || []).every((c) => c.op === "==" && d[c.field] === c.value);
        return { docs: Object.entries(col_(col.name)).filter(([, d]) => ok(d)).map(([id, d]) => ({ id, data: () => d })) };
      }
      function record(name, id, data) {
        if (name === "scores") window.__fsWrites = (window.__fsWrites || []).concat([{ id, ...data }]);
        else window.__fsOtherWrites = (window.__fsOtherWrites || []).concat([{ col: name, id, ...data }]);
      }
      export async function setDoc(ref, data, opts) {
        const S = col_(ref.name);
        S[ref.id] = opts && opts.merge ? applyOps(S[ref.id], data) : data;
        record(ref.name, ref.id, data);
      }
      // deleteDoc(ab-84 の願望マップ、2026-10-04)は window.__fsDeletes に { col, id } で積む。
      export async function deleteDoc(ref) {
        delete col_(ref.name)[ref.id];
        window.__fsDeletes = (window.__fsDeletes || []).concat([{ col: ref.name, id: ref.id }]);
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
      // window.__fsSignedIn(addInitScript で立てる)なら、開いた時点でログイン済みにする(ab-97 のまとめの作り直し)
      const testUser = () => ({ uid: "test", getIdToken: async () => "test-id-token" }); // ab-162: bc が読むときに付ける
      const auth = { currentUser: window.__fsSignedIn ? testUser() : null, authStateReady: async () => {} };
      export const getAuth = () => auth;
      export class GoogleAuthProvider { static credential(t) { return { t }; } }
      export async function signInWithCredential(a, c) { if (window.__fsCredentialFails) throw new Error("credential"); auth.currentUser = testUser(); window.__fsSignedIn = true; return { user: auth.currentUser }; }
      export async function signInWithPopup(a, p) { auth.currentUser = testUser(); window.__fsSignedIn = true; return { user: auth.currentUser }; }`,
  };
}

export async function routeFirebaseStub(page, scores, others = {}) {
  const mods = modules(scores, others);
  await page.route(new RegExp("^" + BASE.replace(/[./]/g, "\\$&") + "[^/]+/(firebase-[a-z]+\\.js)$"), (route) => {
    const name = route.request().url().split("/").pop();
    route.fulfill({ contentType: "text/javascript", body: mods[name] || "" });
  });
}
