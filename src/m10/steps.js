// steps.js — m10「歩数」の週まとめ(ab-128、2026-10-15 利尻)。画面に依らない計算だけ(テストは steps.test.mjs)。
// 週は月曜はじまり。記録の無い日は null(0歩とは分けて「記録なし」と見せる)。

const DAY = 86400000;
const toUtc = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const fmt = (t) => new Date(t).toISOString().slice(0, 10);

export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

// 日付(YYYY-MM-DD)が入る週の月曜
export function weekStart(date) {
  const t = toUtc(date);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // 月=0 … 日=6
  return fmt(t - dow * DAY);
}

// rows = [{date, steps}] → 古い週から順に [{start, days: [{date, steps|null}×7], total, recorded}]。
// 最初の記録の週から today の週まで、間の記録の無い週も並べる(棒が途切れて見えるように)。
export function groupByWeek(rows, today) {
  const byDate = new Map(rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date)).map((r) => [r.date, Number(r.steps) || 0]));
  if (!byDate.size) return [];
  const first = toUtc(weekStart([...byDate.keys()].sort()[0]));
  const last = toUtc(weekStart(today));
  const weeks = [];
  for (let w = first; w <= last; w += 7 * DAY) {
    const days = WEEKDAYS.map((_, i) => {
      const date = fmt(w + i * DAY);
      return { date, steps: byDate.has(date) ? byDate.get(date) : null };
    });
    const got = days.filter((d) => d.steps !== null);
    weeks.push({ start: fmt(w), days, total: got.reduce((s, d) => s + d.steps, 0), recorded: got.length });
  }
  return weeks;
}

// 1日あたり(記録のある日だけで割る)。記録が無ければ null
export const dailyAverage = (week) => (week.recorded ? Math.round(week.total / week.recorded) : null);

export const md = (date) => `${+date.slice(5, 7)}/${+date.slice(8, 10)}`;
