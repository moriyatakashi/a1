const LS_KEY = "a2_ba_entries";
export function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch (e) { return []; }
}
export function lsSetAll(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
const SEED = [
  { id: "t1", threadId: "t1", seq: 1, type: "new", title: "サンプル：はじめてのスレッド", body: "学習用のサンプルです。返信・リアクション・クローズを試せます。", by: "takashi", tags: ["記録"], createdAt: "2026-08-20T01:00:00.000Z" },
  { id: "t1n1", threadId: "t1", seq: 2, type: "note", body: "これは返信（note）のサンプルです。", by: "takashi", createdAt: "2026-08-20T02:30:00.000Z" },
  { id: "t2", threadId: "t2", seq: 3, type: "new", title: "サンプル：案件スレッド", body: "分類タグが「案件」。クローズやタグ変更を試せます。", by: "takashi", tags: ["案件"], createdAt: "2026-08-21T04:00:00.000Z" },
  { id: "t3", threadId: "t3", seq: 4, type: "new", title: "サンプル：気づきスレッド", body: "タイトル訂正やタグ付け替えを試せます。", by: "takashi", tags: ["気づき"], createdAt: "2026-08-22T06:00:00.000Z" },
];
export function seedIfEmpty() { if (lsGetAll().length === 0) lsSetAll(SEED); }
export function postEntry(body) {
  const all = lsGetAll();
  const id = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = Object.assign({}, body, {
    id,
    threadId: body.ref || id,
    seq: Math.max(0, ...all.map((e) => e.seq || 0)) + 1,
    by: "takashi",
    createdAt: new Date().toISOString(),
  });
  all.push(entry);
  lsSetAll(all);
  return entry;
}
