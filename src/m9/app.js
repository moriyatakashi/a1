// app.js — m9「打倒あすけん」(ab-177、2026-10-12 すま)。
// 食べる前に候補を選ぶと、1食ずつの点と1日の合計を予測する。表は同じフォルダの foods.json(Q6 C: 最初は a1 のファイル)。
// 選んだものは残さない(Q8 A)。開き直すと空に戻る。
import { mealSummary, daySummary, missingText, MEAL_BONUS } from "./score.js";

const ORDER = ["主食", "たんぱく", "野菜", "果物", "乳", "その他"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dots = (n) => "●".repeat(n);

let FOODS = [];
let meals = [[], []];   // 既定は二食
let cur = 0;

function renderTabs() {
  const tabs = meals.map((m, i) => {
    const s = mealSummary(m);
    return `<button class="tab${i === cur ? " on" : ""}" type="button" data-i="${i}" aria-pressed="${i === cur}">${i + 1}食目 ${s.count ? s.total + "点" : ""}</button>`;
  });
  if (meals.length < 4) tabs.push(`<button class="tab" type="button" data-add="1">＋食事</button>`);
  $("tabs").innerHTML = tabs.join("");
}

function render() {
  renderTabs();
  const m = meals[cur];
  const s = mealSummary(m);
  $("picked").innerHTML = m.length
    ? m.map((f, i) => `<button class="chip" type="button" data-rm="${i}" aria-label="${esc(f.name)}を外す">${esc(f.name)} ×</button>`).join("")
    : `<span class="empty">下の表から選んでください</span>`;
  $("mealLine").textContent = s.count
    ? `${cur + 1}食目 ${s.total}点(${s.base}${s.bonus ? ` + そろい ${MEAL_BONUS}` : ""}) / ¥${s.yen} / 手間 ${dots(s.tema)}${s.warns.length ? " / " + s.warns.join("・") : ""}`
    : `${cur + 1}食目 まだ選んでいません`;
  $("mealLack").textContent = s.count ? missingText(s.missing) : "";

  const d = daySummary(meals);
  $("dayTotal").innerHTML = `${d.total}<small> 点</small>`;
  $("dayMeta").textContent = d.meals ? `${d.meals}食 / ¥${d.yen} / 手間 ${d.tema} / そろった食事 ${d.bonusMeals}` : "まだ選んでいません";
  $("dayLack").textContent = d.meals ? missingText(d.missing) : "";

  const counts = new Map();
  m.forEach((f) => counts.set(f.name, (counts.get(f.name) || 0) + 1));
  document.querySelectorAll(".food").forEach((b) => {
    const n = counts.get(b.dataset.name) || 0;
    b.classList.toggle("in", n > 0);
    b.querySelector(".ct").textContent = n ? ` ×${n}` : "";
  });
}

function buildGroups() {
  const groups = new Map(ORDER.map((g) => [g, []]));
  FOODS.forEach((f, i) => groups.get(ORDER.includes(f.kinds[0]) ? f.kinds[0] : "その他").push([f, i]));
  $("groups").innerHTML = [...groups].filter(([, l]) => l.length).map(([g, l]) => `
    <section class="group"><h2>${g}</h2><div class="foods">${l.map(([f, i]) => `
      <button class="food" type="button" data-i="${i}" data-name="${esc(f.name)}">
        <span class="nm">${esc(f.name)}<span class="ct"></span></span>
        <span class="mt">${f.point}点 / ¥${f.yen} / ${dots(f.tema)}</span>
        ${f.warn ? `<span class="wn">${esc(f.warn)}</span>` : ""}
      </button>`).join("")}</div></section>`).join("");
}

async function onLoginSuccess() {
  try {
    const res = await fetch("foods.json", { cache: "no-store" });
    FOODS = (await res.json()).foods || [];
  } catch (e) {
    $("groups").innerHTML = `<p class="empty">食べ物の表を読めませんでした。開き直してください。</p>`;
    return;
  }
  buildGroups();
  $("groups").addEventListener("click", (e) => {
    const b = e.target.closest(".food");
    if (!b) return;
    meals[cur].push(FOODS[+b.dataset.i]);
    render();
  });
  $("picked").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (!b) return;
    meals[cur].splice(+b.dataset.rm, 1);
    render();
  });
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest(".tab");
    if (!b) return;
    if (b.dataset.add) { meals.push([]); cur = meals.length - 1; } else { cur = +b.dataset.i; }
    render();
  });
  $("btnClear").addEventListener("click", () => { meals[cur] = []; render(); });
  render();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m9-login-success", onLoginSuccess, { once: true });
}
