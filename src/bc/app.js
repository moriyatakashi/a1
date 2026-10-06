// app.js — k2(baレーダーチャート)。baの生ログを読み、
// (1)投稿者別: 投稿者3人を軸にした参加スレッド数、
// (2)分類別: ba-32規約の4分類(案件/確定仕様/気づき/保留論点)ごとのスレッド数
// をタブ切り替えでレーダーチャート表示する。読み取り専用。
// 2026-09-30(Takashi依頼): ba だけでなく ab(家人たちの連絡用、Firestore abThreads)も集計に入れる。
// 投稿者別は ba と ab のスレッドを合わせて数え、分類別・月別には ab に分類が無いので「ab(連絡)」を1つ足す。
// config.jsを自分でimportする(ba-9追補)。HTML側の<script>読込に依存しないため、
// 旧index.htmlがキャッシュされた端末でも壊れない(2026-07-16の表示不具合の恒久対策)。
import "../common/config.js";
import { CLASSIFICATIONS, findClassification } from "../common/utils.js";
const API_BASE = window.AA_API_BASE; // common/config.js から(ba-9)
const BA_API = `${API_BASE}/ba`;
const WEEKLY_API = `${API_BASE}/weekly-scores`;
// ab は Firestore(ab01-9f35a)の abThreads とサブコレクション notes。Rules で誰でも読めるので匿名の REST GET。
const AB_FS = "https://firestore.googleapis.com/v1/projects/ab01-9f35a/databases/(default)/documents/abThreads";
const AB_LABEL = "ab(連絡)";
const CATEGORIES = [...CLASSIFICATIONS, AB_LABEL]; // 分類別・月別の軸(ba の分類 + ab)

async function fsListDocs(url) {
  const docs = [];
  let token = "";
  do {
    const res = await fetch(`${url}?pageSize=300${token ? `&pageToken=${token}` : ""}`, { cache: "no-store" });
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

// ab のスレッドを groupThreads と同じ形({threadId, root, entries})にそろえる。source:"ab" で見分ける。
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

// ba/app.jsのgroupThreadsを踏襲(status判定・PartitionKeyグルーピングのロジックを合わせるため)。
function groupThreads(items) {
  const byThread = new Map();
  items.forEach((it) => {
    if (!byThread.has(it.threadId)) byThread.set(it.threadId, []);
    byThread.get(it.threadId).push(it);
  });

  const threads = [];
  byThread.forEach((entries, threadId) => {
    entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = entries.find((e) => e.id === threadId) || entries[0];
    let status = "open";
    entries.forEach((e) => {
      if (e.type === "status" && e.status) status = e.status;
    });
    threads.push({ threadId, root, entries, status });
  });

  return threads;
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

// 分類別の判定基準: スレッド内のnoteエントリでtagsに4分類のいずれかが付いたもののうち、
// 最も新しいcreatedAtのものを「そのスレッドの現在の分類」とする
// (ba-32運用: 分類の訂正・バックフィルは新しいnoteの追記で上書きする方式のため)。
function computeClassificationCounts(threads) {
  const counts = new Map(CATEGORIES.map((c) => [c, 0]));

  threads.forEach((thread) => {
    const latest = threadClassification(thread);
    if (latest) counts.set(latest, counts.get(latest) + 1);
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

// --- 週次得点(ba-53のweekly-scores API)------------------------------------
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
      const res = await fetch(`${WEEKLY_API}/${key}`, { cache: "no-store" });
      return res.ok ? await res.json() : null;
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
  theadRow.innerHTML = "<th>週(月曜)</th><th>日次</th><th>クローズ</th><th>加点(ba-165)</th><th>合計</th><th>今のルールなら</th>";
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

// --- 月次集計(ba生ログを月別×分類別に集計)------------------------------------
// monthly-scores API(ba-165③)が未稼働のため、baの生ログを月別に集計して積み上げ棒で描く。
// 各スレッドを root の作成月に計上し、分類(ba-32/ba-181の6分類)ごとに積み上げる。
// 分類はcomputeClassificationCountsと同じく「最新のnoteに付いた分類」を採用する。
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

// スレッドの現在分類(computeClassificationCountsと同じ判定: 最新のnoteに付いた分類)
// ab のスレッドは分類を持たないので AB_LABEL。
function threadClassification(thread) {
  if (thread.source === "ab") return AB_LABEL;
  let latest = null; // entriesはcreatedAt昇順ソート済みなので、最後に見つかったものが最新
  thread.entries.forEach((e) => {
    const found = findClassification(e.tags);
    if (found) latest = found;
  });
  return latest;
}

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
  classification: {
    compute: computeClassificationCounts,
    labelHeader: "分類",
    valueHeader: "スレッド数",
  },
};

// --- 今の状態(2026-10-03、ab-45): 累計のチャートだけだと「今どうなっているか」が見えないので、上に置く ---
// ab: 開いている件数、返事待ち(返事が要る・済んでいない)の宛先ごとの数、最後の動きが古い順の5件。
// ba: 開いている件数(Takashi が無効にしたものは除く)。ba の古い open は ab へ移していく途中(ab-45 の時点で約55件)。
const AB_TO_NAMES = { all: "みんな", rishiri: "利尻", suma: "すま", rebun: "礼文", teuri: "天売" };
// 投稿者名(by)→家人の名前。b1 の ai_family.json の ba_lane / aa_lane と同じ対応(変えたらここも直す)
const BY_NAMES = { "claude-pc": "利尻", "claude-mobile": "すま", "claude-pi": "礼文", "claude-teuri": "天売", takashi: "Takashi" };
const byName = (by) => BY_NAMES[by] || by;
const STALE_COUNT = 5;
const RECENT_COUNT = 8;

// タイトルを直しただけの自動 note(ab-edit が残す「タイトルを変えた(旧: …)」)は動きに数えない
function lastActivity(thread) {
  return thread.entries.reduce((m, e) => (!e.retitle && e.createdAt > m ? e.createdAt : m), "");
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function isBaVoided(thread) {
  // ba の void は最後に付いたものが効く(value=true で無効)
  const voids = thread.entries.filter((e) => e.type === "void");
  return voids.length > 0 && voids[voids.length - 1].value === true;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderNow(threads) {
  const el = document.getElementById("nowPanel");
  const abOpen = threads.filter((t) => t.source === "ab" && t.status !== "closed");
  const baOpen = threads.filter((t) => t.source !== "ab" && t.status !== "closed" && !isBaVoided(t));
  if (!abOpen.length && !baOpen.length) { el.style.display = "none"; return; }

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
      <span class="now-label now-gap">ba 開いている</span><b>${baOpen.length}</b> 件</div>
    <div class="now-row"><span class="now-label">返事待ち(ab)</span>${waitingHtml}</div>
    ${waitHtml ? `<div class="now-label">待ち(ab)</div><ul class="now-list now-wait">${waitHtml}</ul>` : ""}
    <div class="now-label">最後の動きが古い ab</div>
    <ol class="now-stale">${staleHtml}</ol>
    <div class="now-label">最近の動き(ba・ab)</div>
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

// --- 最近の動き: ba・ab の書き込みを新しい順に。タイトルを直しただけの自動 note は出さない ---
const BA_KIND = { new: "立てた", note: "note", correction: "訂正", link: "リンク", gist: "gist", retitle: "タイトル変更", react: "反応" };
function activities(threads) {
  const out = [];
  threads.forEach((t) => {
    const ab = t.source === "ab";
    const ref = `${ab ? "ab" : "ba"}-${t.root.seq}`;
    const title = t.root.title || "";
    t.entries.forEach((e) => {
      if (!e.createdAt || e.retitle) return;
      let what;
      if (ab) what = e === t.root ? "立てた" : "note";
      else if (e.type === "status") what = e.status === "closed" ? "閉じた" : "開け直した";
      else if (e.type === "void") what = e.value ? "無効にした" : "無効を戻した";
      else what = BA_KIND[e.type] || e.type || "note";
      out.push({ at: e.createdAt, by: e.by, ref, what, title });
    });
    if (ab && t.status === "closed" && t.doneAt) out.push({ at: t.doneAt, by: t.doneBy, ref, what: "済み", title });
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
// 開いた = ab・ba のスレッドを立てた日。片付いた = ab は済みにした日、ba は最後に閉じた日(今も閉じているものだけ)。
// ba で無効にしたもの(打ち間違い等)はどちらにも数えない。
const FLOW_DAYS = 14;
const C_OPEN = "#6cf";
const C_DONE = "#5aa06a";

function daysBack(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(jstDate(new Date(Date.now() - i * 86400000).toISOString()));
  return out;
}

function closedAt(t) {
  if (t.status !== "closed") return "";
  if (t.source === "ab") return t.doneAt;
  const st = t.entries.filter((e) => e.type === "status");
  return st.length ? st[st.length - 1].createdAt : "";
}

function computeFlow(threads, dayKeys) {
  const data = new Map(dayKeys.map((k) => [k, { opened: 0, closed: 0 }]));
  threads.forEach((t) => {
    if (t.source !== "ab" && isBaVoided(t)) return;
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
    // ba と ab を並べて取ってから1回だけ描く。ab が読めなくても ba だけで描く。
    const [items, abThreads] = await Promise.all([
      fetch(BA_API, { cache: "no-store" }).then((res) => (res.ok ? res.json() : [])),
      fetchAbThreads().catch((e) => { console.warn("ab を読めませんでした", e); return []; }),
    ]);
    currentThreads = [...groupThreads(items), ...abThreads];
    renderNow(currentThreads);
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
  window.addEventListener("bc-login-success", onLoginSuccess, { once: true });
}
