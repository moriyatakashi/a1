// score.js — m9 打倒あすけん の点の計算(ab-177、2026-10-12 すま)。画面に依らない計算だけ。
// 決めごと(Takashi の explain の答え):
//   1品ごとの点(0〜5)を足し、主食・たんぱく・野菜が1食にそろうとボーナス(Q1 C)
//   お金(¥)と手間(1〜3)は点に混ぜず、並べて見せる(Q2 B)
//   1食ずつ選び、1日の合計も出す(Q3 C) / 足りないものを一言出す(Q4 A)

export const MAIN_GROUPS = ["主食", "たんぱく", "野菜"];
export const MEAL_BONUS = 3;

// 1食分。items は foods.json の食べ物の配列(同じ物を2回入れれば2つ分)
export function mealSummary(items) {
  const list = Array.isArray(items) ? items : [];
  const has = new Set(list.flatMap((f) => f.kinds || []));
  const missing = MAIN_GROUPS.filter((g) => !has.has(g));
  const base = list.reduce((s, f) => s + (Number(f.point) || 0), 0);
  const bonus = list.length > 0 && missing.length === 0 ? MEAL_BONUS : 0;
  return {
    count: list.length,
    base,
    bonus,
    total: base + bonus,
    yen: list.reduce((s, f) => s + (Number(f.yen) || 0), 0),
    tema: list.reduce((s, f) => s + (Number(f.tema) || 0), 0),
    missing,
    warns: [...new Set(list.map((f) => f.warn).filter(Boolean))],
  };
}

// 1日分。meals は食事ごとの items の配列。空の食事は数えない
export function daySummary(meals) {
  const done = (Array.isArray(meals) ? meals : []).filter((m) => Array.isArray(m) && m.length > 0);
  const sums = done.map(mealSummary);
  const has = new Set(done.flat().flatMap((f) => f.kinds || []));
  return {
    meals: sums.length,
    total: sums.reduce((s, m) => s + m.total, 0),
    yen: sums.reduce((s, m) => s + m.yen, 0),
    tema: sums.reduce((s, m) => s + m.tema, 0),
    bonusMeals: sums.filter((m) => m.bonus > 0).length,
    missing: [...MAIN_GROUPS, "果物", "乳"].filter((g) => !has.has(g)),
  };
}

// 足りないものの一言。無ければ空文字
export function missingText(missing) {
  return missing && missing.length ? `${missing.join("・")}が足りない` : "";
}
