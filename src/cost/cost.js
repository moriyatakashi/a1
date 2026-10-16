// cost.js — 課金の指数(ab-171、2026-10-17 利尻)。画面に依らない計算だけ(テストは cost.test.mjs)。
// costIndex の1件 = {provider, week(月曜), index}。最初の週(2026-08-03)=100 の指数で、金額は持たない。

// rows → 課金元ごとに古い週から並べた [{week, index}]
export function seriesByProvider(rows) {
  const out = {};
  for (const r of rows) {
    if (!r || typeof r.provider !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.week || "") || typeof r.index !== "number") continue;
    (out[r.provider] ||= []).push({ week: r.week, index: r.index });
  }
  for (const p of Object.keys(out)) out[p].sort((a, b) => (a.week < b.week ? -1 : 1));
  return out;
}

// 最後から数えて 0 が何週続いているか(「0円を見続ける」、ab-182 Q4 B)
export function zeroStreak(series) {
  let n = 0;
  for (let i = series.length - 1; i >= 0 && series[i].index === 0; i--) n++;
  return n;
}

// 折れ線の点(SVG の座標)。縦は 0〜max(100, いちばん大きい指数)、横は週を等間隔
export function points(series, width, height, pad = 8) {
  if (!series.length) return [];
  const top = Math.max(100, ...series.map((s) => s.index));
  const step = series.length > 1 ? (width - pad * 2) / (series.length - 1) : 0;
  return series.map((s, i) => ({
    x: Math.round((pad + i * step) * 10) / 10,
    y: Math.round((height - pad - (s.index / top) * (height - pad * 2)) * 10) / 10,
    ...s,
  }));
}

export const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
