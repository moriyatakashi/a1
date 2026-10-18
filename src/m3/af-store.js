// af-store.js — af(「ほぼba」、Firestore の afThreads)を m3 から書く・読む・閉じる(ab-161、2026-10-10 Takashi 決定)。
// 読み・書きとも Takashi 本人だけ(Rules の isTakashi)。家人は aa-lane(鍵)から書く。番号(seq)は _meta/af_seq を
// 1つ進めるのと同じトランザクションで決める(aa-lane と同じカウンタ。番号が重ならない)。
// 直すのは「済み」と noteMeta(note を足した印)だけ。書き足しは note で。
// Firebase は使うときだけ読み込む(wish-store.js と同じ)。

const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const load = () => Promise.all([import(SDK), import("../common/firebase.js")]);

const BY = "takashi";

// 開いているもの(済みでない)を番号の新しい順で
export async function fetchOpenAf() {
  const [{ collection, getDocs, query, where }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(query(collection(db, "afThreads"), where("done", "==", false))));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0));
}

// ag(家人のやったあとのまとめと判断、2026-10-18 ab-185)。m3 からは読むだけ。閉じない台帳なので新しい順に n 件
export async function fetchRecentAg(n = 20) {
  const [{ collection, getDocs }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "agThreads")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (Number(b.seq) || 0) - (Number(a.seq) || 0)).slice(0, n);
}

// ah(作業票、持ち場とロック、2026-10-18 b1 ab-193)。m3 からは読むだけ。済んでいない票を、次が Takashi の票を先に
export async function fetchOpenAh(now = Date.now(), all = null) {
  return (all || await fetchAllAh()).map((t) => ahView(t, now)).filter((t) => t.state !== "済")
    .sort((a, b) => (b.next === "takashi") - (a.next === "takashi") || (Number(a.seq) || 0) - (Number(b.seq) || 0));
}

// ah をまるごと読む(m3 の一覧と礼文の票で1回だけ読む)
export async function fetchAllAh() {
  const [{ collection, getDocs }, { db, ensureReadLogin, guardRead }] = await load();
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "ahThreads")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// 礼文の票(ah-38、2026-10-19): 握っている票・礼文に回っている票・最近済んだ票。印が30分より古い作業中は stale
const REBUN = "rebun";
export const STALE_MIN = 30;
const ms = (s) => Date.parse(s || "");
const lastNoteAt = (t) => Math.max(0, ...(Array.isArray(t.noteMeta) ? t.noteMeta.map((m) => ms(m && m.createdAt) || 0) : []));
export function rebunView(threads, now = Date.now(), doneN = 5) {
  const bySeq = (a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0);
  const mins = (s) => (Number.isFinite(ms(s)) ? Math.floor((now - ms(s)) / 60000) : null);
  const holding = threads.filter((t) => t.state === "作業中" && t.holder === REBUN).sort(bySeq)
    .map((t) => ({ ...t, claimedMin: mins(t.claimedAt), beatMin: mins(t.beatAt), stale: !(mins(t.beatAt) <= STALE_MIN), view: ahView(t, now).state }));
  const assigned = threads.filter((t) => t.state !== "済" && !(t.state === "作業中" && t.holder === REBUN)
    && (t.next === REBUN || (t.owner === REBUN && (t.next === "takashi" || !t.next)))).map((t) => ahView(t, now)).sort(bySeq);
  // 済の時刻は欄が無いので、最後の note(finish が【済】を残す)の時刻で並べる
  const done = threads.filter((t) => t.state === "済" && t.owner === REBUN)
    .sort((a, b) => lastNoteAt(b) - lastNoteAt(a) || bySeq(b, a)).slice(0, doneN)
    .map((t) => ({ ...t, doneAt: lastNoteAt(t) ? new Date(lastNoteAt(t)).toISOString() : "" }));
  return { holding, assigned, done };
}

// 3つの数(ah-37、2026-10-19): 済んでいない票を、次が Takashi / 次が cron を持たない利尻・すま / それ以外(礼文・天売)に分ける。
// 落ちた票は持ち主の分(ahView が次を持ち主にする)。b1 の run_lock.group と同じ決まり
export const AH_GROUPS = ["たかしさん待ち", "窓を開けば進む", "礼文が進めている"];
const WITH_TAKASHI = ["rishiri", "suma"];
export function ahGroup(t, now = Date.now()) {
  const v = ahView(t, now);
  return v.next === "takashi" ? AH_GROUPS[0] : WITH_TAKASHI.includes(v.next) ? AH_GROUPS[1] : AH_GROUPS[2];
}
export function ahCounts(threads, now = Date.now()) {
  const n = Object.fromEntries(AH_GROUPS.map((g) => [g, 0]));
  for (const t of threads) if (t.state !== "済") n[ahGroup(t, now)] += 1;
  return n;
}

// 礼文の票の cron の最後の回(jobStatus/ticket、b1 infra/pi/ticket_cron.sh が run job で書く)。読めなければ null
export async function fetchTicketJob() {
  try {
    const [{ doc, getDoc }, { db, ensureReadLogin }] = await load();
    await ensureReadLogin();
    const d = await getDoc(doc(db, "jobStatus", "ticket"));
    return d.exists() ? d.data() : null;
  } catch { return null; }
}

// 作業中で印が2時間止まった票は「落ちた」(次は持ち主)。b1 の run_lock.view_state と同じ決まり
export function ahView(t, now = Date.now()) {
  const beat = Date.parse(t.beatAt || "");
  if (t.state === "作業中" && !(now - beat <= 2 * 3600 * 1000)) return { ...t, state: "落ちた", next: t.owner };
  return t;
}

// 新しく作る。返すのは {id, seq}
export async function createAf({ title, body = "", tags = [] }) {
  const [{ collection, doc, runTransaction }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const counterRef = doc(db, "_meta", "af_seq");
  const threadRef = doc(collection(db, "afThreads"));
  const seq = await runTransaction(db, async (tx) => {
    const cur = await tx.get(counterRef);
    const next = cur.exists() ? Number(cur.data().value) + 1 : 1;
    tx.set(counterRef, { value: next });
    tx.set(threadRef, {
      title, body, tags: tags.slice(0, 10), related: [], done: false, by: BY,
      createdAt: new Date().toISOString(), noteMeta: [], seq: next,
    });
    return next;
  });
  return { id: threadRef.id, seq };
}

export async function doneAf(id) {
  const [{ doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  await updateDoc(doc(db, "afThreads", id), { done: true, doneBy: BY, doneAt: new Date().toISOString() });
}

export async function addAfNote(id, text) {
  const [{ addDoc, arrayUnion, collection, doc, updateDoc }, { db, ensureFirebaseLogin }] = await load();
  await ensureFirebaseLogin();
  const createdAt = new Date().toISOString();
  await addDoc(collection(db, "afThreads", id, "notes"), { body: text, by: BY, createdAt });
  await updateDoc(doc(db, "afThreads", id), { noteMeta: arrayUnion({ by: BY, createdAt, retitle: false }) });
}

// af のタグは空白・カンマなしの短い語(aa-lane と同じ)
export function cleanAfTags(tags) {
  return (tags || []).map((t) => String(t).replace(/^#/, "").trim()).filter((t) => t && !/[\s,]/.test(t) && t.length <= 30).slice(0, 10);
}

export const isDenied = (e) => !!e && (e.code === "permission-denied" || /PERMISSION_DENIED|insufficient permissions/i.test(e.message || ""));
