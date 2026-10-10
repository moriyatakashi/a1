// common/today-panel.js — トップページの「今日の運勢と得点」(ab-42、2026-10-01。構想は ba-70/t5、Takashi 発案 2026-07-24)。
// 「トップページを重たくしたく無くて、私が能動的に操作した時のみに動くようにしたい」(Takashi)ので、
// このファイル自体をボタンを押したときに import する。ページを開いただけでは何も取りに行かない。
// 出すもの: 1. 今日の得点 / 2. 今週の週次得点が先週まであと何点か / 3. 運勢(日付で決まるおみくじ、スコアとは無関係)

// 日付は日本時間で数える(m1 の毎日スコアと同じ)
export function jstDate(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// ISO 週(月曜はじまり)。weekly-scores の週キー "YYYY-Www" と同じ数え方
export function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // 月=0 … 日=6
  d.setUTCDate(d.getUTCDate() - day + 3); // その週の木曜
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function previousWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return isoWeekKey(d.toISOString().slice(0, 10));
}

// 運勢: 日付の文字列から決まる(同じ日は何度押しても同じ)。重みは吉寄り
const FORTUNES = [
  ["大吉", 2], ["中吉", 3], ["小吉", 3], ["吉", 4], ["末吉", 2], ["凶", 1],
];

export function fortuneOf(dateStr) {
  let h = 2166136261;
  for (const ch of `a1-fortune-${dateStr}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const total = FORTUNES.reduce((s, [, w]) => s + w, 0);
  let r = h % total;
  for (const [name, w] of FORTUNES) {
    if (r < w) return name;
    r -= w;
  }
  return FORTUNES[0][0];
}

function row(label, value) {
  const div = document.createElement("div");
  div.className = "today-row";
  const l = document.createElement("span");
  l.className = "today-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "today-value";
  v.textContent = value;
  div.append(l, v);
  return div;
}

export async function showTodayPanel(body, { now = new Date() } = {}) {
  const date = jstDate(now);
  const thisWeek = isoWeekKey(date);
  const lastWeek = previousWeekKey(date);
  body.replaceChildren(row("運勢", fortuneOf(date)), row("今日の得点", "取得中…"), row("今週", "取得中…"));

  // ab-166 ③(2026-10-10): 週の得点は Azure の /api/weekly-scores でなく、ページ側で数える(week-score.js、式は同じ)
  const week = import("./week-score.js");
  const [today, cur, prev] = await Promise.allSettled([
    // ab-162: 今日の得点は Firestore から(本人のログインで読む)
    import("./score-store.js").then((m) => m.fetchScore(date)),
    week.then((m) => m.fetchWeekScore(thisWeek)),
    week.then((m) => m.fetchWeekScore(lastWeek)),
  ]);

  let todayText = "取得できませんでした";
  if (today.status === "fulfilled") {
    todayText = today.value ? `${today.value.score}点` : "まだ入っていません";
  }

  let weekText = "取得できませんでした";
  if (cur.status === "fulfilled" && prev.status === "fulfilled") {
    const c = cur.value.weekScore ?? 0;
    const p = prev.value.weekScore ?? 0;
    const rest = p - c;
    weekText = rest > 0 ? `${c}点(先週 ${p}点まで あと${rest}点)` : `${c}点(先週 ${p}点を超えました)`;
  }

  body.replaceChildren(row("運勢", fortuneOf(date)), row("今日の得点", todayText), row("今週", weekText));
}
