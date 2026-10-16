// app.js — 処理の様子(2026-10-17 利尻)。トップの一覧には載せない(トップの頭の1行の「詳しく」から来る)。
// 毎日の処理ごとに 最後に成功した時刻・最後に失敗した時刻・いまの状態 を1行で並べる。読むだけ。
import { loadItems } from "./load.js";
import { STATE_LABEL, jst } from "./jobs.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function row(i) {
  const note = i.state === "ng" || i.state === "unknown" ? i.note || i.error || "" : "";
  return `<tr class="st-${i.state}">
    <td><b>${esc(i.name)}</b><div class="when">${esc(i.when)}</div></td>
    <td class="state">${STATE_LABEL[i.state]}</td>
    <td>${jst(i.okAt)}</td>
    <td>${jst(i.ngAt)}</td>
  </tr>${note ? `<tr class="st-${i.state} note-row"><td colspan="4">${esc(note)}</td></tr>` : ""}`;
}

async function onLoginSuccess() {
  let items;
  try {
    items = await loadItems();
  } catch (e) {
    $("jobs").innerHTML = `<p class="empty">読めませんでした(${esc(e.code || e.message)})。開き直してください。</p>`;
    return;
  }
  $("jobs").innerHTML = `<table>
    <thead><tr><th>処理</th><th>いま</th><th>最後の成功</th><th>最後の失敗</th></tr></thead>
    <tbody>${items.map(row).join("")}</tbody></table>`;
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("jobs-login-success", onLoginSuccess, { once: true });
}
