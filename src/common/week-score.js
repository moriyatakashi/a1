// common/week-score.js — 週の得点をページ側で数える(ab-166 ③、2026-10-10 Takashi「今から始める」)。
// これまでは Azure の /api/weekly-scores が同じ計算をしていた(b1/b3/api/bp_weekly.py)。Azure をやめるので、
// 同じ式をここに移した。週の得点 = その週の毎日スコアの合計 + 閉じたスレッドの点 + 加点イベントの合計。
//  - 週は ISO 週(月曜はじまり)、日本時間の月曜0時から翌月曜0時まで
//  - 閉じたスレッドの点: 旧 ba の close(開→閉に変わった瞬間だけ、取り消したスレッドは数えない)と af の済み。
//    難易度(low/normal/high)ごとの配点は、その週の月曜に効いていた scoringRules の版で数える(ba-159)。
//    難易度が無いものは normal。af には難易度が無いので normal
//  - 加点イベント: pointEvents の createdAt がその週に入るもの
// 読むのは Firestore の scores・pointEvents・scoringRules(と af)。旧 ba は今は Azure から読む。
// ba の読みを止めるとき(ab-166 ⑥)に、旧 ba の close を写しにして読む形へ替える。

export const DIFFICULTY_POINTS = { low: 2, normal: 5, high: 10 };
const DEFAULT_DIFFICULTY = "normal";
const DAY = 86400000;

// "2026-W41" → { year, week, monday: "YYYY-MM-DD", startMs, endMs }(startMs/endMs は日本時間の月曜0時)
export function weekBounds(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey || "");
  if (!m) throw new Error(`week key must look like 2026-W41: ${weekKey}`);
  const year = Number(m[1]), week = Number(m[2]);
  const jan4 = Date.UTC(year, 0, 4);
  const jan4Day = (new Date(jan4).getUTCDay() + 6) % 7; // 月=0
  const mondayUtc = jan4 - jan4Day * DAY + (week - 1) * 7 * DAY;
  const monday = new Date(mondayUtc).toISOString().slice(0, 10);
  const startMs = mondayUtc - 9 * 3600 * 1000;
  return { year, week, monday, startMs, endMs: startMs + 7 * DAY };
}

export function addDays(dateStr, n) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

// その日以前で一番新しい版の配点。版が無ければ既定(ba-159)
export function ruleAt(rules, dateStr) {
  const c = (rules || []).filter((r) => r.effectiveFrom <= dateStr);
  if (!c.length) return { ...DIFFICULTY_POINTS };
  return { ...c.reduce((a, b) => (a.effectiveFrom >= b.effectiveFrom ? a : b)).difficultyPoints };
}

// 旧 ba の生ログ(GET /api/ba)から、close が確定した瞬間を [{at, difficulty}] で返す(bp_ba._ba_close_transitions と同じ)
export function baCloseEvents(entries) {
  const statuses = new Map();
  const voided = new Set();
  const difficulty = new Map();
  for (const e of entries || []) {
    if (e.type === "void") {
      voided.add(e.threadId);
      if (e.ref) voided.add(e.ref);
    } else if (e.type === "status" && e.status) {
      if (!statuses.has(e.threadId)) statuses.set(e.threadId, []);
      statuses.get(e.threadId).push([e.createdAt || "", e.status]);
    } else if (e.type === "new" && e.id === e.threadId && e.difficulty) {
      difficulty.set(e.threadId, e.difficulty);
    }
  }
  const out = [];
  for (const [threadId, recs] of statuses) {
    if (voided.has(threadId)) continue;
    recs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    let wasClosed = false;
    for (const [at, status] of recs) {
      if (status === "closed") {
        if (!wasClosed) out.push({ at, difficulty: difficulty.get(threadId) || DEFAULT_DIFFICULTY });
        wasClosed = true;
      } else {
        wasClosed = false;
      }
    }
  }
  return out;
}

const inWeek = (iso, b) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) && t >= b.startMs && t < b.endMs;
};

// inputs: { scores: {"YYYY-MM-DD": 点}, pointEvents: [{createdAt, points}], rules: [{effectiveFrom, difficultyPoints}], closes: [{at, difficulty}] }
// 返す形は Azure の /api/weekly-scores/{週} と同じ(bc・今日パネルがそのまま使える)
export function weekScore(weekKey, { scores = {}, pointEvents = [], rules = [], closes = [] } = {}) {
  const b = weekBounds(weekKey);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(b.monday, i));
  const dailyScoreSum = dates.reduce((s, d) => s + (Number(scores[d]) || 0), 0);
  const active = ruleAt(rules, b.monday);
  const latest = ruleAt(rules, "9999-12-31");
  const breakdown = { low: 0, normal: 0, high: 0 };
  let closeValue = 0, closeValueAsOfLatest = 0, closeCount = 0;
  for (const c of closes) {
    if (!inWeek(c.at, b)) continue;
    const d = c.difficulty in DIFFICULTY_POINTS ? c.difficulty : DEFAULT_DIFFICULTY;
    closeCount += 1;
    breakdown[d] += 1;
    closeValue += active[d] ?? DIFFICULTY_POINTS[d];
    closeValueAsOfLatest += latest[d] ?? DIFFICULTY_POINTS[d];
  }
  const pointEventSum = pointEvents.reduce((s, e) => s + (inWeek(e.createdAt, b) ? Number(e.points) || 0 : 0), 0);
  return {
    year: b.year, week: b.week, weekKey, weekStart: b.monday, weekEnd: addDays(b.monday, 6),
    dailyScoreSum, closeCount, closeValue, closeValueAsOfLatest, breakdownByDifficulty: breakdown, pointEventSum,
    weekScore: dailyScoreSum + closeValue + pointEventSum,
    weekScoreAsOfLatest: dailyScoreSum + closeValueAsOfLatest + pointEventSum,
    calculatedAt: null,
  };
}

// ---- 読み込み(ブラウザ)。1回読んだらこのページの間は使い回す ----
const SDK = "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
const DEFAULT_API_BASE = "https://ab-board-api.azurewebsites.net/api";
let inputsPromise = null;

async function loadInputs(apiBase) {
  const [{ collection, getDocs, query, where }, { db, ensureReadLogin, guardRead }] =
    await Promise.all([import(SDK), import("./firebase.js")]);
  await ensureReadLogin();
  const all = (name) => guardRead(() => getDocs(collection(db, name))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })));
  const [scoreDocs, pointEvents, ruleDocs] = await Promise.all([all("scores"), all("pointEvents"), all("scoringRules")]);
  const scores = Object.fromEntries(scoreDocs.map((d) => [d.id, d.score]));
  const rules = ruleDocs.map((d) => ({ effectiveFrom: d.id, difficultyPoints: d.difficultyPoints || {} }));
  const closes = [];
  // 旧 ba の close(ab-166 ⑥ までは Azure から読む。読めなければ数えない)
  try {
    const res = await fetch(`${apiBase}/ba?minimal=1`, { cache: "no-store" });
    if (res.ok) closes.push(...baCloseEvents(await res.json()));
  } catch (e) { /* 数えない */ }
  // af の済み(本人だけ読める。Rules が出るまでは読めないので数えない)
  try {
    const snap = await getDocs(query(collection(db, "afThreads"), where("done", "==", true)));
    for (const d of snap.docs) {
      const t = d.data();
      if (t.doneAt) closes.push({ at: t.doneAt, difficulty: DEFAULT_DIFFICULTY });
    }
  } catch (e) { /* 数えない */ }
  return { scores, pointEvents, rules, closes };
}

export function loadWeekInputs({ apiBase = (typeof window !== "undefined" && window.AA_API_BASE) || DEFAULT_API_BASE } = {}) {
  if (!inputsPromise) inputsPromise = loadInputs(apiBase).catch((e) => { inputsPromise = null; throw e; });
  return inputsPromise;
}

export async function fetchWeekScore(weekKey, opts) {
  return weekScore(weekKey, await loadWeekInputs(opts));
}
