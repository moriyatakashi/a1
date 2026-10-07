// app.js — ab/src/main/m1(記録一覧)のロジックをaa向けに移植したもの。
// 画面側ログインゲートを通過した後にのみデータを取得・表示する。スコアは ab-24 から Firestore(下記)。
// config.jsを自分でimportする(ba-9追補)。HTML側の<script>読込に依存しないため、
// 旧index.htmlがキャッシュされた端末でも壊れない(2026-07-16の表示不具合の恒久対策)。
import "../common/config.js";
import { todayStr } from "../common/utils.js";
// ab-24(2026-09-29、方式B): 毎日スコアの正本は Firestore ab01-9f35a の scores/{日付}。
// 読み書きとログインは common/score-store.js(a2/x4 と共用、2026-10-02 に切り出し)。
import { fetchScore, fetchAllScores, saveScore, saveErrorText, SCORE_MIN, SCORE_MAX, SCORE_SOFT_MAX,
  fetchCheckItems, fetchItemShelf, saveCheckItems, checkScore, MARKS, markOf } from "../common/score-store.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// be(スコア推移グラフ)統合分(2026-07-29): n1が既に持つscoreMapを描画するだけで、
// 独自fetchは持たない。k2のページ構造・ログイン待ちパターンを踏襲していた元コードのまま移植。
// 下端は60。チェックの点(ab-43、0〜100)がそれより下にあるときだけ下げる(drawChart で決める)。
const Y_MIN_DEFAULT = 60;
let Y_MIN = Y_MIN_DEFAULT;
const Y_MAX = 120; // ab-43: 0〜120(100=感覚の満点)
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
  const checkMin = Math.min(...rows.filter((r) => typeof r.check === "number").map((r) => r.check));
  Y_MIN = Math.min(Y_MIN_DEFAULT, Math.floor(checkMin / 20) * 20);
  const tickStep = Y_MAX - Y_MIN > 80 ? 20 : 10;

  const yTicks = [];
  for (let t = Y_MIN; t <= Y_MAX; t += tickStep) yTicks.push(t);
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

  // ab-43: チェックの点(2本目、破線)。付いている日だけをつなぐ。
  let checkD = "";
  rows.forEach((r, i) => {
    if (typeof r.check !== "number") return;
    checkD += (checkD ? "L" : "M") + ` ${xFor(i, n)} ${yFor(r.check)} `;
    svg.appendChild(svgEl("circle", { class: "check-dot", cx: xFor(i, n), cy: yFor(r.check), r: 3 }));
  });
  if (checkD) svg.appendChild(svgEl("path", { class: "check-line", d: checkD }));

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
    tooltip.innerHTML = `<div class="t-date">${r.date}</div><div class="t-score">${r.score} 点${typeof r.check === "number" ? ` / チェック ${r.check} 点` : ""}${r.note ? " — " + r.note : ""}</div>`;
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

// スコア入力(ab/src/main/n1のスコア機能を移植)
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

  // ab-43: チェック項目。checkItems = [{id, text, done, mark}](今日の分)。読めなければ(Rules未デプロイなど)欄ごと出さない。
  // ab-129(2026-10-07): できた/できない の2択を ○・△・× の3段階にした。押していない項目は △(Takashi 2026-10-08、前は ×)。
  const elCheckBox = document.getElementById("checkBox");
  const elCheckList = document.getElementById("checkList");
  const elCheckScoreNum = document.getElementById("checkScoreNum");
  const elCheckEdit = document.getElementById("checkEdit");
  const elItemInputs = document.getElementById("itemInputs");
  const elItemShelf = document.getElementById("itemShelf");
  const elItemsSaved = document.getElementById("itemsSaved");
  let checkItems = [];

  function renderChecks() {
    elCheckList.innerHTML = "";
    if (!checkItems.length) {
      elCheckList.innerHTML = '<div class="check-empty">項目がありません(「項目を変える」から入れる)</div>';
    }
    checkItems.forEach((it) => {
      const row = document.createElement("div");
      row.className = "check-item";
      const marks = document.createElement("span");
      marks.className = "check-marks";
      for (const m of MARKS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "mark";
        b.textContent = m;
        b.setAttribute("aria-pressed", String(markOf(it) === m));
        b.setAttribute("aria-label", `${it.text}: ${m}`);
        b.addEventListener("click", () => { it.mark = m; it.done = m === "○"; renderChecks(); });
        marks.appendChild(b);
      }
      const text = document.createElement("span");
      text.className = "check-text";
      text.textContent = it.text;
      row.append(marks, text);
      elCheckList.appendChild(row);
    });
    elCheckScoreNum.textContent = checkItems.length ? checkScore(checkItems) : "—";
  }

  // 今の項目に、今日すでに付けた印(同じ id)を重ねる。印の無い項目は △ から。古い記録(done だけ)は ○/× として読む。
  function mergeDone(items, saved) {
    const marks = new Map(((saved && saved.items) || []).map((i) => [i.id, markOf(i)]));
    return items.map((i) => {
      const mark = marks.get(i.id) || "△";
      return { id: i.id, text: i.text, done: mark === "○", mark };
    });
  }

  async function openItemEdit() {
    elItemInputs.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const input = document.createElement("input");
      input.className = "note-input item-input";
      input.setAttribute("list", "itemShelf");
      input.placeholder = `項目${i + 1}(棚から選ぶか新しく書く)`;
      input.value = (checkItems[i] && checkItems[i].text) || "";
      elItemInputs.appendChild(input);
    }
    elCheckEdit.style.display = "block";
    try {
      const shelf = await fetchItemShelf();
      elItemShelf.innerHTML = "";
      shelf.forEach((s) => { const o = document.createElement("option"); o.value = s.text; elItemShelf.appendChild(o); });
    } catch (e) {
      console.warn("棚の読み込みに失敗", e);
    }
  }

  document.getElementById("btnEditItems").addEventListener("click", () => {
    if (elCheckEdit.style.display === "block") elCheckEdit.style.display = "none";
    else openItemEdit();
  });

  document.getElementById("btnSaveItems").addEventListener("click", async () => {
    const texts = [...new Set([...elItemInputs.querySelectorAll("input")].map((x) => x.value.trim()).filter(Boolean))];
    if (!texts.length) { elItemsSaved.textContent = "項目を1つ以上書いてください"; return; }
    if (!window.__credential) {
      elItemsSaved.textContent = "保存にはログインが必要です";
      if (window.aaShowLoginGate) window.aaShowLoginGate();
      return;
    }
    try {
      const items = await saveCheckItems(texts);
      checkItems = mergeDone(items, { items: checkItems });
      renderChecks();
      elCheckEdit.style.display = "none";
      elItemsSaved.textContent = "";
    } catch (e) {
      elItemsSaved.textContent = saveErrorText(e);
    }
  });

  async function loadTodayScore() {
    let data = null;
    try {
      data = await fetchScore(today);
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
    try {
      checkItems = mergeDone(await fetchCheckItems(), data && data.check);
      renderChecks();
      elCheckBox.style.display = "block";
    } catch (e) {
      console.warn("チェック項目を読めませんでした", e);
    }
  }

  elBtnSaveScore.addEventListener("click", async () => {
    // ba-35残課題(2): 公開閲覧モードでは未ログインでも閲覧できるため、書き込み時に
    // credentialの有無を確認し、無ければ通信(401)ではなくログインへ誘導する。
    if (!window.__credential) {
      elScoreSaved.textContent = "保存にはログインが必要です";
      if (window.aaShowLoginGate) window.aaShowLoginGate();
      return;
    }
    const score = Number(elSlider.value);
    const note = elNoteInput.value.trim();
    try {
      const check = checkItems.length
        ? { items: checkItems.map((i) => ({ id: i.id, text: i.text, done: markOf(i) === "○", mark: markOf(i) })), score: checkScore(checkItems), at: new Date().toISOString() }
        : null;
      await saveScore(today, score, note, check);
      elBtnSaveScore.textContent = "更新";
      elScoreSaved.textContent = "✓ 保存しました";
      setTimeout(() => elScoreSaved.textContent = "", 2000);
      // 読み直さず、開いたときに読んだ一覧の今日の分だけ差し替えて描き直す(ab-97)
      // saveScore は merge で書くので、check を渡さなかったときは前の check が残る。手元もそれに合わせる
      if (_scoreRows) {
        const old = _scoreRows.find((r) => r.date === today) || {};
        _scoreRows = [..._scoreRows.filter((r) => r.date !== today), { ...old, date: today, score, note, ...(check ? { check } : {}) }];
      }
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
        scoreMap[r.date] = { score: r.score, note: r.note || "", check: r.check ? r.check.score : null };
      }
    });

    const chartRows = Object.entries(scoreMap)
      .map(([date, v]) => ({ date, score: v.score, note: v.note, check: v.check }))
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

// issue #8対応(案B): auth.jsの実行順は変えず、起動時にwindow.__loginStateを直接チェックする。
// auth.js(通常script)はHTML解析中に同期実行されるため、このモジュール(type="module"でdefer)が
// 動く時点では既にwindow.__loginStateがセット済みの可能性がある。その場合はイベントを待たずに即実行し、
// まだ未ログインならこれまで通りm1-login-successイベントを待つ(通常のログインボタン操作に対応)。
function onLoginSuccess() {
  initScoreInput();
  load();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m1-login-success", onLoginSuccess, { once: true });
}
