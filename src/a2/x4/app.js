import "../../common/config.js";
import { todayStr } from "../../common/utils.js";
// 2026-10-02: 毎日スコアの正本は ab-24 から Firestore。ここは Azure の /api/scores に PUT していて
// 410 で「保存に失敗しました」になっていたので、m1 と同じ common/score-store.js 経由に切り替えた。
import { fetchScore, fetchAllScores, saveScore, saveErrorText, SCORE_MIN, SCORE_MAX, SCORE_SOFT_MAX } from "../../common/score-store.js";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const Y_MIN = 60;
const Y_MAX = 120; // ab-43: 0〜120
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
  // 普段は 100 まで。「120まで」で広げる(もう一度押すと戻す)。100 を超えた日を開いたときは広げておく
  const elBtnWide = document.getElementById("btnWide");
  function setWide(on) {
    elSlider.max = on ? SCORE_MAX : SCORE_SOFT_MAX;
    elBtnWide.setAttribute("aria-pressed", String(on));
    elScoreNum.textContent = elSlider.value; // 狭めたとき 100 を超えていた値は 100 に丸まる
  }
  elBtnWide.addEventListener("click", () => setWide(Number(elSlider.max) !== SCORE_MAX));

  function setScore(val) {
    const v = Math.min(SCORE_MAX, Math.max(SCORE_MIN, Number(val)));
    setWide(v > SCORE_SOFT_MAX);
    elSlider.value = v;
    elScoreNum.textContent = v;
  }
  elSlider.addEventListener("input", () => {
    elScoreNum.textContent = elSlider.value;
  });
  async function loadTodayScore() {
    try {
      const data = await fetchScore(today);
      if (data) {
        setScore(data.score);
        elNoteInput.value = data.note || "";
        elBtnSaveScore.textContent = "更新";
      } else {
        setScore(80);
        elBtnSaveScore.textContent = "保存";
      }
    } catch (e) {
      setScore(80);
    }
  }
  elBtnSaveScore.addEventListener("click", async () => {
    if (!window.__credential) {
      elScoreSaved.textContent = "保存にはログインが必要です";
      if (window.aaShowLoginGate) window.aaShowLoginGate();
      return;
    }
    const score = Number(elSlider.value);
    const note = elNoteInput.value.trim();
    try {
      await saveScore(today, score, note);
      elBtnSaveScore.textContent = "更新";
      elScoreSaved.textContent = "✓ 保存しました";
      setTimeout(() => elScoreSaved.textContent = "", 2000);
      // 読み直さず、開いたときに読んだ一覧の今日の分だけ差し替えて描き直す(ab-97)
      if (_scoreRows) _scoreRows = [..._scoreRows.filter((r) => r.date !== today), { date: today, score, note }];
      load(_scoreRows);
    } catch (e) {
      elScoreSaved.textContent = saveErrorText(e);
    }
  });
  loadTodayScore();
}
// 開いたときに読んだ scores(読めなかったら null)。保存後の描き直しに使い回す(ab-97)。
let _scoreRows = null;
async function load(cached = null) {
  const chartSection = document.getElementById("scoreChartSection");
  chartSection.style.display = "none";
  try {
    const scoreRows = cached || (_scoreRows = await fetchAllScores());
    const scoreMap = {};
    scoreRows.forEach(r => {
      if (DATE_RE.test(r.date) && typeof r.score === "number") {
        scoreMap[r.date] = { score: r.score, note: r.note || "" };
      }
    });
    const chartRows = Object.entries(scoreMap)
      .map(([date, v]) => ({ date, score: v.score, note: v.note }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (chartRows.length > 0) {
      chartSection.style.display = "block";
      drawChart(document.getElementById("scoreSvg"), chartRows);
      renderStats(chartRows);
    }
  } catch (e) {
    console.error(e);
  }
}
function onLoginSuccess() {
  initScoreInput();
  load();
}
if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("x4-login-success", onLoginSuccess, { once: true });
}
