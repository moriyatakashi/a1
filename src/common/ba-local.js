const LS_KEY = "a2_ba_entries";
export function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; }
  catch (e) { return []; }
}
export function lsSetAll(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }
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
