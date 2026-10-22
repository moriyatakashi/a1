// app.js — m4(台帳の計器、旧bc・k2)。ab(家人たちの連絡用、Firestore abThreads)を読み、
// 投稿者別・週次得点・月次集計・流れをタブ切り替えで出す。読み取り専用。
// b1 ah-78(af-63): 台帳が ba → ab → ah・af・ae と移ったので、ba(凍結した写し)は読まない。ba だけの分類別タブも外した。
// config.jsを自分でimportする(ba-9追補)。HTML側の<script>読込に依存しないため、
// 旧index.htmlがキャッシュされた端末でも壊れない(2026-07-16の表示不具合の恒久対策)。
import "../common/config.js";
// ab は Firestore(ab01-9f35a)の abThreads とサブコレクション notes。Rules で誰でも読めるので匿名の REST GET。
const AB_FS = "https://firestore.googleapis.com/v1/projects/ab01-9f35a/databases/(default)/documents/abThreads";
const AC_FS = AB_FS.replace(/abThreads$/, "acThreads"); // ac(決まったこと)。閉じない代わりに reviewedAt(最終見直し日)を持つ
const AB_LABEL = "ab(連絡)";
const CATEGORIES = [AB_LABEL]; // 月次の積み上げの段(ba の分類は外した、ah-78)

// ab-162(2026-10-10): いずれ Rules の ab の読みを本人だけに絞るので、Firebase にログインしていれば
// その ID トークンを付けて読む(Rules は request.auth で本人と分かる)。ログインしていなければ今までどおり匿名。
// ah-58: ab と ac を並べて読むので、ログインは1回だけにして同じ Promise を返す(先に {} を返すと2本目が匿名になる)
let _abAuthHeaders = null;
function abAuthHeaders() {
  _abAuthHeaders ||= (async () => {
    try {
      const { ensureReadLogin } = await import("../common/firebase.js");
      const user = await ensureReadLogin();
      if (user && typeof user.getIdToken === "function") return { Authorization: `Bearer ${await user.getIdToken()}` };
    } catch (e) {
      console.warn("ab を読むための Firebase ログインに失敗(匿名で読む)", e);
    }
    return {};
  })();
  return _abAuthHeaders;
}

async function fsListDocs(url) {
  const docs = [];
  const headers = await abAuthHeaders();
  let token = "";
  do {
    const res = await fetch(`${url}?pageSize=300${token ? `&pageToken=${token}` : ""}`, { cache: "no-store", headers });
    if (res.status === 403) {
      // ab-162: Rules で読めない(この端末で Firebase にログインしていない)。帯を出す
      import("../common/firebase.js").then((m) => m.showReadLoginBanner()).catch(() => {});
    }
    if (!res.ok) throw new Error(`Firestore ${res.status}`);
    const page = await res.json();
    docs.push(...(page.documents || []));
    token = page.nextPageToken || "";
  } while (token);
  return docs;
}

const fsStr = (doc, key) => doc.fields?.[key]?.stringValue || "";
const fsBool = (doc, key) => doc.fields?.[key]?.booleanValue === true;
const fsInt = (doc, key) => Number(doc.fields?.[key]?.integerValue || 0);
const fsStrList = (doc, key) => (doc.fields?.[key]?.arrayValue?.values || []).map((v) => v.stringValue || "");

// ab-97(2026-10-07): aa-lane が note を書くたびに、スレッドの noteMeta に {by, createdAt, retitle} を足している。
// あればそれを使い、notes を1スレッドずつ読まない(1回開くと約550件 → スレッドの数だけ)。
// noteMeta の無い古いスレッド(埋める前のもの)だけ、今までどおり notes を読む。
function fsNoteMeta(doc) {
  const f = doc.fields?.noteMeta;
  if (!f || !f.arrayValue) return null;
  return (f.arrayValue.values || []).map((v) => {
    const m = v.mapValue?.fields || {};
    return { by: m.by?.stringValue || "", createdAt: m.createdAt?.stringValue || "", retitle: m.retitle?.booleanValue === true };
  });
}

// ah-58(af-15 の案4): ac を見直しが古い順に。読むだけ
async function fetchAcStale() {
  return (await fsListDocs(AC_FS))
    .map((d) => ({ seq: fsInt(d, "seq"), title: fsStr(d, "title"), reviewedAt: fsStr(d, "reviewedAt") || fsStr(d, "createdAt") }))
    .filter((a) => a.reviewedAt)
    .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt))
    .slice(0, AC_STALE_COUNT);
}

// b1 ah-78: 今の状態に ah(票の段階ごとの数)・af(開いている数)・ae(済んでいない的の数)を足す。読むのは m3 と同じ道具
const AH_STATES = ["待ち", "作業中", "渡し先待ち", "落ちた"];
async function fetchLedgers() {
  const m = await import("../m3/af-store.js");
  const [ah, af, ae] = await Promise.all([
    m.fetchAllAh().catch((e) => { console.warn("ah を読めませんでした", e); return null; }),
    m.fetchOpenAf().catch((e) => { console.warn("af を読めませんでした", e); return null; }),
    m.fetchOpenAe().catch((e) => { console.warn("ae を読めませんでした", e); return null; }),
  ]);
  const now = Date.now();
  const ahN = ah && Object.fromEntries(AH_STATES.map((s) => [s, 0]));
  (ah || []).map((t) => m.ahView(t, now)).forEach((t) => { if (t.state in ahN) ahN[t.state]++; });
  return { ah: ahN, af: af && af.length, ae: ae && ae.length };
}

// ab のスレッドを {threadId, root, entries} の形にそろえる
async function fetchAbThreads() {
  const docs = await fsListDocs(AB_FS);
  return Promise.all(docs.map(async (d) => {
    const threadId = d.name.split("/").pop();
    const root = { id: threadId, by: fsStr(d, "by"), createdAt: fsStr(d, "createdAt"), seq: fsInt(d, "seq"), title: fsStr(d, "title") };
    const notes = fsNoteMeta(d) || (await fsListDocs(`${AB_FS}/${threadId}/notes`))
      .map((n) => ({ by: fsStr(n, "by"), createdAt: fsStr(n, "createdAt"), retitle: fsStr(n, "body").startsWith("タイトルを変えた(") }));
    const entries = [root, ...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    // ab-45: 「今の状態」用に 済み・返事が要るか・宛先も持つ(レーダー・月次は従来どおり済みも含めて数える)
    // 流れ・最近の動き・待ち用に 済みにした日時と人、待ちの日付と中身も持つ
    return { threadId, root, entries, status: fsBool(d, "done") ? "closed" : "open", source: "ab",
      needsReply: fsBool(d, "needsReply"), to: fsStrList(d, "to"),
      doneAt: fsStr(d, "doneAt"), doneBy: fsStr(d, "doneBy"), waitUntil: fsStr(d, "waitUntil"), waitFor: fsStr(d, "waitFor") };
  }));
}

// 投稿者3人の判定基準: 全エントリのby(発言したら参加扱い)。
// 値: そのby(投稿者)が関わったスレッド数(open/closed問わず全部含む)。
function computePosterCounts(threads) {
  const counts = new Map(); // by -> count

  threads.forEach((thread) => {
    const posters = new Set(thread.entries.map((e) => e.by).filter(Boolean).map(byName));
    posters.forEach((by) => {
      counts.set(by, (counts.get(by) || 0) + 1);
    });
  });

  return counts;
}

const COLOR = "#6cf";

// 軸=Mapのkey、頂点の値=Mapのvalue。多角形1つとして描画する(軸数は可変)。
function drawRadar(svg, counts) {
  const labels = Array.from(counts.keys());
  const cx = 160, cy = 150, r = 100;
  const maxVal = Math.max(1, ...labels.map((l) => counts.get(l)));

  const angleFor = (i) => (Math.PI * 2 * i) / labels.length - Math.PI / 2;
  const pointFor = (i, val) => {
    const a = angleFor(i);
    const dist = (val / maxVal) * r;
    return [cx + dist * Math.cos(a), cy + dist * Math.sin(a)];
  };

  let svgParts = [];

  // グリッド(同心の多角形、4分割)
  for (let ring = 1; ring <= 4; ring++) {
    const ringR = (r * ring) / 4;
    const pts = labels.map((_, i) => {
      const a = angleFor(i);
      return `${cx + ringR * Math.cos(a)},${cy + ringR * Math.sin(a)}`;
    }).join(" ");
    svgParts.push(`<polygon points="${pts}" fill="none" stroke="#444" stroke-width="1"/>`);
  }

  // 軸線とラベル(ラベル名+件数)
  labels.forEach((label, i) => {
    const a = angleFor(i);
    const x2 = cx + r * Math.cos(a), y2 = cy + r * Math.sin(a);
    svgParts.push(`<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="#444" stroke-width="1"/>`);
    const lx = cx + (r + 30) * Math.cos(a), ly = cy + (r + 30) * Math.sin(a);
    svgParts.push(`<text x="${lx}" y="${ly}" fill="#eee" font-size="13" text-anchor="middle" dominant-baseline="middle">${label} (${counts.get(label)})</text>`);
  });

  // 多角形(1つ)
  const pts = labels.map((label, i) => pointFor(i, counts.get(label)).join(",")).join(" ");
  svgParts.push(`<polygon points="${pts}" fill="${COLOR}" fill-opacity="0.25" stroke="${COLOR}" stroke-width="2"/>`);
  labels.forEach((label, i) => {
    const [px, py] = pointFor(i, counts.get(label));
    svgParts.push(`<circle cx="${px}" cy="${py}" r="3" fill="${COLOR}"/>`);
  });

  svg.innerHTML = svgParts.join("\n");
}

function renderTable(theadRow, tbody, counts, labelHeader, valueHeader) {
  theadRow.innerHTML = `<th>${labelHeader}</th><th>${valueHeader}</th>`;
  const labels = Array.from(counts.keys());
  tbody.innerHTML = labels.map((label) => {
    return `<tr><td>${label}</td><td>${counts.get(label)}</td></tr>`;
  }).join("");
}

// --- 週次得点(ba-53。2026-10-10 から common/week-score.js でページ側計算)------------------------------------
// レーダーは複数軸のバランス用なので、単一値の時系列である週次得点は棒グラフで描く。
// 日次スコアとクローズ得点は性質が異なるため積み上げで内訳が見える形にする。
const WEEK_COUNT = 8;
const C_DAILY = "#6cf";
const C_CLOSE = "#5aa06a";
const C_POINT = "#c98a3a";

function isoWeeksBack(n) {
  // 今週(JSTの月曜起点)からn週分さかのぼったISO年・週の一覧
  const now = new Date();
  const jst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(jst.getTime() - i * 7 * 86400000);
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    out.push({ year: t.getUTCFullYear(), week });
  }
  return out;
}

// 週の表示は月曜のM/d(5文字以内)
function weekLabel(weekStart) {
  const [, m, d] = weekStart.split("-");
  return `${Number(m)}/${Number(d)}`;
}

async function fetchWeeklyScores() {
  const weeks = isoWeeksBack(WEEK_COUNT);
  const results = await Promise.all(weeks.map(async ({ year, week }) => {
    try {
      const key = `${year}-W${String(week).padStart(2, "0")}`;
      // ab-166 ③(2026-10-10): Azure の /api/weekly-scores でなく、ページ側で数える(week-score.js、式は同じ)
      const { fetchWeekScore } = await import("../common/week-score.js");
      return await fetchWeekScore(key);
    } catch (e) {
      return null;
    }
  }));
  return results.filter((r) => r && r.weekStart);
}

function drawWeeklyBars(svg, weeks) {
  const W = 320, H = 320;
  const left = 34, right = 10, top = 16, bottom = 46;
  const plotW = W - left - right, plotH = H - top - bottom;
  const maxVal = Math.max(1, ...weeks.map((w) => w.weekScore));
  const step = plotW / weeks.length;
  const barW = Math.min(26, step * 0.6);
  const parts = [];

  // 目盛り(4本)
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maxVal * i) / 4);
    const y = top + plotH - (plotH * i) / 4;
    parts.push(`<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="#888" stroke-opacity="0.25"/>`);
    parts.push(`<text x="${left - 5}" y="${y + 3}" font-size="8" fill="currentColor" opacity="0.65" text-anchor="end">${v}</text>`);
  }

  weeks.forEach((w, i) => {
    const cx = left + step * i + step / 2;
    const x = cx - barW / 2;
    const hDaily = (w.dailyScoreSum / maxVal) * plotH;
    const hClose = (w.closeValue / maxVal) * plotH;
    const hPoint = (w.pointEventSum / maxVal) * plotH;
    const yDaily = top + plotH - hDaily;
    const yClose = yDaily - hClose;
    const yPoint = yClose - hPoint;
    parts.push(`<rect x="${x}" y="${yDaily}" width="${barW}" height="${hDaily}" fill="${C_DAILY}"/>`);
    if (w.closeValue > 0) {
      parts.push(`<rect x="${x}" y="${yClose}" width="${barW}" height="${hClose}" fill="${C_CLOSE}"/>`);
    }
    if (w.pointEventSum > 0) {
      parts.push(`<rect x="${x}" y="${yPoint}" width="${barW}" height="${hPoint}" fill="${C_POINT}"/>`);
    }
    parts.push(`<text x="${cx}" y="${yPoint - 4}" font-size="8" fill="currentColor" text-anchor="middle">${w.weekScore}</text>`);
    parts.push(`<text x="${cx}" y="${H - bottom + 14}" font-size="9" fill="currentColor" opacity="0.75" text-anchor="middle">${weekLabel(w.weekStart)}</text>`);
  });

  // 凡例
  parts.push(`<rect x="${left}" y="${H - 20}" width="9" height="9" fill="${C_DAILY}"/>`);
  parts.push(`<text x="${left + 13}" y="${H - 12}" font-size="9" fill="currentColor">日次スコア</text>`);
  parts.push(`<rect x="${left + 78}" y="${H - 20}" width="9" height="9" fill="${C_CLOSE}"/>`);
  parts.push(`<text x="${left + 91}" y="${H - 12}" font-size="9" fill="currentColor">クローズ得点</text>`);
  parts.push(`<rect x="${left + 168}" y="${H - 20}" width="9" height="9" fill="${C_POINT}"/>`);
  parts.push(`<text x="${left + 181}" y="${H - 12}" font-size="9" fill="currentColor">加点イベント</text>`);

  svg.innerHTML = parts.join("\n");
}

// ba-159: 「今のルールなら」列。当時の値(weekScore)と今のルールで見た値
// (weekScoreAsOfLatest)が違う週だけ薄く強調して、基準ずらしの影響が一目で分かるようにする。
function renderWeeklyTable(theadRow, tbody, weeks) {
  theadRow.innerHTML = "<th>週(月曜)</th><th>日次</th><th>クローズ</th><th>加点</th><th>合計</th><th>今のルールなら</th>";
  tbody.innerHTML = weeks.slice().reverse().map((w) => {
    const changed = w.weekScoreAsOfLatest !== w.weekScore;
    const asOfCell = changed
      ? `<span style="opacity:.75">${w.weekScoreAsOfLatest}</span>`
      : `<span style="opacity:.4">—</span>`;
    return (
      `<tr><td>${weekLabel(w.weekStart)}</td><td>${w.dailyScoreSum}</td>` +
      `<td>${w.closeValue}<span style="opacity:.6;font-size:.8em"> (${w.closeCount}件)</span></td>` +
      `<td>${w.pointEventSum}</td>` +
      `<td>${w.weekScore}</td>` +
      `<td>${asOfCell}</td></tr>`
    );
  }).join("");
}

// --- 月次集計(ab を月別に数える)------------------------------------
// 各スレッドを root の作成月に計上し、CATEGORIES の段ごとに積み上げる。
const MONTH_COUNT = 6;
const MONTH_CLASS_COLORS = ["#6cf", "#5aa06a", "#c98a3a", "#a678d0", "#d06a6a", "#7a9ab0", "#c8c060"]; // 最後が ab

function monthsBack(n) {
  const now = new Date();
  const jst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60000);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

// ab のスレッドは分類を持たないので段は AB_LABEL の1つだけ
const threadClassification = () => AB_LABEL;

// monthKeys(YYYY-MM配列) × 分類 の集計。範囲外の月・分類無しスレッドは無視する。
function computeMonthlyClassification(threads, monthKeys) {
  const data = new Map(monthKeys.map((k) => [k, new Map(CATEGORIES.map((c) => [c, 0]))]));
  threads.forEach((thread) => {
    const mk = (thread.root.createdAt || "").slice(0, 7);
    if (!data.has(mk)) return;
    const cls = threadClassification(thread);
    if (!cls) return;
    const m = data.get(mk);
    m.set(cls, (m.get(cls) || 0) + 1);
  });
  return data;
}

function monthTotal(data, key) {
  let s = 0;
  data.get(key).forEach((v) => (s += v));
  return s;
}

// 週次の積み上げ棒と同じ流儀。分類ごとに下から積み上げ、下部に2列の凡例を置く。
function drawMonthlyBars(svg, monthKeys, data) {
  const W = 320, H = 320;
  const rows = Math.ceil(CATEGORIES.length / 2);
  const left = 30, right = 10, top = 16;
  const bottom = 30 + rows * 15;
  const plotW = W - left - right, plotH = H - top - bottom;
  const totals = monthKeys.map((k) => monthTotal(data, k));
  const maxVal = Math.max(1, ...totals);
  const step = plotW / monthKeys.length;
  const barW = Math.min(30, step * 0.6);
  const parts = [];

  for (let i = 0; i <= 4; i++) {
    const v = Math.round((maxVal * i) / 4);
    const y = top + plotH - (plotH * i) / 4;
    parts.push(`<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="#888" stroke-opacity="0.25"/>`);
    parts.push(`<text x="${left - 5}" y="${y + 3}" font-size="8" fill="currentColor" opacity="0.65" text-anchor="end">${v}</text>`);
  }

  monthKeys.forEach((k, i) => {
    const cx = left + step * i + step / 2;
    const x = cx - barW / 2;
    const m = data.get(k);
    let yCursor = top + plotH;
    CATEGORIES.forEach((cls, ci) => {
      const val = m.get(cls) || 0;
      if (val <= 0) return;
      const h = (val / maxVal) * plotH;
      yCursor -= h;
      parts.push(`<rect x="${x}" y="${yCursor}" width="${barW}" height="${h}" fill="${MONTH_CLASS_COLORS[ci % MONTH_CLASS_COLORS.length]}"/>`);
    });
    if (totals[i] > 0) {
      parts.push(`<text x="${cx}" y="${yCursor - 4}" font-size="8" fill="currentColor" text-anchor="middle">${totals[i]}</text>`);
    }
    parts.push(`<text x="${cx}" y="${top + plotH + 14}" font-size="9" fill="currentColor" opacity="0.75" text-anchor="middle">${Number(k.slice(5, 7))}月</text>`);
  });

  CATEGORIES.forEach((label, ci) => {
    const col = ci % 2, row = Math.floor(ci / 2);
    const lx = left + col * 82;
    const ly = top + plotH + 26 + row * 15;
    parts.push(`<rect x="${lx}" y="${ly - 8}" width="9" height="9" fill="${MONTH_CLASS_COLORS[ci % MONTH_CLASS_COLORS.length]}"/>`);
    parts.push(`<text x="${lx + 13}" y="${ly}" font-size="9" fill="currentColor">${label}</text>`);
  });

  svg.innerHTML = parts.join("\n");
}

function renderMonthlyTable(theadRow, tbody, monthKeys, data) {
  theadRow.innerHTML = `<th>月</th>${CATEGORIES.map((c) => `<th>${c}</th>`).join("")}<th>合計</th>`;
  tbody.innerHTML = monthKeys.slice().reverse().map((k) => {
    const m = data.get(k);
    let total = 0;
    const cells = CATEGORIES.map((c) => {
      const v = m.get(c) || 0;
      total += v;
      return `<td>${v}</td>`;
    }).join("");
    return `<tr><td>${k}</td>${cells}<td>${total}</td></tr>`;
  }).join("");
}

const VIEWS = {
  poster: {
    compute: computePosterCounts,
    labelHeader: "投稿者",
    valueHeader: "投稿数(スレッド数・クローズ含む)",
  },
};

// --- 今の状態(2026-10-03、ab-45): 累計のチャートだけだと「今どうなっているか」が見えないので、上に置く ---
// ab: 開いている件数、返事待ち(返事が要る・済んでいない)の宛先ごとの数、最後の動きが古い順の5件。
const AB_TO_NAMES = { all: "みんな", rishiri: "利尻", suma: "すま", rebun: "礼文", teuri: "天売" };
// 投稿者名(by)→家人の名前。b1 の ai_family.json の ba_lane / aa_lane と同じ対応(変えたらここも直す)
const BY_NAMES = { "claude-pc": "利尻", "claude-mobile": "すま", "claude-pi": "礼文", "claude-teuri": "天売", takashi: "Takashi" };
const byName = (by) => BY_NAMES[by] || by;
const STALE_COUNT = 5;
const RECENT_COUNT = 8;
const AC_STALE_COUNT = 3;

// タイトルを直しただけの自動 note(ab-edit が残す「タイトルを変えた(旧: …)」)は動きに数えない
function lastActivity(thread) {
  return thread.entries.reduce((m, e) => (!e.retitle && e.createdAt > m ? e.createdAt : m), "");
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderNow(threads, acStale = [], ledgers = {}) {
  const el = document.getElementById("nowPanel");
  const abOpen = threads.filter((t) => t.status !== "closed");
  if (!abOpen.length && !ledgers.ah) { el.style.display = "none"; return; }

  // 落ちた(印が2時間止まった作業中)は 0 なら出さない
  const ahHtml = ledgers.ah ? AH_STATES.filter((s) => s !== "落ちた" || ledgers.ah[s])
    .map((s) => `<span class="now-ah">${s} ${ledgers.ah[s]}</span>`).join("") : '<span class="now-soft">読めない</span>';
  const count = (n) => (n == null ? '<span class="now-soft">読めない</span>' : `<b>${n}</b> 件`);

  const waiting = new Map();
  abOpen.filter((t) => t.needsReply).forEach((t) => {
    (t.to.length ? t.to : ["all"]).forEach((id) => waiting.set(id, (waiting.get(id) || 0) + 1));
  });
  const waitingHtml = waiting.size
    ? [...waiting].map(([id, n]) => `<span class="now-chip">${escapeHtml(AB_TO_NAMES[id] || id)} ${n}</span>`).join("")
    : '<span class="now-soft">なし</span>';

  const stale = abOpen
    .map((t) => ({ t, last: lastActivity(t) }))
    .sort((a, b) => a.last.localeCompare(b.last))
    .slice(0, STALE_COUNT);
  const staleHtml = stale.map(({ t, last }) =>
    `<li><span class="now-seq">ab-${t.root.seq}</span>${escapeHtml(t.root.title)}<span class="now-soft">${daysSince(last)}日前</span></li>`).join("");

  // ab wait の印(dopdf と同じ見せ方: 日が来るまでは「10/10まで」、来たら「10/10 来た」を上に)
  const today = jstDate(new Date().toISOString());
  const waits = abOpen.filter((t) => t.waitUntil).sort((a, b) => a.waitUntil.localeCompare(b.waitUntil));
  const waitHtml = waits.length
    ? waits.map((t) => {
      const came = t.waitUntil <= today;
      return `<li${came ? ' class="now-came"' : ""}><span class="now-seq">ab-${t.root.seq}</span>${escapeHtml(t.root.title)}` +
        `<span class="now-soft">${mdLabel(t.waitUntil)}${came ? " 来た" : "まで"}${t.waitFor ? `(${escapeHtml(t.waitFor)})` : ""}</span></li>`;
    }).join("")
    : "";

  const recentHtml = recentActivities(threads).map((a) =>
    `<li><span class="now-soft now-when">${escapeHtml(whenLabel(a.at))}</span>${escapeHtml(byName(a.by))} ` +
    `<span class="now-seq">${a.ref}</span>${escapeHtml(a.what)}<span class="now-soft">${escapeHtml(a.title)}</span></li>`).join("");

  el.innerHTML = `
    <div class="now-row"><span class="now-label">ab 開いている</span><b>${abOpen.length}</b> 件
      <span class="now-label now-gap">af 開いている</span>${count(ledgers.af)}
      <span class="now-label now-gap">ae 的</span>${count(ledgers.ae)}</div>
    <div class="now-row"><span class="now-label">ah 票</span>${ahHtml}</div>
    <div class="now-row"><span class="now-label">返事待ち(ab)</span>${waitingHtml}</div>
    ${waitHtml ? `<div class="now-label">待ち(ab)</div><ul class="now-list now-wait">${waitHtml}</ul>` : ""}
    <div class="now-label">最後の動きが古い ab</div>
    <ol class="now-stale">${staleHtml}</ol>
    ${acStale.length ? `<div class="now-label">見直しが古い ac</div><ol class="now-ac">${acStale.map((a) =>
      `<li><span class="now-seq">ac-${a.seq}</span>${escapeHtml(a.title)}<span class="now-soft">${daysSince(a.reviewedAt)}日前</span></li>`).join("")}</ol>` : ""}
    <div class="now-label">最近の動き(ab)</div>
    <ul class="now-list now-recent">${recentHtml}</ul>`;
  el.style.display = "";
}

// --- 日付まわり(JST) ---
const jstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600000).toISOString().slice(0, 10);
const mdLabel = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
function whenLabel(iso) {
  const j = new Date(new Date(iso).getTime() + 9 * 3600000).toISOString();
  return `${mdLabel(j.slice(0, 10))} ${j.slice(11, 16)}`;
}

// --- 最近の動き: ab の書き込みを新しい順に。タイトルを直しただけの自動 note は出さない ---
function activities(threads) {
  const out = [];
  threads.forEach((t) => {
    const ref = `ab-${t.root.seq}`;
    const title = t.root.title || "";
    t.entries.forEach((e) => {
      if (!e.createdAt || e.retitle) return;
      out.push({ at: e.createdAt, by: e.by, ref, what: e === t.root ? "立てた" : "note", title });
    });
    if (t.status === "closed" && t.doneAt) out.push({ at: t.doneAt, by: t.doneBy, ref, what: "済み", title });
  });
  return out;
}
// 同じ人が同じ件に同じことを続けてしたもの(note を続けて足した等)は1行にまとめて「×2」
function recentActivities(threads) {
  const out = [];
  for (const a of activities(threads).sort((x, y) => y.at.localeCompare(x.at))) {
    const prev = out[out.length - 1];
    if (prev && prev.by === a.by && prev.ref === a.ref && prev.baseWhat === a.what) {
      prev.n++;
      prev.what = `${a.what} ×${prev.n}`;
      continue;
    }
    if (out.length === RECENT_COUNT) break;
    out.push({ ...a, baseWhat: a.what, n: 1 });
  }
  return out;
}

// --- 流れ: 日ごとに開いた件数と片付いた件数(直近14日) ---
// 開いた = ab を立てた日。片付いた = ab を済みにした日。
const FLOW_DAYS = 14;
const C_OPEN = "#6cf";
const C_DONE = "#5aa06a";

function daysBack(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(jstDate(new Date(Date.now() - i * 86400000).toISOString()));
  return out;
}

const closedAt = (t) => (t.status === "closed" ? t.doneAt : "");

function computeFlow(threads, dayKeys) {
  const data = new Map(dayKeys.map((k) => [k, { opened: 0, closed: 0 }]));
  threads.forEach((t) => {
    const o = t.root.createdAt;
    if (o && data.has(jstDate(o))) data.get(jstDate(o)).opened++;
    const c = closedAt(t);
    if (c && data.has(jstDate(c))) data.get(jstDate(c)).closed++;
  });
  return data;
}

// 0 の線から上に「開いた」、下に「片付いた」を伸ばす
function drawFlowBars(svg, dayKeys, data) {
  const W = 320, H = 320;
  const left = 30, right = 10, top = 16, bottom = 40;
  const plotW = W - left - right, plotH = H - top - bottom;
  const maxVal = Math.max(1, ...dayKeys.map((k) => Math.max(data.get(k).opened, data.get(k).closed)));
  const zeroY = top + plotH / 2;
  const half = plotH / 2;
  const step = plotW / dayKeys.length;
  const barW = Math.min(14, step * 0.7);
  const parts = [];

  [-1, -0.5, 0, 0.5, 1].forEach((f) => {
    const y = zeroY - f * half;
    parts.push(`<line x1="${left}" y1="${y}" x2="${W - right}" y2="${y}" stroke="#888" stroke-opacity="${f === 0 ? 0.6 : 0.25}"/>`);
    parts.push(`<text x="${left - 5}" y="${y + 3}" font-size="8" fill="currentColor" opacity="0.65" text-anchor="end">${Math.round(Math.abs(f) * maxVal)}</text>`);
  });

  dayKeys.forEach((k, i) => {
    const { opened, closed } = data.get(k);
    const cx = left + step * i + step / 2;
    const x = cx - barW / 2;
    const hO = (opened / maxVal) * half, hC = (closed / maxVal) * half;
    if (opened) {
      parts.push(`<rect x="${x}" y="${zeroY - hO}" width="${barW}" height="${hO}" fill="${C_OPEN}"/>`);
      parts.push(`<text x="${cx}" y="${zeroY - hO - 3}" font-size="7" fill="currentColor" text-anchor="middle">${opened}</text>`);
    }
    if (closed) {
      parts.push(`<rect x="${x}" y="${zeroY}" width="${barW}" height="${hC}" fill="${C_DONE}"/>`);
      parts.push(`<text x="${cx}" y="${zeroY + hC + 9}" font-size="7" fill="currentColor" text-anchor="middle">${closed}</text>`);
    }
    if (i % 2 === (dayKeys.length - 1) % 2) {
      parts.push(`<text x="${cx}" y="${H - bottom + 14}" font-size="8" fill="currentColor" opacity="0.75" text-anchor="middle">${mdLabel(k)}</text>`);
    }
  });

  parts.push(`<rect x="${left}" y="${H - 16}" width="9" height="9" fill="${C_OPEN}"/>`);
  parts.push(`<text x="${left + 13}" y="${H - 8}" font-size="9" fill="currentColor">開いた(上)</text>`);
  parts.push(`<rect x="${left + 90}" y="${H - 16}" width="9" height="9" fill="${C_DONE}"/>`);
  parts.push(`<text x="${left + 103}" y="${H - 8}" font-size="9" fill="currentColor">片付いた(下)</text>`);

  svg.innerHTML = parts.join("\n");
}

function renderFlowTable(theadRow, tbody, dayKeys, data) {
  theadRow.innerHTML = "<th>日</th><th>開いた</th><th>片付いた</th><th>差</th>";
  tbody.innerHTML = dayKeys.slice().reverse().map((k) => {
    const { opened, closed } = data.get(k);
    const diff = opened - closed;
    return `<tr><td>${mdLabel(k)}</td><td>${opened}</td><td>${closed}</td><td>${diff > 0 ? "+" : ""}${diff}</td></tr>`;
  }).join("");
}

let currentThreads = [];
let weeklyScores = [];
let currentView = "poster";

function render() {
  const svg = document.getElementById("radarSvg");
  const tbody = document.getElementById("radarTableBody");
  const theadRow = document.getElementById("radarTableHead");
  const emptyEl = document.getElementById("radarEmpty");

  if (!currentThreads.length && currentView !== "weekly") {
    emptyEl.style.display = "";
    svg.innerHTML = "";
    tbody.innerHTML = "";
    return;
  }
  emptyEl.style.display = "none";

  if (currentView === "weekly") {
    if (!weeklyScores.length) {
      emptyEl.textContent = "週次得点をまだ取得できていません";
      emptyEl.style.display = "";
      svg.innerHTML = "";
      tbody.innerHTML = "";
      return;
    }
    drawWeeklyBars(svg, weeklyScores);
    renderWeeklyTable(theadRow, tbody, weeklyScores);
    return;
  }

  if (currentView === "flow") {
    const dayKeys = daysBack(FLOW_DAYS);
    const data = computeFlow(currentThreads, dayKeys);
    drawFlowBars(svg, dayKeys, data);
    renderFlowTable(theadRow, tbody, dayKeys, data);
    return;
  }

  if (currentView === "monthly") {
    const monthKeys = monthsBack(MONTH_COUNT);
    const data = computeMonthlyClassification(currentThreads, monthKeys);
    const hasAny = monthKeys.some((k) => monthTotal(data, k) > 0);
    if (!hasAny) {
      svg.innerHTML = "";
      tbody.innerHTML = "";
      emptyEl.textContent = "月次集計できるスレッドがまだありません";
      emptyEl.style.display = "";
      return;
    }
    drawMonthlyBars(svg, monthKeys, data);
    renderMonthlyTable(theadRow, tbody, monthKeys, data);
    return;
  }

  const view = VIEWS[currentView];
  const counts = view.compute(currentThreads);

  drawRadar(svg, counts);
  renderTable(theadRow, tbody, counts, view.labelHeader, view.valueHeader);
}

function setupTabs() {
  const tabs = document.querySelectorAll(".view-tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      currentView = tab.dataset.view;
      tabs.forEach((t) => t.classList.toggle("active", t === tab));
      render();
    });
  });
}

async function load() {
  const emptyEl = document.getElementById("radarEmpty");

  try {
    // ab・ac・ah/af/ae を並べて取ってから1回だけ描く
    const [abThreads, acStale, ledgers] = await Promise.all([
      fetchAbThreads().catch((e) => { console.warn("ab を読めませんでした", e); return []; }),
      fetchAcStale().catch((e) => { console.warn("ac を読めませんでした", e); return []; }),
      fetchLedgers().catch((e) => { console.warn("ah・af・ae を読めませんでした", e); return {}; }),
    ]);
    currentThreads = abThreads;
    renderNow(currentThreads, acStale, ledgers);
    render();
    weeklyScores = await fetchWeeklyScores();
    if (currentView === "weekly") render();
  } catch (e) {
    emptyEl.textContent = `読み込みエラー: ${e.message}`;
    emptyEl.style.display = "";
  }
}

function onLoginSuccess() {
  setupTabs();
  load();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m4-login-success", onLoginSuccess, { once: true });
}
