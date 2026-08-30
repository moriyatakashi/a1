// [a2学習用] スコア保存はlocalStorageのみ。本番baにもネットにも一切送らない。


import "../common/config.js";
import { todayStr } from "../common/utils.js";

const LS_KEY = "a2_m1_scores";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function lsGetAll() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch (e) { return {}; }
}
function lsSetAll(obj) {
  localStorage.setItem(LS_KEY, JSON.stringify(obj));
}
function lsGetDay(date) {
  const all = lsGetAll();
  return all[date] || null;
}
function lsPutDay(date, entry) {
  const all = lsGetAll();
  all[date] = entry;
  lsSetAll(all);
}

function seedIfEmpty() {
  if (Object.keys(lsGetAll()).length > 0) return;
  const seed = {
    "2026-08-24": { score: 78, note: "サンプル" },
    "2026-08-25": { score: 82, note: "サンプル" },
    "2026-08-26": { score: 75, note: "サンプル" },
    "2026-08-27": { score: 88, note: "サンプル" },
    "2026-08-28": { score: 84, note: "サンプル" },
    "2026-08-29": { score: 91, note: "サンプル" },
  };
  lsSetAll(seed);
}

const Y_MIN = 60;
const Y_MAX = 100;
const VB_W = 680, VB_H = 300;
const MARGIN = { top: 16, right: 16, bottom: 32, left: 34 };
const PLOT_W = VB_W - MARGIN.left - MARGIN.right;
const PLOT_H = VB_H - MARGIN.top - MARGIN.bottom;

function svgEl(tag, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}
function xFor(i, n) {
  return MARGIN.left + (n === 1 ? PLOT_W / 2 : (i / (n - 1)) * PLOT_W);
}
function yFor(v) {
  return MARGIN.top + PLOT_H - ((v - Y_MIN) / (Y_MAX - Y_MIN)) * PLOT_H;
}

function drawChart(svg, rows) {
  svg.innerHTML = "";
  const n = rows.length;

  const yTicks = [];
  for (let t = Y_MIN; t <= Y_MAX; t += 10) yTicks.push(t);
  yTicks.forEach((t) => {
    svg.appendChild(svgEl("line", {
      class: t === Y_MIN ? "baseline" : "gridline",
      x1: MARGIN.left, x2: MARGIN.left + PLOT_W, y1: yFor(t), y2: yFor(t),
    }));
    const label = svgEl("text", { class: "axis-label", x: MARGIN.left - 8, y: yFor(t) + 4, "text-anchor": "end" });
    label.textContent = t;
    svg.appendChild(label);
  });

  const labelStep = Math.max(1, Math.ceil(n / 8));
  rows.forEach((r, i) => {
    if (i % labelStep === 0 || i === n - 1) {
      const label = svgEl("text", { class: "axis-label", x: xFor(i, n), y: VB_H - 8, "text-anchor": "middle" });
      label.textContent = r.date.slice(5).replace("-", "/");
      svg.appendChild(label);
    }
  });

  let areaD = `M ${xFor(0, n)} ${yFor(Y_MIN)} `;
  rows.forEach((r, i) => { areaD += `L ${xFor(i, n)} ${yFor(r.score)} `; });
  areaD += `L ${xFor(n - 1, n)} ${yFor(Y_MIN)} Z`;
  svg.appendChild(svgEl("path", { class: "score-area", d: areaD }));

  let lineD = "";
  rows.forEach((r, i) => { lineD += (i === 0 ? "M" : "L") + ` ${xFor(i, n)} ${yFor(r.score)} `; });
  svg.appendChild(svgEl("path", { class: "score-line", d: lineD }));

  const dots = rows.map((r, i) => {
    const dot = svgEl("circle", { class: "score-dot", cx: xFor(i, n), cy: yFor(r.score), r: 4 });
    svg.appendChild(dot);
    return dot;
  });

  const crosshair = svgEl("line", { class: "crosshair", y1: MARGIN.top, y2: MARGIN.top + PLOT_H });
  svg.appendChild(crosshair);

  const tooltip = document.getElementById("scoreTooltip");
  const hitArea = svgEl("rect", { class: "hit-area", x: MARGIN.left, y: MARGIN.top, width: PLOT_W, height: PLOT_H });
  svg.appendChild(hitArea);

  function showTooltip(i) {
    const r = rows[i];
    dots.forEach((dot, j) => dot.setAttribute("r", j === i ? 6 : 4));
    crosshair.setAttribute("x1", xFor(i, n));
    crosshair.setAttribute("x2", xFor(i, n));
    crosshair.style.opacity = 1;
    tooltip.innerHTML = `<div class="t-date">${r.date}</div><div class="t-score">${r.score} 点${r.note ? " — " + r.note : ""}</div>`;
    tooltip.style.opacity = 1;
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / VB_W;
    tooltip.style.left = (rect.left + xFor(i, n) * scaleX + 12 + window.scrollX) + "px";
    tooltip.style.top = (rect.top + yFor(r.score) * scaleX - 36 + window.scrollY) + "px";
  }
  function hideTooltip() {
    dots.forEach((dot) => dot.setAttribute("r", 4));
    crosshair.style.opacity = 0;
    tooltip.style.opacity = 0;
  }

  hitArea.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / VB_W;
    const mx = (e.clientX - rect.left) / scaleX;
    let closest = 0, minDist = Infinity;
    rows.forEach((r, i) => {
      const dist = Math.abs(xFor(i, n) - mx);
      if (dist < minDist) { minDist = dist; closest = i; }
    });
    showTooltip(closest);
  });
  hitArea.addEventListener("mouseleave", hideTooltip);
}

function renderStats(rows) {
  const scores = rows.map((r) => r.score);
  const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  document.getElementById("statLatest").textContent = scores[scores.length - 1];
  document.getElementById("statAvg").textContent = avg;
  document.getElementById("statMax").textContent = Math.max(...scores);
  document.getElementById("statMin").textContent = Math.min(...scores);
}

function initScoreInput() {
  const today = todayStr();
  const elScoreDate = document.getElementById("scoreDate");
  const elSlider = document.getElementById("slider");
  const elScoreNum = document.getElementById("scoreNum");
  const elNoteInput = document.getElementById("noteInput");
  const elBtnSaveScore = document.getElementById("btnSaveScore");
  const elScoreSaved = document.getElementById("scoreSaved");

  elScoreDate.textContent = today;

  function setScore(val) {
    const v = Math.min(100, Math.max(0, Number(val)));
    elSlider.value = v;
    elScoreNum.textContent = v;
  }

  elSlider.addEventListener("input", () => {
    elScoreNum.textContent = elSlider.value;
  });

  function loadTodayScore() {
    const data = lsGetDay(today);
    if (data) {
      setScore(data.score);
      elNoteInput.value = data.note || "";
      elBtnSaveScore.textContent = "更新";
    } else {
      setScore(80);
      elBtnSaveScore.textContent = "保存";
    }
  }

  elBtnSaveScore.addEventListener("click", () => {

    const score = Number(elSlider.value);
    const note = elNoteInput.value.trim();
    lsPutDay(today, { score, note });
    elBtnSaveScore.textContent = "更新";
    elScoreSaved.textContent = "✓ 保存しました(このブラウザ内)";
    setTimeout(() => elScoreSaved.textContent = "", 2000);
    load();
  });

  loadTodayScore();
}

function load() {
  const chartSection = document.getElementById("scoreChartSection");
  chartSection.style.display = "none";

  const scoreMap = lsGetAll();
  const chartRows = Object.entries(scoreMap)
    .filter(([date, v]) => DATE_RE.test(date) && v && typeof v.score === "number")
    .map(([date, v]) => ({ date, score: v.score, note: v.note || "" }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (chartRows.length > 0) {
    chartSection.style.display = "block";
    drawChart(document.getElementById("scoreSvg"), chartRows);
    renderStats(chartRows);
  }
}

function bootSandbox() {
  const gate = document.getElementById("login-gate");
  const content = document.getElementById("content");
  if (gate) gate.style.display = "none";
  if (content) content.style.display = "block";
  seedIfEmpty();
  initScoreInput();
  load();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootSandbox, { once: true });
} else {
  bootSandbox();
}
