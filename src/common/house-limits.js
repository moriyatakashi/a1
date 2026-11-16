// house-limits.js — トップの「家の枠」の横棒(b1 ah-190、2026-11-17 礼文)。
// houseLimits/{家}_{日付} = {house, date, usedPercent?, amount?, unit?, window?, resetsAt?}(礼文の cron が毎朝1件書く、読みは Takashi 本人だけ)。
// 家ごとにいちばん新しい日の1件を、使った割合(%)の横棒で出す。割合の無い家(安藤家の量など)はまだ出さない。
// 読めない・1件も無いときは出さない。休日の線(af-155)は、決まったら .hlim-track の中に縦線を足す。
const NAMES = { oi: "大井家", ando: "安藤家" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 家ごとに date がいちばん新しく、usedPercent のあるもの。家の順は NAMES の順
export function latestByHouse(docs) {
  const best = {};
  for (const d of docs) {
    if (!d || typeof d.usedPercent !== "number" || !NAMES[d.house]) continue;
    if (!best[d.house] || d.date > best[d.house].date) best[d.house] = d;
  }
  return Object.keys(NAMES).filter((h) => best[h]).map((h) => best[h]);
}

export function renderRows(rows) {
  return rows.map((d) => {
    const pct = Math.max(0, Math.min(100, d.usedPercent));
    const note = [d.window ? `${d.window}の枠` : "", d.resetsAt ? `${d.resetsAt} に戻る` : "", `${d.date} 時点`]
      .filter(Boolean).join("・");
    return `<div class="hlim-row"><span class="hlim-name">${esc(NAMES[d.house])}</span>`
      + `<span class="hlim-track"><span class="hlim-bar" style="width:${pct}%"></span></span>`
      + `<span class="hlim-pct">${esc(pct)}%</span></div><p class="hlim-note">${esc(note)}</p>`;
  }).join("");
}

export async function showHouseLimits(el) {
  const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js");
  const { db, ensureReadLogin } = await import("./firebase.js");
  await ensureReadLogin();
  const snap = await getDocs(collection(db, "houseLimits"));
  const rows = latestByHouse(snap.docs.map((d) => d.data()));
  if (!rows.length) return;
  el.innerHTML = `<div class="hlim-head">家の枠(使った割合)</div>${renderRows(rows)}`;
  el.hidden = false;
}
