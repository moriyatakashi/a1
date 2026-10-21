// reads.js — m11「どこまで読んだ」(b1 ah-47・af-9、2026-10-22 礼文)。画面に依らない計算だけ(テストは reads.test.mjs)。
// mangaReads は足すだけ(直さない・消さない)なので、作品ごとに一番新しい1件が「今どこまで」。

export const MAX_NUM = 9999; // Rules の vol・ch の上限
export const MAX_TEXT = 60; // Rules の title・place の上限

// rows = [{title, vol, ch, place, date, createdAt}] → 作品ごとに一番新しい1件を、新しい順に
export function latestByTitle(rows) {
  const byTitle = new Map();
  for (const r of rows) {
    if (!r || typeof r.title !== "string" || !r.title) continue;
    const cur = byTitle.get(r.title);
    if (!cur || String(r.createdAt || "") > String(cur.createdAt || "")) byTitle.set(r.title, r);
  }
  return [...byTitle.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

// 前回の場所(新しい場所の初期値)。無ければ ""
export function lastPlace(rows) {
  const withPlace = rows.filter((r) => r && r.place).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return withPlace.length ? withPlace[0].place : "";
}

// 巻・話を 0〜9999 の整数にそろえる(Rules が int を求めるため)
export function clampNum(v) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_NUM);
}

// 保存する1件。title が空・長すぎなら null(Rules で弾かれる前に止める)
export function makeRead({ title, vol, ch, place }, now = new Date()) {
  const t = String(title || "").trim();
  if (!t || t.length > MAX_TEXT) return null;
  const p = String(place || "").trim().slice(0, MAX_TEXT);
  const iso = now.toISOString();
  const date = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); // JST の今日
  const read = { title: t, vol: clampNum(vol), ch: clampNum(ch), date, createdAt: iso, by: "takashi" };
  if (p) read.place = p;
  return read;
}

export const md = (date) => (/^\d{4}-\d{2}-\d{2}$/.test(date || "") ? `${+date.slice(5, 7)}/${+date.slice(8, 10)}` : "");
