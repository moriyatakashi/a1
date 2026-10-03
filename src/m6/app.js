// app.js — m6 地図あそび(ab-44)。t14 の捨て案を1枚の地図の層とコーナーとして拾ったもの:
//   制覇ヒートマップ / フォグ・オブ・ウォー / Visits・Scores を地図に重ねる / 家人キャラが地図を歩く /
//   ご当地スタンプ帳 / 「知育」空目の県あてクイズ。
// 地図は m5 と同じ prefectures.geojson(実座標)をメルカトル投影して SVG にする(沖縄は左上の別枠)。
// 訪問・スコアは Firestore を読むだけ(読みは誰でも、Rules)。読みに失敗しても地図とクイズは動くよう、
// ストアは動的 import にしている。

const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
function project(win, box) {
  const [W, S, E, N] = win, [px, py, pw, ph] = box;
  const x0 = W * RAD, y0 = mercY(N);
  const bw = (E - W) * RAD, bh = y0 - mercY(S);
  const s = Math.min(pw / bw, ph / bh);
  const ox = px + (pw - bw * s) / 2, oy = py + (ph - bh * s) / 2;
  return ([lon, lat]) => [ox + (lon * RAD - x0) * s, oy + (y0 - mercY(lat)) * s];
}
// m5 と同じ窓。本土と、沖縄だけの別枠。
const MAIN = project([129.5, 30, 148.5, 46], [24, 20, 712, 716]);
const OKI = project([127, 26, 128, 27], [42, 64, 156, 120]);
const OKINAWA = "沖縄県";
const projFor = (pref) => (pref === OKINAWA ? OKI : MAIN);
// 訪問点は県が空のこともあるので、座標が沖縄あたりなら別枠で描く。
const projPoint = (v) => (v.pref === OKINAWA || (v.lng < 128.6 && v.lat < 27.6) ? OKI : MAIN)([v.lng, v.lat]);

const polysOf = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
function toPath(geom, p) {
  return polysOf(geom).flat().map((ring) =>
    ring.map((pt, i) => (i ? "L" : "M") + p(pt).map((v) => v.toFixed(1)).join(" ")).join("") + "Z"
  ).join("");
}

// スタンプの字面: 「県」「府」「都」を落とす(北海道はそのまま)。
const shortName = (n) => (n === "北海道" ? n : n.replace(/[都府県]$/, ""));

// 県ごとの集計。visits = [{pref, date, time, place, lat, lng}], scores = [{date, score}]
export function aggregate(visits, scores) {
  const scoreByDate = new Map(scores.map((s) => [s.date, Number(s.score)]).filter(([, v]) => Number.isFinite(v)));
  const by = new Map();
  for (const v of visits) {
    if (!v.pref) continue;
    const a = by.get(v.pref) || { pref: v.pref, count: 0, dates: new Set(), first: "", places: [] };
    a.count++;
    if (v.date) {
      a.dates.add(v.date);
      if (!a.first || v.date < a.first) a.first = v.date;
    }
    a.places.push(v);
    by.set(v.pref, a);
  }
  for (const a of by.values()) {
    const sc = [...a.dates].map((d) => scoreByDate.get(d)).filter((x) => x !== undefined);
    a.avgScore = sc.length ? sc.reduce((s, x) => s + x, 0) / sc.length : null;
    a.places.sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));
  }
  return by;
}

// 色: 霧・ヒートマップとも light/dark の地色に混ぜる(color-mix)。
const HEAT = "#e8743b", COOL = "#3b7dd8";
const mix = (c, pct) => `color-mix(in srgb, ${c} ${Math.round(pct)}%, var(--input-bg))`;

const svg = document.getElementById("map");
const $ = (id) => document.getElementById(id);
let features = [];
let agg = new Map();
let visits = [];
let selected = null;

function drawMap() {
  const paths = features.map((f) => {
    const n = f.properties.N03_001;
    return `<path class="pref" data-p="${n}" d="${toPath(f.geometry, projFor(n))}"/>`;
  }).join("");
  svg.innerHTML = `
    <defs>
      <filter id="fogTex" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="4" seed="7"/>
        <feColorMatrix values="0 0 0 0 0.62  0 0 0 0 0.66  0 0 0 0 0.70  0 0 0 -1.1 1.25"/>
      </filter>
      <mask id="fogMask"><rect width="760" height="760" fill="white"/><g id="fogHoles"></g></mask>
    </defs>
    <path d="M30 60 H170 V200 H30 Z" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>
    <g id="prefs">${paths}</g>
    <rect class="fog-rect" id="fog" width="760" height="760" filter="url(#fogTex)" mask="url(#fogMask)"/>
    <g id="dots"></g>
    <g id="walk"></g>`;
  svg.querySelector("#prefs").addEventListener("click", (e) => {
    const n = e.target.dataset && e.target.dataset.p;
    if (n) select(n);
  });
}

function holePath(n) {
  return [...svg.querySelectorAll(`#prefs [data-p="${n}"]`)].map((el) => `<path d="${el.getAttribute("d")}" fill="black"/>`).join("");
}
function setFogHoles(prefs) {
  svg.querySelector("#fogHoles").innerHTML = prefs.map(holePath).join("");
}

function paint() {
  const by = $("colorBy").value;
  const max = Math.max(1, ...[...agg.values()].map((a) => a.count));
  svg.querySelectorAll("#prefs .pref").forEach((el) => {
    const a = agg.get(el.dataset.p);
    let fill = "";
    if (a && by === "count") fill = mix(HEAT, 20 + 80 * (Math.log(1 + a.count) / Math.log(1 + max)));
    if (a && by === "score" && a.avgScore !== null) {
      // 80点を真ん中に、低いと青・高いと橙。
      const t = Math.max(-1, Math.min(1, (a.avgScore - 80) / 20));
      fill = mix(t >= 0 ? HEAT : COOL, 25 + 70 * Math.abs(t));
    }
    el.style.fill = fill;
    el.classList.toggle("sel", el.dataset.p === selected);
  });
  const lg = $("legend");
  if (by === "count") lg.innerHTML = `少<span class="bar" style="background:linear-gradient(90deg,${mix(HEAT, 20)},${HEAT})"></span>多(訪問回数、対数)`;
  else if (by === "score") lg.innerHTML = `60<span class="bar" style="background:linear-gradient(90deg,${COOL},${mix(COOL, 25)},${mix(HEAT, 25)},${HEAT})"></span>100(その県にいた日の点数の平均)`;
  else lg.textContent = "";
  // 霧は少し透かして、県境がうっすら見えるようにする。
  $("fog").style.opacity = $("fogOn").checked ? 0.82 : 0;
  fitView();
  svg.querySelector("#dots").innerHTML = $("dotsOn").checked
    ? visits.filter(hasXY).map((v) => { const [x, y] = projPoint(v); return `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2"/>`; }).join("")
    : "";
}

// 「行ったあたりに寄る」: 行った県(本土側)の外枠に、まわりを少し足した正方形の範囲を見せる。
function fitView() {
  const els = $("zoomIn").checked
    ? [...agg.keys()].filter((n) => n !== OKINAWA).flatMap((n) => [...svg.querySelectorAll(`#prefs [data-p="${n}"]`)])
    : [];
  if (!els.length) { svg.setAttribute("viewBox", "0 0 760 760"); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  els.forEach((el) => {
    const b = el.getBBox();
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  });
  const w = Math.min(760, Math.max(200, (x1 - x0) * 1.4, (y1 - y0) * 1.4));
  const x = Math.max(0, Math.min(760 - w, (x0 + x1) / 2 - w / 2));
  const y = Math.max(0, Math.min(760 - w, (y0 + y1) / 2 - w / 2));
  svg.setAttribute("viewBox", `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${w.toFixed(1)}`);
}

const hasXY = (v) => Number.isFinite(v.lat) && Number.isFinite(v.lng);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function select(n) {
  selected = n;
  paint();
  const a = agg.get(n);
  if (!a) { $("info").innerHTML = `<b>${esc(n)}</b> — まだ行っていない(霧の中)`; return; }
  const score = a.avgScore === null ? "点数なし" : `その日の点数 平均 ${a.avgScore.toFixed(1)}`;
  const recent = a.places.slice(0, 5).map((v) => `${esc(v.date)} ${esc(v.place)}`).join("<br>");
  $("info").innerHTML = `<b>${esc(n)}</b> — ${a.count}回・${a.dates.size}日、初訪問 ${esc(a.first || "?")}、${score}<div class="places">${recent}</div>`;
}

// 霧を晴らす: 初訪問の早い順に、1県ずつ穴を開ける(スクラッチくじの開封感)。
let revealTimer = null;
function reveal() {
  clearInterval(revealTimer);
  $("fogOn").checked = true;
  paint();
  const order = [...agg.values()].sort((a, b) => (a.first || "9").localeCompare(b.first || "9")).map((a) => a.pref);
  const opened = [];
  setFogHoles(opened);
  revealTimer = setInterval(() => {
    if (!order.length) { clearInterval(revealTimer); return; }
    const n = order.shift();
    opened.push(n);
    setFogHoles(opened);
    select(n);
  }, 450);
}

// 家人キャラが訪問を日付順にたどる。同じ場所に続けて居た分はまとめる。
let walkRaf = null;
function walk() {
  cancelAnimationFrame(walkRaf);
  const g = svg.querySelector("#walk");
  const pts = [];
  for (const v of [...visits].filter(hasXY).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const [x, y] = projPoint(v);
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last.x - x, last.y - y) < 1.5) continue;
    pts.push({ x, y, v });
  }
  if (pts.length < 1) { $("walkCaption").style.display = "none"; return; }
  const who = $("walkWho").value;
  g.innerHTML = `<path class="trail" d=""/><g class="walker"><circle r="9"/><text>${esc(who)}</text></g>`;
  const trail = g.querySelector(".trail"), me = g.querySelector(".walker"), cap = $("walkCaption");
  cap.style.display = "block";
  const HOP = Math.max(120, Math.min(500, 40000 / pts.length)); // 全体で長くても40秒くらい
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  let i = 0, t0 = performance.now();
  const step = (now) => {
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    const t = Math.min(1, (now - t0) / HOP);
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    me.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    trail.setAttribute("d", `${d} L${x.toFixed(1)} ${y.toFixed(1)}`);
    cap.textContent = `${b.v.date} ${b.v.place || b.v.pref || ""}`;
    if (t >= 1) {
      d += ` L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
      i++; t0 = now;
      if (i >= pts.length - 1) { cap.textContent += "(おしまい)"; return; }
    }
    walkRaf = requestAnimationFrame(step);
  };
  walkRaf = requestAnimationFrame(step);
}

// ご当地スタンプ帳: 行った県は朱の判、まだの県は点線の空枠。
function hashAngle(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.codePointAt(0)) | 0;
  return (Math.abs(h) % 25) - 12;
}
function drawStamps() {
  $("stamps").innerHTML = features.map((f) => f.properties.N03_001).filter((n, i, arr) => arr.indexOf(n) === i).map((n) => {
    const a = agg.get(n), s = shortName(n);
    const fs = s.length >= 3 ? 13 : 17;
    const art = a
      ? `<g transform="rotate(${hashAngle(n)} 28 28)"><circle cx="28" cy="28" r="24" fill="none" stroke="#c94545" stroke-width="3"/>
           <circle cx="28" cy="28" r="19" fill="none" stroke="#c94545" stroke-width="1"/>
           <text x="28" y="27" fill="#c94545" font-size="${fs}" font-weight="800" text-anchor="middle" dominant-baseline="central">${esc(s)}</text>
           <text x="28" y="41" fill="#c94545" font-size="6" text-anchor="middle">${esc((a.first || "").slice(2).replace(/-/g, "."))}</text></g>`
      : `<circle cx="28" cy="28" r="24" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>`;
    return `<div class="stamp"><svg viewBox="0 0 56 56">${art}</svg>${esc(n)}</div>`;
  }).join("");
}

// 県あてクイズ: 1県だけ塗った地図を、その県のまわりに寄せて出す。4択。
const quiz = { ok: 0, total: 0, answered: false };
function nextQuiz() {
  const names = [...new Set(features.map((f) => f.properties.N03_001))];
  const target = names[Math.floor(Math.random() * names.length)];
  const others = names.filter((n) => n !== target).sort(() => Math.random() - 0.5).slice(0, 3);
  const qs = $("quizMap");
  qs.innerHTML = features.map((f) => {
    const n = f.properties.N03_001;
    return `<path class="${n === target ? "target" : ""}" d="${toPath(f.geometry, projFor(n))}"/>`;
  }).join("");
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  qs.querySelectorAll(".target").forEach((el) => {
    const b = el.getBBox();
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  });
  const w = Math.max(160, (x1 - x0) * 3), h = Math.max(110, (y1 - y0) * 3);
  qs.setAttribute("viewBox", `${((x0 + x1) / 2 - w / 2).toFixed(1)} ${((y0 + y1) / 2 - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  quiz.answered = false;
  $("choices").innerHTML = [target, ...others].sort(() => Math.random() - 0.5)
    .map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("");
  $("choices").onclick = (e) => {
    const n = e.target.dataset && e.target.dataset.n;
    if (!n || quiz.answered) return;
    quiz.answered = true;
    quiz.total++;
    if (n === target) quiz.ok++;
    $("choices").querySelectorAll("button").forEach((b) => {
      if (b.dataset.n === target) b.classList.add("ok");
      else if (b.dataset.n === n) b.classList.add("ng");
    });
    $("quizScore").textContent = `${quiz.ok} / ${quiz.total}` + (agg.has(target) ? `(${target}は行ったことがある)` : "");
  };
}

function stats() {
  $("statPrefs").textContent = agg.size;
  $("statVisits").textContent = visits.length;
  $("statDays").textContent = new Set(visits.map((v) => v.date).filter(Boolean)).size;
}

async function loadData() {
  try {
    const [{ fetchVisits }, { fetchAllScores }] = await Promise.all([
      import("../common/visit-store.js"), import("../common/score-store.js"),
    ]);
    const [vs, ss] = await Promise.all([fetchVisits(), fetchAllScores().catch(() => [])]);
    visits = vs.map((v) => ({ ...v, lat: v.lat == null ? NaN : Number(v.lat), lng: v.lng == null ? NaN : Number(v.lng) }));
    agg = aggregate(visits, ss);
  } catch (e) {
    $("err").textContent = "訪問・点数の読み込みに失敗した(地図とクイズだけ動く): " + (e && e.message ? e.message : e);
  }
  setFogHoles([...agg.keys()]);
  paint();
  drawStamps();
  stats();
}

["colorBy", "fogOn", "dotsOn", "zoomIn"].forEach((id) => $(id).addEventListener("change", paint));
$("btnReveal").addEventListener("click", reveal);
$("btnWalk").addEventListener("click", walk);
$("btnNext").addEventListener("click", nextQuiz);

fetch("../m5/prefectures.geojson").then((r) => r.json()).then((gj) => {
  features = gj.features;
  drawMap();
  paint();
  drawStamps();
  nextQuiz();
  loadData();
}).catch(() => { svg.innerHTML = '<text x="380" y="380" fill="#aaa" text-anchor="middle" font-size="16">地図の読み込みに失敗しました</text>'; });
