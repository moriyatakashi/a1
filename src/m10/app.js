// app.js — m10「歩数」(ab-128、2026-10-15 利尻)。
// iPhone のショートカットが毎晩 23:50 に aa-lane の steps-set で書く Firestore steps/{日付} を読むだけ(書かない)。
// 週ごとの棒グラフ、棒を押すとその週の日ごとの数字(すま 10/13 Takashi の答え Q5 B)。点数には入れない(10/9)。
// steps の読みは Takashi 本人だけ(Rules)なので、Firebase のログインが要る(読めないときは common/firebase.js の帯)。
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureReadLogin, guardRead } from "../common/firebase.js";
import { groupByWeek, dailyAverage, md, WEEKDAYS } from "./steps.js";

const SHOW_WEEKS = 12;
const $ = (id) => document.getElementById(id);
const num = (n) => n.toLocaleString("ja-JP");
const todayJst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

let weeks = [];
let cur = -1;

async function fetchSteps() {
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "steps")));
  return snap.docs.map((d) => ({ date: d.id, ...d.data() }));
}

function renderBars() {
  const shown = weeks.slice(-SHOW_WEEKS);
  const offset = weeks.length - shown.length;
  const max = Math.max(1, ...shown.map((w) => w.total));
  $("bars").innerHTML = shown.map((w, j) => {
    const i = offset + j;
    const h = w.total ? Math.max(2, Math.round((w.total / max) * 100)) : 0;
    return `<button class="bar${i === cur ? " on" : ""}" type="button" data-i="${i}" aria-pressed="${i === cur}"
      aria-label="${md(w.start)}の週 ${num(w.total)}歩">
      <span class="val">${w.recorded ? num(w.total) : "—"}</span>
      <span class="col"><span class="fill" style="height:${h}%"></span></span>
      <span class="lbl">${md(w.start)}</span>
    </button>`;
  }).join("");
}

function renderWeek() {
  const w = weeks[cur];
  const avg = dailyAverage(w);
  $("weekHead").textContent = `${md(w.start)}〜${md(w.days[6].date)} の週`;
  $("weekMeta").textContent = w.recorded
    ? `合計 ${num(w.total)}歩 / 1日あたり ${num(avg)}歩(記録のある ${w.recorded}日で割る)`
    : "この週は記録がありません";
  const max = Math.max(1, ...w.days.map((d) => d.steps || 0));
  $("days").innerHTML = w.days.map((d, i) => `
    <div class="drow">
      <span class="dd">${md(d.date)}(${WEEKDAYS[i]})</span>
      <span class="dbar"><span class="fill" style="width:${d.steps ? Math.max(1, Math.round((d.steps / max) * 100)) : 0}%"></span></span>
      <span class="dn${d.steps === null ? " none" : ""}">${d.steps === null ? "記録なし" : num(d.steps) + "歩"}</span>
    </div>`).join("");
}

function render() {
  renderBars();
  renderWeek();
}

async function onLoginSuccess() {
  let rows;
  try {
    rows = await fetchSteps();
  } catch (e) {
    $("bars").innerHTML = `<p class="empty">歩数を読めませんでした(${e.code || e.message})。開き直してください。</p>`;
    return;
  }
  weeks = groupByWeek(rows, todayJst());
  if (!weeks.length) {
    $("bars").innerHTML = `<p class="empty">まだ歩数の記録がありません。</p>`;
    return;
  }
  cur = weeks.length - 1;
  $("bars").addEventListener("click", (e) => {
    const b = e.target.closest(".bar");
    if (!b) return;
    cur = +b.dataset.i;
    render();
  });
  $("week").hidden = false;
  render();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m10-login-success", onLoginSuccess, { once: true });
}
