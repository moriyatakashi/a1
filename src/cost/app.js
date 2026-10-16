// app.js — 課金の指数(ab-171、2026-10-17 利尻)。トップの一覧に載せない別のページ(Takashi 10/11 Q3 A)。
// 礼文が週1回 aa-lane の cost-index-set で書く Firestore costIndex を読むだけ(書かない)。読みは Takashi 本人だけ(Rules)。
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureReadLogin, guardRead } from "../common/firebase.js";
import { seriesByProvider, zeroStreak, points, md } from "./cost.js";

const NAMES = { azure: "Azure" };
const W = 600, H = 220;
const $ = (id) => document.getElementById(id);

function chart(series) {
  const p = points(series, W, H, 16);
  const top = Math.max(100, ...series.map((s) => s.index));
  const y100 = Math.round((H - 16 - (100 / top) * (H - 32)) * 10) / 10;
  const labels = p.filter((_, i) => i === 0 || i === p.length - 1 || i % 4 === 0)
    .map((q) => `<text x="${q.x}" y="${H - 2}" text-anchor="middle">${md(q.week)}</text>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="週ごとの指数の折れ線">
    <line class="base" x1="0" x2="${W}" y1="${y100}" y2="${y100}"></line><text x="2" y="${y100 - 3}">100</text>
    <polyline points="${p.map((q) => `${q.x},${q.y}`).join(" ")}"></polyline>
    ${p.map((q) => `<circle cx="${q.x}" cy="${q.y}" r="3"><title>${md(q.week)}の週 ${q.index}</title></circle>`).join("")}
    ${labels}
  </svg>`;
}

function section(provider, series) {
  const last = series[series.length - 1];
  const zeros = zeroStreak(series);
  const rows = series.slice(-8).reverse().map((s) => `<tr><td>${md(s.week)}の週</td><td>${s.index}</td></tr>`).join("");
  return `<h2>${NAMES[provider] || provider}</h2>
    <p class="now">${md(last.week)}の週 <b>${last.index}</b></p>
    <p class="sub">${zeros ? `0 が ${zeros}週続いています` : "0 ではありません"}</p>
    ${chart(series)}
    <table><tr><th>週</th><th>指数</th></tr>${rows}</table>`;
}

async function onLoginSuccess() {
  let rows;
  try {
    await ensureReadLogin();
    const snap = await guardRead(() => getDocs(collection(db, "costIndex")));
    rows = snap.docs.map((d) => d.data());
  } catch (e) {
    $("providers").innerHTML = `<p class="empty">指数を読めませんでした(${e.code || e.message})。開き直してください。</p>`;
    return;
  }
  const all = seriesByProvider(rows);
  const names = Object.keys(all);
  $("providers").innerHTML = names.length
    ? names.map((p) => section(p, all[p])).join("")
    : `<p class="empty">まだ指数がありません(礼文が月曜 2:55 に書きます)。</p>`;
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("cost-login-success", onLoginSuccess, { once: true });
}
