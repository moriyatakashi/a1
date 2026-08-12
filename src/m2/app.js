// app.js — ab/src/main/m5(訪問地図)のロジックをaa向けに移植したもの。
// 画面側ログインゲートを通過した後にのみデータを取得・表示する。GETもcredentialヘッダで認証する(ba-16)。
// config.jsを自分でimportする(ba-9追補)。HTML側の<script>読込に依存しないため、
// 旧index.htmlがキャッシュされた端末でも壊れない(2026-07-16の表示不具合の恒久対策)。
import "../common/config.js";
import { todayStr, withCredential, esc } from "../common/utils.js";
const API_BASE = window.AA_API_BASE; // common/config.js から(ba-9)
const VISITS_API = `${API_BASE}/visits`;
// n3(予定)統合分(ba-160/ba-165): 宣言+Googleカレンダー
const DECLARATIONS_API = `${API_BASE}/declarations`;
const CALENDAR_API = `${API_BASE}/calendar-events`;

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const popup = document.getElementById("popup");

async function fetchGeo(path) {
  const r = await fetch(path);
  return r.json();
}

function makeProjector(features, points, W, H, padding = 20) {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  features.forEach(f => {
    const geom = f.geometry;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    polys.forEach(poly => poly.forEach(ring => ring.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    })))
  });
  // 近畿3市の境界だけだと、その外(神奈川など)の訪問ポイントが投影範囲外に出て
  // 描画されなくなる。訪問ポイントの緯度経度もbboxに含めて自動的に範囲を広げる。
  points.forEach(({ lng, lat }) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  const scaleX = (W - padding * 2) / (maxLng - minLng);
  const scaleY = (H - padding * 2) / (maxLat - minLat);
  const scale = Math.min(scaleX, scaleY);
  const offX = padding + (W - padding * 2 - (maxLng - minLng) * scale) / 2;
  const offY = padding + (H - padding * 2 - (maxLat - minLat) * scale) / 2;
  return (lng, lat) => [
    offX + (lng - minLng) * scale,
    H - offY - (lat - minLat) * scale
  ];
}

function drawFeatures(features, proj, fillColor, strokeColor, lineWidth = 1) {
  features.forEach(f => {
    const geom = f.geometry;
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    polys.forEach(poly => {
      ctx.beginPath();
      poly.forEach(ring => {
        ring.forEach(([lng, lat], i) => {
          const [x, y] = proj(lng, lat);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
      });
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.fill();
      ctx.stroke();
    });
  });
}

// ba-135: ピンが多すぎて重なる問題への対応。県境データ等は使わず、画面座標(投影後のx/y)
// が近い点同士を素朴にまとめるだけ。visitsは既に新しい順で渡ってくるため、処理順の性質上
// 各クラスタのvisits[0]は常にそのクラスタ内で最新の訪問になる(先に来た点がクラスタの起点になり、
// 後から来る=より古い点はその起点に併合されることはあってもその逆はないため)。
function clusterPoints(rawPoints, thresholdPx = 14) {
  const clusters = [];
  rawPoints.forEach((p) => {
    const existing = clusters.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < thresholdPx);
    if (existing) {
      existing.visits.push(p.v);
      existing.isLatest = existing.isLatest || p.isLatest;
    } else {
      clusters.push({ x: p.x, y: p.y, visits: [p.v], isLatest: p.isLatest });
    }
  });
  return clusters;
}

function clusterRadius(count) {
  return Math.min(6 + Math.sqrt(count - 1) * 3, 14);
}

function drawCluster(c, color) {
  const r = clusterRadius(c.visits.length);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  if (!c.isTop && c.visits.length > 1) { // ba: 上位20%クラスタは件数を出さない
    ctx.fillStyle = "#fff";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(c.visits.length), c.x, c.y);
  }
}

function drawPoints(visits, proj) {
  const rawPoints = visits.map((v, i) => {
    const [x, y] = proj(v.lng, v.lat);
    return { x, y, v, isLatest: i === 0 };
  });
  const clusters = clusterPoints(rawPoints);

  // ba: 訪問件数が上位20%(80パーセンタイル以上・最低2件)のクラスタは青丸・件数非表示にして
  // 密集地の視認性を上げる。閾値未満のクラスタは従来通り(茶・複数なら件数表示)。
  const counts = clusters.map((c) => c.visits.length).sort((a, b) => a - b);
  const p80 = counts.length ? counts[Math.floor(counts.length * 0.8)] : 2;
  const thr = Math.max(2, p80);
  clusters.forEach((c) => { c.isTop = c.visits.length >= thr; });

  // 通常(茶) → 上位20%(青) → 最新(赤) の順で描画。後のものほど前面に出る。
  clusters.filter((c) => !c.isTop && !c.isLatest).forEach((c) => drawCluster(c, "#b5651d"));
  clusters.filter((c) => c.isTop && !c.isLatest).forEach((c) => drawCluster(c, "#3b7dd8"));
  clusters.filter((c) => c.isLatest).forEach((c) => drawCluster(c, "#e63946"));

  return clusters;
}

// 訪問記録の入力(ab/src/main/n1の訪問記録機能を移植、メモ欄は対象外)
function initVisitInput() {
  const elPlaceInput = document.getElementById("placeInput");
  const elDateInput = document.getElementById("dateInput");
  const elTimeInput = document.getElementById("timeInput");
  const elBtnGps = document.getElementById("btnGps");
  const elBtnAddVisit = document.getElementById("btnAddVisit");
  const elStatus = document.getElementById("visitInputStatus");

  const today = todayStr();
  elDateInput.value = today;
  const now = new Date();
  elTimeInput.value = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  let _lat = null, _lng = null;
  // ba-165②(2026-07-29): 逆ジオコーディング結果のうち県/市/町の3階層を別フィールドとして
  // 保持しておき、visits POST時にそのまま送る(自動加点の判定に使うのはbackend側)。
  let _pref = null, _city = null, _town = null;

  elBtnGps.addEventListener("click", () => {
    if (!navigator.geolocation) { alert("位置情報非対応"); return; }
    elBtnGps.textContent = "取得中...";
    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      _lat = lat; _lng = lng;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`
        );
        const data = await res.json();
        const addr = data.address;
        _pref = addr.state || addr.province || null;
        _city = addr.city || addr.town || addr.village || null;
        _town = addr.suburb || addr.neighbourhood || addr.quarter || null;
        const place = [_city, _town].filter(Boolean).join(" ");
        elPlaceInput.value = place || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      } catch {
        _pref = _city = _town = null;
        elPlaceInput.value = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
      elBtnGps.textContent = "📍 現在地";
    }, () => {
      alert("位置情報を取得できませんでした");
      elBtnGps.textContent = "📍 現在地";
    });
  });

  elBtnAddVisit.addEventListener("click", async () => {
    // ba-35残課題(2): 公開閲覧モードでは未ログインでも閲覧できるため、書き込み時に
    // credentialの有無を確認し、無ければ通信(401)ではなくログインへ誘導する。
    if (!window.__credential) {
      elStatus.textContent = "追加にはログインが必要です";
      if (window.aaShowLoginGate) window.aaShowLoginGate();
      return;
    }
    const place = elPlaceInput.value.trim();
    const date = elDateInput.value;
    const time = elTimeInput.value;
    if (!place) { elPlaceInput.focus(); return; }
    try {
      const res = await fetch(VISITS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withCredential({
          place, date, time, lat: _lat, lng: _lng,
          pref: _pref, city: _city, town: _town,
        })),
      });
      if (!res.ok) { elStatus.textContent = "エラー: 追加に失敗しました"; return; }
      const saved = await res.json();
      elPlaceInput.value = "";
      _lat = null; _lng = null; _pref = null; _city = null; _town = null;
      const granLabel = { pref: "県", city: "市", town: "町" }[saved.autoPointGranularity];
      elStatus.textContent = granLabel ? `✓ 追加しました(初${granLabel}で自動加点)` : "✓ 追加しました";
      setTimeout(() => elStatus.textContent = "", 3000);
      load();
    } catch (e) {
      elStatus.textContent = "エラー: " + e.message;
    }
  });
}

function addVisitRow(listEl, v, hasPin, onClick) {
  const row = document.createElement("div");
  row.className = "visit-row";

  const placeEl = document.createElement("div");
  placeEl.className = "visit-row-place";
  placeEl.textContent = v.place || "—";
  row.appendChild(placeEl);

  const metaEl = document.createElement("div");
  metaEl.className = "visit-row-meta";
  metaEl.textContent = `${v.date || ""} ${v.time || ""}${hasPin ? "" : " (地図なし)"}`;
  row.appendChild(metaEl);

  if (onClick) row.addEventListener("click", onClick);
  listEl.appendChild(row);
  return row;
}

let _points = [];
let _W = 0;

canvas.addEventListener("click", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (_W / rect.width);
  const my = (e.clientY - rect.top) * (canvas.height / rect.height);
  let hit = null;
  for (const pt of _points) {
    if (Math.hypot(mx - pt.x, my - pt.y) < clusterRadius(pt.visits.length) + 6) { hit = pt; break; }
  }
  if (hit) {
    // ba-135: クラスタは複数訪問の集まりなのでどれを指したか特定できない。クラスタ内最新の
    // 訪問(visits[0])を代表として表示し、他にもあれば件数を添える。
    const latest = hit.visits[0];
    const others = hit.visits.length - 1;
    document.getElementById("popupPlace").textContent = latest.place || "—";
    document.getElementById("popupMeta").textContent =
      `${latest.date || ""} ${latest.time || ""}${others > 0 ? ` (ほか${others}件)` : ""}${latest.memo ? "\n" + latest.memo : ""}`;
    const px = Math.min(hit.x + 10, _W - 200);
    const py = Math.max(hit.y - 60, 10);
    popup.style.left = px + "px";
    popup.style.top = py + "px";
    popup.classList.add("show");
  } else {
    popup.classList.remove("show");
  }
});

async function load() {
  const listEl = document.getElementById("visitList");
  const emptyMsg = document.getElementById("emptyMsg");
  listEl.innerHTML = "";
  emptyMsg.style.display = "none";

  // ba: 下地を「県境＋訪問市区町村」の2レイヤーに一本化(既存の関西3市geojsonは廃止)。
  const [prefGeo, cityGeo, visitRes] = await Promise.all([
    fetchGeo("data/prefectures_east.geojson"),
    fetchGeo("data/cities_visited.geojson"),
    fetch(VISITS_API, { cache: "no-store", headers: { "X-Visits-Credential": window.__credential || "" } })
  ]);

  const allVisits = visitRes.ok ? await visitRes.json() : [];
  // 訪問記録をcreatedAtのISO 8601タイムスタンプで降順(新しい順)に並べ替える
  // これにより、同じ分に複数エントリがあっても最新を正確に特定できる
  allVisits.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return tb - ta;
  });
  const withLatLng = allVisits.filter(v => v.lat && v.lng);

  document.getElementById("statTotal").textContent = allVisits.length;
  document.getElementById("statPlaces").textContent = new Set(allVisits.map(v => v.place).filter(Boolean)).size;
  document.getElementById("statDays").textContent = new Set(allVisits.map(v => v.date).filter(Boolean)).size;

  const W = canvas.offsetWidth;
  const H = 520; // 既存3エリア(higashiosaka/osaka_city/amagasaki)を読み直し、地図を拡大表示する(360→520)
  canvas.width = W;
  canvas.height = H;

  const allFeatures = [...prefGeo.features, ...cityGeo.features];
  const proj = makeProjector(allFeatures, withLatLng, W, H);

  ctx.clearRect(0, 0, W, H);
  drawFeatures(prefGeo.features, proj, "#eef1f4", "#8aa0b5", 2.5); // 県境(下地、太めにして境目を分かりやすく)
  drawFeatures(cityGeo.features, proj, "#cfe0f0", "#6f97c0"); // 訪問市区町村
  _W = W;
  _points = withLatLng.length > 0 ? drawPoints(withLatLng, proj) : [];

  // 場所カード一覧は今日の分だけ表示(地図・統計は従来通り全期間)
  const today = todayStr();
  const todayVisits = allVisits.filter(v => v.date === today);

  if (todayVisits.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }

  todayVisits.forEach(v => {
    const hasPin = !!(v.lat && v.lng);
    // ba-135: ピンはクラスタ化されているため、この訪問を含むクラスタを探す(位置決めのみに使う)。
    const cluster = hasPin ? _points.find(c => c.visits.some(cv => cv.id === v.id)) : null;

    addVisitRow(listEl, v, hasPin, hasPin ? () => {
      document.querySelectorAll(".visit-row").forEach(r => r.classList.remove("active"));
      if (cluster) {
        // ポップアップにはクリックしたこの訪問自体の情報を表示する(クラスタの代表ではない)。
        document.getElementById("popupPlace").textContent = v.place || "—";
        document.getElementById("popupMeta").textContent = `${v.date || ""} ${v.time || ""}`;
        popup.style.left = Math.min(cluster.x + 10, W - 200) + "px";
        popup.style.top = Math.max(cluster.y - 60, 10) + "px";
        popup.classList.add("show");
      }
    } : null);
  });
}

// --- n3(予定)統合分(ba-160/ba-165): 宣言+Googleカレンダー ---------------------

// ISO 8601週番号(月曜始まり)。バックエンドのPythonのdate.isocalendar()と同じ定義。
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function mondayOf(d) {
  const day = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - day + 1);
  return monday;
}

function initTargetWeekOptions() {
  const sel = document.getElementById("targetWeek");
  const thisMonday = mondayOf(new Date());
  for (let i = 1; i <= 6; i++) {
    const monday = new Date(thisMonday);
    monday.setDate(thisMonday.getDate() + i * 7);
    const key = isoWeekKey(monday);
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${key}(${monday.getMonth() + 1}/${monday.getDate()}週, ${i}週先)`;
    sel.appendChild(opt);
  }
}

async function achieveDeclaration(id) {
  if (!window.__credential) {
    if (window.aaShowLoginGate) window.aaShowLoginGate();
    return;
  }
  const res = await fetch(`${DECLARATIONS_API}/${id}/achieve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withCredential({})),
  });
  if (!res.ok) { alert("達成の記録に失敗しました"); return; }
  const result = await res.json();
  alert(`達成しました。+${result.awardedPoints}点を記録しました。`);
  loadDeclarations();
}

async function loadDeclarations() {
  const openList = document.getElementById("openDeclList");
  const doneList = document.getElementById("doneDeclList");
  const openEmpty = document.getElementById("openDeclEmpty");
  try {
    const res = await fetch(DECLARATIONS_API, { cache: "no-store" });
    const items = res.ok ? await res.json() : [];
    items.sort((a, b) => a.targetWeek.localeCompare(b.targetWeek));

    const open = items.filter((d) => !d.achieved);
    const done = items.filter((d) => d.achieved).reverse();

    openEmpty.style.display = open.length ? "none" : "block";
    openList.innerHTML = open.map((d) => (
      `<div class="decl-row" data-id="${esc(d.id)}">` +
      `<span>${esc(d.text)}(${esc(d.targetWeek)})</span>` +
      `<button type="button" class="btn-achieve" data-id="${esc(d.id)}">達成</button>` +
      `</div>`
    )).join("");
    openList.querySelectorAll(".btn-achieve").forEach((btn) => {
      btn.addEventListener("click", () => achieveDeclaration(btn.dataset.id));
    });

    doneList.innerHTML = done.map((d) => (
      `<div class="decl-row decl-row--done"><span>✓ ${esc(d.text)}(${esc(d.targetWeek)})</span></div>`
    )).join("");
  } catch (e) {
    openList.innerHTML = `<p class="empty">読み込みエラー: ${esc(e.message)}</p>`;
  }
}

function initDeclarationForm() {
  const elText = document.getElementById("declText");
  const elWeek = document.getElementById("targetWeek");
  const elBtn = document.getElementById("btnAddDecl");
  const elStatus = document.getElementById("declStatus");

  elBtn.addEventListener("click", async () => {
    if (!window.__credential) {
      elStatus.textContent = "追加にはログインが必要です";
      if (window.aaShowLoginGate) window.aaShowLoginGate();
      return;
    }
    const text = elText.value.trim();
    if (!text) { elText.focus(); return; }
    try {
      const res = await fetch(DECLARATIONS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withCredential({ text, targetWeek: elWeek.value })),
      });
      if (!res.ok) { elStatus.textContent = "エラー: 追加に失敗しました"; return; }
      elText.value = "";
      elStatus.textContent = "✓ 追加しました";
      setTimeout(() => elStatus.textContent = "", 2000);
      loadDeclarations();
    } catch (e) {
      elStatus.textContent = "エラー: " + e.message;
    }
  });
}

async function loadCalendar() {
  const listEl = document.getElementById("calendarList");
  const statusEl = document.getElementById("calendarStatus");
  if (!window.__credential) {
    statusEl.textContent = "ログインすると予定が表示されます";
    listEl.innerHTML = "";
    return;
  }
  try {
    const url = `${CALENDAR_API}?credential=${encodeURIComponent(window.__credential)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      statusEl.textContent = res.status === 503 ? "カレンダー連携が未設定です" : "予定の取得に失敗しました";
      listEl.innerHTML = "";
      return;
    }
    const items = await res.json();
    statusEl.textContent = "";
    listEl.innerHTML = items.map((ev) => {
      const start = (ev.start || "").replace("T", " ").slice(0, 16);
      return `<div class="cal-row"><div class="cal-summary">${esc(ev.summary || "(無題)")}</div>` +
        `<div class="cal-meta">${esc(start)}${ev.location ? " — " + esc(ev.location) : ""}</div></div>`;
    }).join("") || `<p class="empty">直近の予定はありません</p>`;
  } catch (e) {
    statusEl.textContent = "エラー: " + e.message;
  }
}

// issue #8対応(案B): auth.jsの実行順は変えず、起動時にwindow.__loginStateを直接チェックする。
// auth.js(通常script)はHTML解析中に同期実行されるため、このモジュール(type="module"でdefer)が
// 動く時点では既にwindow.__loginStateがセット済みの可能性がある。その場合はイベントを待たずに即実行し、
// まだ未ログインならこれまで通りn2-login-successイベントを待つ(通常のログインボタン操作に対応)。
function onLoginSuccess() {
  initVisitInput();
  load();
  initTargetWeekOptions();
  initDeclarationForm();
  loadDeclarations();
  loadCalendar();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m2-login-success", onLoginSuccess, { once: true });
}
