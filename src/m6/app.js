// app.js — m6 地図あそび(ab-44)。t14 の捨て案を1枚の地図の層とコーナーとして拾ったもの:
//   制覇ヒートマップ / フォグ・オブ・ウォー / Visits・Scores を地図に重ねる / 家人キャラが地図を歩く /
//   ご当地スタンプ帳 / 「知育」空目の県あてクイズ。
// 地図は m5 と同じ prefectures.geojson(実座標)をメルカトル投影して SVG にする(沖縄は左上の別枠)。
// 訪問・スコアは Firestore を読むだけ(読みは誰でも、Rules)。読みに失敗しても地図とクイズは動くよう、
// ストアは動的 import にしている。
// 10/03 の2回目(Takashi「減らすのは最小限で、いろいろ改良」): 次に晴らせる県(となりの未踏県)の層、地方ごとの制覇、
// 県の詳細(地方・県庁所在地・面積・となり)、クイズの種類(となり・広さ・県庁所在地・まちがい直し)を足した。
// 表と計算は geo.js。まちがえた県はこの端末にだけ覚える(localStorage)。
// 同日の3回目: クイズは1回5問、正解50で1点を pointEvents に書く(このページで Firestore に書くのはこれだけ、quiz-point.js)。
// 10/04(ab-107): 霧を市区町村単位にもできるようにした(県だと日々の移動で地図が変わらないため)。境界は city/NN.json
// (scripts/build-m6-cities.mjs で作る)を、行ったことのある県の分だけ読む。どの市区町村かは訪問の緯度経度の内外で決める(geo.js)。

import { PER_POINT, loadBank, saveBank, writeQuizPoint, fetchQuizPoints } from "./quiz-point.js?v=202610031800";
import { REGIONS, regionOf, CAPITALS, areaText, adjacency, centers, distKm, frontier, regionProgress, QUIZ_KINDS, makeQuiz, prefCode, cityVisits } from "./geo.js?v=202610041200";

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
let selectedCity = null;
let adj = new Map();
let centerOf = new Map();
let names = [];
// 市区町村(ab-107)。cityFeats は読み込んだ県の分だけ、cityAgg はコード→{code,name,pref,count,first}、cityTotal は県→市区町村の数。
let cityFeats = [];
let cityAgg = new Map();
const cityTotal = new Map();
const FOG_UNIT_KEY = "m6.fogUnit";
const fogUnit = () => $("fogUnit").value;

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
    <g id="cities"></g>
    <rect class="fog-rect" id="fog" width="760" height="760" filter="url(#fogTex)" mask="url(#fogMask)"/>
    <g id="front"></g>
    <g id="dots"></g>
    <g id="walk"></g>`;
  svg.addEventListener("click", (e) => {
    const d = e.target.dataset || {};
    if (d.c) selectCity(d.c);
    else if (d.p) select(d.p);
  });
}

// 霧の穴: 県で/市区町村での切り替えに合わせて、県の形か市区町村の形をくり抜く。keys は県名か団体コード。
function holePath(sel) {
  return [...svg.querySelectorAll(sel)].map((el) => `<path d="${el.getAttribute("d")}" fill="black"/>`).join("");
}
function setFogHoles(keys, unit = fogUnit()) {
  svg.querySelector("#fogHoles").innerHTML = keys.map((k) => holePath(unit === "city" ? `#cities [data-c="${k}"]` : `#prefs [data-p="${k}"]`)).join("");
}
const openAllFog = () => setFogHoles(fogUnit() === "city" ? [...cityAgg.keys()] : [...agg.keys()]);

// 行ったことのある県の市区町村を読み込んで描く(県ごとのファイル、読めなかった県は県単位のまま)。
async function loadCities() {
  const prefs = [...agg.keys()].filter((n) => prefCode(n) && !cityTotal.has(n));
  const got = await Promise.all(prefs.map((n) =>
    fetch(`city/${prefCode(n)}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  got.forEach((gj, i) => {
    if (!gj) return;
    cityTotal.set(prefs[i], gj.features.length);
    cityFeats.push(...gj.features.map((f) => ({ ...f, pref: prefs[i] })));
  });
  const prefByCode = new Map(cityFeats.map((f) => [f.properties.c, f.pref]));
  cityAgg = cityVisits(visits, cityFeats, (c) => prefByCode.get(c));
  svg.querySelector("#cities").innerHTML = cityFeats.map((f) =>
    `<path class="city" data-c="${f.properties.c}" data-p="${esc(f.pref)}" d="${toPath(f.geometry, projFor(f.pref))}"/>`).join("");
}

function paint() {
  const by = $("colorBy").value;
  const byCity = fogUnit() === "city";
  const max = Math.max(1, ...[...agg.values()].map((a) => a.count));
  svg.querySelector("#cities").style.display = byCity ? "" : "none";
  // 市区町村で見るとき、訪問回数は市区町村ごとに塗る(その県の地色は塗らない)。
  const cmax = Math.max(1, ...[...cityAgg.values()].map((a) => a.count));
  svg.querySelectorAll("#cities .city").forEach((el) => {
    const a = cityAgg.get(el.dataset.c);
    el.style.fill = byCity && a && by === "count" ? mix(HEAT, 20 + 80 * (Math.log(1 + a.count) / Math.log(1 + cmax))) : "";
    el.classList.toggle("sel", el.dataset.c === selectedCity);
  });
  svg.querySelectorAll("#prefs .pref").forEach((el) => {
    const a = agg.get(el.dataset.p);
    let fill = "";
    if (a && by === "count" && !(byCity && cityTotal.has(el.dataset.p))) fill = mix(HEAT, 20 + 80 * (Math.log(1 + a.count) / Math.log(1 + max)));
    if (a && by === "score" && a.avgScore !== null) {
      // 80点を真ん中に、低いと青・高いと橙。
      const t = Math.max(-1, Math.min(1, (a.avgScore - 80) / 20));
      fill = mix(t >= 0 ? HEAT : COOL, 25 + 70 * Math.abs(t));
    }
    el.style.fill = fill;
    el.classList.toggle("sel", el.dataset.p === selected);
  });
  const lg = $("legend");
  if (by === "count") lg.innerHTML = `少<span class="bar" style="background:linear-gradient(90deg,${mix(HEAT, 20)},${HEAT})"></span>多(訪問回数、対数${byCity ? "、市区町村ごと" : ""})`;
  else if (by === "score") lg.innerHTML = `60<span class="bar" style="background:linear-gradient(90deg,${COOL},${mix(COOL, 25)},${mix(HEAT, 25)},${HEAT})"></span>100(その県にいた日の点数の平均)`;
  else lg.textContent = "";
  // 霧は少し透かして、県境がうっすら見えるようにする。
  $("fog").style.opacity = $("fogOn").checked ? 0.82 : 0;
  if ($("frontOn").checked && agg.size) lg.insertAdjacentHTML("beforeend", `<span class="front-key"></span>次に晴らせる県(行った県のとなり)`);
  // 次に晴らせる県は霧の上に点線で縁どる(霧の中でも見える)。
  const front = $("frontOn").checked ? frontier(new Set(agg.keys()), adj) : new Set();
  svg.querySelector("#front").innerHTML = [...front].map((n) =>
    [...svg.querySelectorAll(`#prefs [data-p="${n}"]`)].map((el) => `<path class="front" data-p="${n}" d="${el.getAttribute("d")}"/>`).join("")
  ).join("");
  fitView();
  svg.querySelector("#dots").innerHTML = $("dotsOn").checked
    ? visits.filter(hasXY).map((v) => { const [x, y] = projPoint(v); return `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotR()}"/>`; }).join("")
    : "";
}

// 「行ったあたりに寄る」: 行った県(本土側)の外枠に、まわりを少し足した正方形の範囲を見せる。
// 市区町村で見ているときは、行った市区町村の外枠に寄る(県の外枠だと市区町村が小さすぎる)。
function fitView() {
  if (userView) { applyView(); return; }
  const byCity = fogUnit() === "city" && cityAgg.size;
  const els = !$("zoomIn").checked ? []
    : byCity ? [...cityAgg.values()].filter((a) => a.pref !== OKINAWA).flatMap((a) => [...svg.querySelectorAll(`#cities [data-c="${a.code}"]`)])
    : [...agg.keys()].filter((n) => n !== OKINAWA).flatMap((n) => [...svg.querySelectorAll(`#prefs [data-p="${n}"]`)]);
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

// 地図の拡大・移動(10/04、ab-44): ピンチ・Ctrl+ホイール(トラックパッドのピンチもこれ)・＋−で拡大縮小、ドラッグで移動。
// 一度動かしたら、タップなどで描き直しても寄せ直さない(「全体」で「行ったあたりに寄る」の表示に戻る)。
// 線は拡大しても太らないよう CSS の vector-effect、訪問点は大きさを表示の幅に合わせる。
let userView = null; // [x, y, w](正方形)
const viewBox = () => svg.getAttribute("viewBox").split(" ").map(Number);
const dotR = () => (Math.max(0.4, 2 * viewBox()[2] / 760)).toFixed(2);
function applyView() {
  const [x, y, w] = userView;
  svg.setAttribute("viewBox", `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${w.toFixed(2)}`);
  svg.querySelectorAll("#dots circle").forEach((c) => c.setAttribute("r", dotR()));
  $("btnFit").hidden = false;
}
function setView(x, y, w) {
  w = Math.max(12, Math.min(760, w));
  userView = [Math.max(-w / 2, Math.min(760 - w / 2, x)), Math.max(-w / 2, Math.min(760 - w / 2, y)), w];
  applyView();
}
// 画面の座標 → 地図(viewBox)の座標。地図は正方形なので縦横同じ倍率。
function toMap(cx, cy, vb = viewBox()) {
  const r = svg.getBoundingClientRect();
  return [vb[0] + ((cx - r.left) / r.width) * vb[2], vb[1] + ((cy - r.top) / r.height) * vb[2]];
}
// (cx, cy) の下の地点を動かさずに k 倍の幅にする(k < 1 で拡大)。
function zoomAt(cx, cy, k, vb = viewBox()) {
  const [px, py] = toMap(cx, cy, vb);
  const w = Math.max(12, Math.min(760, vb[2] * k)), f = w / vb[2];
  setView(px - (px - vb[0]) * f, py - (py - vb[1]) * f, w);
}
function zoomCenter(k) {
  const r = svg.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, k);
}
svg.addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return; // ふつうのホイールはページのスクロールのまま
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.01));
}, { passive: false });
const ptrs = new Map();
let gesture = null, dragged = false;
function startGesture() {
  const ps = [...ptrs.values()];
  gesture = ps.length ? { ps: ps.map((p) => ({ ...p })), vb: viewBox() } : null;
}
svg.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (!ptrs.size) dragged = false;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  startGesture();
});
svg.addEventListener("pointermove", (e) => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const now = [...ptrs.values()], [a0, b0] = gesture.ps, vb = gesture.vb;
  const r = svg.getBoundingClientRect(), s = vb[2] / r.width;
  if (now.length === 1 && a0) {
    const dx = now[0].x - a0.x, dy = now[0].y - a0.y;
    if (!dragged && Math.hypot(dx, dy) < 5) return; // 小さな揺れはタップのうち
    dragged = true;
    setView(vb[0] - dx * s, vb[1] - dy * s, vb[2]);
  } else if (now.length >= 2 && b0) {
    dragged = true;
    const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
    if (d0 < 1 || d1 < 1) return;
    // 始めの2本指の真ん中にあった地点が、いまの真ん中に来るように。
    const [px, py] = toMap((a0.x + b0.x) / 2, (a0.y + b0.y) / 2, vb);
    const w = Math.max(12, Math.min(760, vb[2] * d0 / d1));
    const mx = ((now[0].x + now[1].x) / 2 - r.left) / r.width, my = ((now[0].y + now[1].y) / 2 - r.top) / r.height;
    setView(px - mx * w, py - my * w, w);
  }
});
const endPtr = (e) => { if (ptrs.delete(e.pointerId)) startGesture(); };
["pointerup", "pointercancel", "pointerleave"].forEach((t) => svg.addEventListener(t, endPtr));
// ドラッグ・ピンチのあとの click は、県や市区町村を選んだことにしない。
svg.addEventListener("click", (e) => { if (dragged) { e.stopPropagation(); dragged = false; } }, true);
$("btnZoomIn").addEventListener("click", () => zoomCenter(0.6));
$("btnZoomOut").addEventListener("click", () => zoomCenter(1 / 0.6));
$("btnFit").addEventListener("click", () => { userView = null; $("btnFit").hidden = true; paint(); });

const hasXY = (v) => Number.isFinite(v.lat) && Number.isFinite(v.lng);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 県の市区町村の制覇(読み込めた県だけ)。
function cityProgressText(n) {
  if (!cityTotal.has(n)) return "";
  const done = [...cityAgg.values()].filter((a) => a.pref === n).length;
  return `市区町村 ${done}/${cityTotal.get(n)}`;
}

function select(n) {
  selected = n;
  selectedCity = null;
  paint();
  const a = agg.get(n);
  const ns = [...(adj.get(n) || [])];
  const nb = ns.length
    ? "となり: " + ns.map((m) => (agg.has(m) ? `${esc(m)}✓` : esc(m))).join("・")
    : "となりの県なし(海の向こう)";
  const cp = cityProgressText(n);
  const facts = `<div class="facts">${esc(regionOf(n))}地方 / 県庁所在地 ${esc(CAPITALS[n] || "?")} / 面積 ${areaText(n)}${cp ? " / " + cp : ""}<br>${nb}</div>`;
  if (!a) {
    const near = ns.filter((m) => agg.has(m));
    const hint = near.length ? `。${near.map(esc).join("・")}から入れる` : "";
    $("info").innerHTML = `<b>${esc(n)}</b> — まだ行っていない(霧の中)${hint}${facts}`;
    return;
  }
  const score = a.avgScore === null ? "点数なし" : `その日の点数 平均 ${a.avgScore.toFixed(1)}`;
  const recent = a.places.slice(0, 5).map((v) => `${esc(v.date)} ${esc(v.place)}`).join("<br>");
  $("info").innerHTML = `<b>${esc(n)}</b> — ${a.count}回・${a.dates.size}日、初訪問 ${esc(a.first || "?")}、${score}${facts}<div class="places">${recent}</div>`;
}

// 市区町村をタップしたとき。まだのところは霧の中、行ったところは回数と初訪問と最近の訪問。
function selectCity(c) {
  const f = cityFeats.find((x) => x.properties.c === c);
  if (!f) return;
  selected = f.pref;
  selectedCity = c;
  paint();
  const a = cityAgg.get(c);
  const head = `<b>${esc(f.properties.n)}</b>(<button type="button" class="linkish" data-p="${esc(f.pref)}">${esc(f.pref)}</button>、${cityProgressText(f.pref)})`;
  if (!a) { $("info").innerHTML = `${head} — まだ行っていない(霧の中)`; return; }
  const mine = visits.filter((v) => cityVisits([v], [f]).size)
    .sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time)).slice(0, 5);
  $("info").innerHTML = `${head} — ${a.count}回、初訪問 ${esc(a.first || "?")}`
    + `<div class="places">${mine.map((v) => `${esc(v.date)} ${esc(v.place)}`).join("<br>")}</div>`;
}
$("info").addEventListener("click", (e) => {
  const n = e.target.dataset && e.target.dataset.p;
  if (n) select(n);
});

// 地方ごとの制覇(バー)と、次の一県(最後の訪問地からいちばん近い、まだ行っていない県)。
function drawRegions() {
  const visited = new Set(agg.keys());
  $("regions").innerHTML = regionProgress(visited).map((r) =>
    `<div class="region${r.done === r.total ? " full" : ""}"><span>${esc(r.name)}</span><span class="rbar"><i style="width:${(100 * r.done / r.total).toFixed(0)}%"></i></span><span>${r.done}/${r.total}</span></div>`
  ).join("");
  const last = [...visits].filter(hasXY).sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time))[0];
  const rest = names.filter((n) => !visited.has(n) && centerOf.has(n));
  if (!last || !rest.length) { $("nextPref").textContent = ""; return; }
  const front = frontier(visited, adj);
  const d = (n) => distKm(last, centerOf.get(n));
  const best = rest.sort((x, y) => d(x) - d(y))[0];
  $("nextPref").innerHTML = `次の一県: <button type="button" class="linkish" data-p="${esc(best)}">${esc(best)}</button>`
    + `(最後の訪問地 ${esc(last.place || last.pref || "")} から約${Math.round(d(best))}km${front.has(best) ? "、となりなので地続き" : ""})`;
}
$("nextPref").addEventListener("click", (e) => {
  const n = e.target.dataset && e.target.dataset.p;
  if (n) { select(n); $("map").scrollIntoView({ behavior: "smooth", block: "center" }); }
});

// 霧を晴らす: 初訪問の早い順に、1県ずつ(市区町村で見ているときは1市区町村ずつ)穴を開ける(スクラッチくじの開封感)。
// 市区町村は数が多いので、全体で20秒くらいに収まるよう間隔を縮める。
let revealTimer = null;
function reveal() {
  clearInterval(revealTimer);
  $("fogOn").checked = true;
  paint();
  const byCity = fogUnit() === "city";
  const src = byCity ? [...cityAgg.values()] : [...agg.values()];
  const order = src.sort((a, b) => (a.first || "9").localeCompare(b.first || "9")).map((a) => (byCity ? a.code : a.pref));
  const opened = [];
  setFogHoles(opened);
  revealTimer = setInterval(() => {
    if (!order.length) { clearInterval(revealTimer); return; }
    const k = order.shift();
    opened.push(k);
    setFogHoles(opened);
    if (byCity) selectCity(k); else select(k);
  }, byCity ? Math.max(80, Math.min(450, 20000 / order.length)) : 450);
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
// 地方ごとに見出しを付けて並べる(見出しは段の頭から全幅)。
function drawStamps() {
  $("stamps").innerHTML = REGIONS.map(([rname, ps]) =>
    `<div class="stamp-region">${esc(rname)} ${ps.filter((p) => agg.has(p)).length}/${ps.length}</div>` + ps.map(stampHtml).join("")
  ).join("");
}
function stampHtml(n) {
  const a = agg.get(n), s = shortName(n);
  const fs = s.length >= 3 ? 13 : 17;
  const art = a
    ? `<g transform="rotate(${hashAngle(n)} 28 28)"><circle cx="28" cy="28" r="24" fill="none" stroke="#c94545" stroke-width="3"/>
         <circle cx="28" cy="28" r="19" fill="none" stroke="#c94545" stroke-width="1"/>
         <text x="28" y="27" fill="#c94545" font-size="${fs}" font-weight="800" text-anchor="middle" dominant-baseline="central">${esc(s)}</text>
         <text x="28" y="41" fill="#c94545" font-size="6" text-anchor="middle">${esc((a.first || "").slice(2).replace(/-/g, "."))}</text></g>`
    : `<circle cx="28" cy="28" r="24" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>`;
  return `<div class="stamp"><svg viewBox="0 0 56 56">${art}</svg>${esc(n)}</div>`;
}

// クイズ: 種類(形あて・となり・広さ・県庁所在地)を選べる。「いろいろ」は毎回くじ引き、
// 「まちがい直し」はまちがえた県を主役にして出す。まちがえた県はこの端末にだけ覚える。
const MISSED_KEY = "m6.quizMissed";
const loadMissed = () => { try { return JSON.parse(localStorage.getItem(MISSED_KEY) || "[]"); } catch { return []; } };
const saveMissed = (a) => { try { localStorage.setItem(MISSED_KEY, JSON.stringify(a)); } catch { /* 覚えられなくても遊べる */ } };
// 1回=5問(Takashi「クイズ長すぎる、4回か5回くらい」)。回の終わりに、たまった正解が50を超えていたら1点(quiz-point.js)。
const ROUND = 5;
// 同日の4回目: 1回の中で同じ県を主役にしない、回の終わりに5問の振り返り、「いろいろ」にもときどきまちがえた県、
// キーボード(1〜4で答える・Enterで次へ)、これまでの地図クイズの加点の合計。
const quiz = { ok: 0, total: 0, streak: 0, best: 0, answered: false, q: null, n: 0, roundOk: 0, used: new Set(), log: [] };
let quizPoints = null; // これまでの地図クイズの加点(pointEvents から、読めなければ null)

function quizBox(qs, sel, pad) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  qs.querySelectorAll(sel).forEach((el) => {
    const b = el.getBBox();
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  });
  const w = Math.max(160, (x1 - x0) * pad), h = Math.max(110, (y1 - y0) * pad);
  qs.setAttribute("viewBox", `${((x0 + x1) / 2 - w / 2).toFixed(1)} ${((y0 + y1) / 2 - h / 2).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
}

function nextQuiz() {
  if (quiz.n >= ROUND) { quiz.n = 0; quiz.roundOk = 0; quiz.used.clear(); quiz.log = []; }
  $("quizSummary").innerHTML = "";
  showBank("");
  $("btnNext").textContent = "次へ";
  $("quizRound").textContent = `${quiz.n + 1} / ${ROUND}問目`;
  const mode = $("quizKind").value;
  const missed = loadMissed();
  const kinds = QUIZ_KINDS.map(([k]) => k);
  const kind = mode === "mix" || mode === "review" ? kinds[Math.floor(Math.random() * kinds.length)] : mode;
  // 「いろいろ」でも、まちがえた県があれば3問に1問くらいはそこから出す。
  const focus = mode === "review" || (mode === "mix" && Math.random() < 1 / 3) ? missed : null;
  const q = makeQuiz(kind, { names, adj, avoid: quiz.used }, Math.random, focus);
  quiz.q = q;
  quiz.answered = false;
  $("quizPrompt").textContent = (mode === "review" && !missed.length ? "(まちがえた県はまだ無いので、ふつうに出す)" : "") + q.prompt;
  $("quizAfter").textContent = "";
  const qs = $("quizMap");
  qs.innerHTML = features.map((f) => {
    const n = f.properties.N03_001;
    return `<path class="${q.marks[n] || ""}" data-p="${n}" d="${toPath(f.geometry, projFor(n))}"/>`;
  }).join("");
  quizBox(qs, ".target, .target2", q.kind === "area" ? 1.6 : 3);
  const choices = $("choices");
  choices.classList.toggle("two", q.choices.length === 2);
  choices.innerHTML = q.choices.map((c) => `<button type="button" data-n="${esc(c)}"${q.marks[c] ? ` data-mark="${q.marks[c]}"` : ""}>${esc(c)}</button>`).join("");
  choices.onclick = (e) => {
    const n = e.target.dataset && e.target.dataset.n;
    if (!n || quiz.answered) return;
    answer(n);
  };
}

function answer(n) {
  const q = quiz.q;
  quiz.answered = true;
  quiz.total++;
  quiz.n++;
  const right = n === q.answer;
  let missed = loadMissed().filter((p) => p !== q.pref);
  if (right) { quiz.roundOk++; saveBank(loadBank() + 1); quiz.ok++; quiz.streak++; quiz.best = Math.max(quiz.best, quiz.streak); }
  else { quiz.streak = 0; missed = [q.pref, ...missed].slice(0, 47); }
  saveMissed(missed);
  quiz.used.add(q.pref);
  quiz.log.push({ q, right, chosen: n });
  $("choices").querySelectorAll("button").forEach((b) => {
    if (b.dataset.n === q.answer) b.classList.add("ok");
    else if (b.dataset.n === n) b.classList.add("ng");
  });
  // 答えのあと: となりの県を塗って見せる。
  const qs = $("quizMap");
  for (const p of q.show) qs.querySelectorAll(`[data-p="${p}"]`).forEach((el) => el.classList.add("hint"));
  if (q.show.length) quizBox(qs, ".target, .hint", 1.3);
  $("quizAfter").textContent = (right ? "正解。" : "ざんねん。") + q.after;
  $("quizScore").textContent = `この回 ${quiz.roundOk} / ${quiz.n}`
    + (quiz.streak >= 2 ? `・${quiz.streak}連続` : "")
    + (agg.has(q.pref) ? `(${q.pref}は行ったことがある)` : "");
  $("missedCount").textContent = missed.length ? `まちがえた県 ${missed.length}` : "";
  showBank();
  if (quiz.n >= ROUND) endRound();
}

// たまった正解(この端末)。50で1点。
// extra を渡すと、その注記を覚えておく(加点の合計があとから読めて描き直すときも消えないように)。
let bankNote = "";
function showBank(extra) {
  if (extra !== undefined) bankNote = extra;
  const b = loadBank();
  $("quizBank").textContent = `たまった正解 ${Math.min(b, PER_POINT)} / ${PER_POINT}` + bankNote
    + (quizPoints ? `・これまでの地図クイズの加点 ${quizPoints}点` : "");
}

const summaryLine = (q) => ({
  shape: `形あて: ${q.answer}`,
  neighbor: `${q.pref}のとなり: ${q.answer}`,
  area: `${q.choices.join("と")}、広いのは ${q.answer}`,
  capital: `${q.pref}の県庁所在地: ${q.answer}`,
}[q.kind] || q.answer);

// 回の終わりの振り返り: 5問を ○× で並べる(まちがえた問は答えも)。
function drawSummary() {
  $("quizSummary").innerHTML = quiz.log.map(({ q, right, chosen }) =>
    `<li class="${right ? "ok" : "ng"}">${right ? "○" : "×"} ${esc(summaryLine(q))}${right ? "" : `(${esc(chosen)}と答えた)`}</li>`
  ).join("");
}

// 回の終わり: 結果を出し、正解が50たまっていれば1点書く。書けなければ、ためたまま次の回の終わりにまた試す。
async function endRound() {
  $("btnNext").textContent = `もう1回(${ROUND}問)`;
  $("quizAfter").textContent += ` ── ${ROUND}問中 ${quiz.roundOk}問 正解。`;
  drawSummary();
  if (loadBank() < PER_POINT) { showBank(`(あと${PER_POINT - loadBank()}で1点)`); return; }
  showBank("(1点を書いています…)");
  try {
    await writeQuizPoint();
    saveBank(loadBank() - PER_POINT);
    quizPoints = (quizPoints || 0) + 1;
    showBank("");
    $("quizAfter").textContent += "正解が50たまったので、1点 加点した(地図クイズ)。";
  } catch (e) {
    showBank("(1点はまだ書けていない。次の回の終わりにまた試す)");
    console.warn("m6: 地図クイズの加点に失敗", e);
  }
}

function stats() {
  $("statPrefs").textContent = agg.size;
  $("statCities").textContent = cityAgg.size || "—";
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
  setFogHoles([...agg.keys()], "pref");
  paint();
  drawStamps();
  stats();
  drawRegions();
  await loadCities();
  openAllFog();
  paint();
  stats();
}

["colorBy", "fogOn", "dotsOn", "frontOn"].forEach((id) => $(id).addEventListener("change", paint));
$("zoomIn").addEventListener("change", () => { userView = null; $("btnFit").hidden = true; paint(); });
// 霧の細かさ(県/市区町村)はこの端末に覚える。既定は市区町村(行くと地図が変わる方)。
try { const u = localStorage.getItem(FOG_UNIT_KEY); if (u === "pref" || u === "city") $("fogUnit").value = u; } catch { /* 覚えられなくても動く */ }
$("fogUnit").addEventListener("change", () => {
  try { localStorage.setItem(FOG_UNIT_KEY, fogUnit()); } catch { /* 同上 */ }
  clearInterval(revealTimer);
  openAllFog();
  if (fogUnit() === "pref") selectedCity = null;
  paint();
});
$("btnReveal").addEventListener("click", reveal);
$("btnWalk").addEventListener("click", walk);
$("btnNext").addEventListener("click", nextQuiz);
$("quizKind").addEventListener("change", nextQuiz);
$("quizKind").insertAdjacentHTML("beforeend", QUIZ_KINDS.map(([k, label]) => `<option value="${k}">${label}</option>`).join("")
  + '<option value="review">まちがい直し</option>');
{ const m = loadMissed().length; $("missedCount").textContent = m ? `まちがえた県 ${m}` : ""; }
showBank();
fetchQuizPoints().then((n) => { quizPoints = n; showBank(); });

// キーボード: 1〜4(テンキーも)で答える、Enter で次へ。選択欄などで打っているときは何もしない。
document.addEventListener("keydown", (e) => {
  // 選択肢のボタンにフォーカスがあるとき(マウスで答えた直後)は、ここで受ける。ほかのボタンは自分の Enter に任せる。
  const onChoice = e.target.closest && e.target.closest("#choices");
  if (e.ctrlKey || e.metaKey || e.altKey || (!onChoice && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName))) return;
  const i = "1234".indexOf(e.key);
  const bs = $("choices").querySelectorAll("button");
  if (i >= 0 && bs[i] && !quiz.answered) { e.preventDefault(); answer(bs[i].dataset.n); }
  else if (e.key === "Enter" && quiz.answered) { e.preventDefault(); nextQuiz(); }
});

fetch("../m5/prefectures.geojson").then((r) => r.json()).then((gj) => {
  features = gj.features;
  names = [...new Set(features.map((f) => f.properties.N03_001))];
  adj = adjacency(features);
  centerOf = centers(features);
  drawMap();
  paint();
  drawStamps();
  nextQuiz();
  loadData();
}).catch(() => { svg.innerHTML = '<text x="380" y="380" fill="#aaa" text-anchor="middle" font-size="16">地図の読み込みに失敗しました</text>'; });
