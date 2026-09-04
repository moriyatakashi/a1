import "../common/config.js";
import { todayStr, withCredential } from "../common/utils.js";
const API_BASE = window.AA_API_BASE;
const VISITS_API = `${API_BASE}/visits`;
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const popup = document.getElementById("popup");
let view = { scale: 1, tx: 0, ty: 0 };
const ZOOM_MIN = 1, ZOOM_MAX = 6, ZOOM_STEP = 1.35;
function clampPan() {
  if (view.scale <= 1) { view.tx = 0; view.ty = 0; return; }
  const maxPanX = _W * (view.scale - 1);
  const maxPanY = canvas.height * (view.scale - 1);
  view.tx = Math.min(maxPanX, Math.max(-maxPanX, view.tx));
  view.ty = Math.min(maxPanY, Math.max(-maxPanY, view.ty));
}
function zoomBy(factor, cx, cy) {
  const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.scale * factor));
  if (newScale === view.scale) return;
  view.tx = cx - (cx - view.tx) * (newScale / view.scale);
  view.ty = cy - (cy - view.ty) * (newScale / view.scale);
  view.scale = newScale;
  clampPan();
  renderMap();
}
function resetView() {
  view = { scale: 1, tx: 0, ty: 0 };
  renderMap();
}
function toScreen(x, y) {
  return [x * view.scale + view.tx, y * view.scale + view.ty];
}
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
  const zoomedIn = view.scale > 1;
  const r = zoomedIn ? 3 / view.scale : clusterRadius(c.visits.length);
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = zoomedIn ? 1 / view.scale : 2;
  ctx.fill();
  ctx.stroke();
  if (!zoomedIn && !c.isTop && c.visits.length > 1) {
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
  const counts = clusters.map((c) => c.visits.length).sort((a, b) => a - b);
  const p80 = counts.length ? counts[Math.floor(counts.length * 0.8)] : 2;
  const thr = Math.max(2, p80);
  clusters.forEach((c) => { c.isTop = c.visits.length >= thr; });
  clusters.filter((c) => !c.isTop && !c.isLatest).forEach((c) => drawCluster(c, "#b5651d"));
  clusters.filter((c) => c.isTop && !c.isLatest).forEach((c) => drawCluster(c, "#3b7dd8"));
  clusters.filter((c) => c.isLatest).forEach((c) => drawCluster(c, "#e63946"));
  return clusters;
}
function drawIndividualPoints(visits, proj) {
  const points = visits.map((v, i) => {
    const [x, y] = proj(v.lng, v.lat);
    return { x, y, visits: [v], isLatest: i === 0 };
  });
  points.filter((p) => !p.isLatest).forEach((p) => drawCluster(p, "#b5651d"));
  points.filter((p) => p.isLatest).forEach((p) => drawCluster(p, "#e63946"));
  return points;
}
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
let _mapData = null;
function toCanvasCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    (e.clientX - rect.left) * (_W / rect.width),
    (e.clientY - rect.top) * (canvas.height / rect.height),
  ];
}
function renderMap() {
  if (!_mapData) return;
  const { prefGeo, adjacentGeo, cityGeo, withLatLng } = _mapData;
  const proj = _mapData.proj;
  ctx.clearRect(0, 0, _W, canvas.height);
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
  drawFeatures(adjacentGeo.features, proj, "#5a5e66", "#3f4247", 1.5);
  drawFeatures(prefGeo.features, proj, "#eef1f4", "#8aa0b5", 2.5);
  drawFeatures(cityGeo.features, proj, "#cfe0f0", "#6f97c0");
  if (withLatLng.length === 0) {
    _points = [];
  } else if (view.scale > 1) {
    _points = drawIndividualPoints(withLatLng, proj);
  } else {
    _points = drawPoints(withLatLng, proj);
  }
  ctx.restore();
}
let isPanning = false;
let panStart = null;
let panMoved = false;
canvas.addEventListener("pointerdown", e => {
  if (view.scale <= 1) return;
  const [x, y] = toCanvasCoords(e);
  isPanning = true;
  panMoved = false;
  panStart = { x, y, tx0: view.tx, ty0: view.ty };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", e => {
  if (!isPanning || !panStart) return;
  const [x, y] = toCanvasCoords(e);
  const dx = x - panStart.x, dy = y - panStart.y;
  if (Math.hypot(dx, dy) > 3) panMoved = true;
  view.tx = panStart.tx0 + dx;
  view.ty = panStart.ty0 + dy;
  clampPan();
  renderMap();
});
canvas.addEventListener("pointerup", () => { isPanning = false; panStart = null; });
canvas.addEventListener("pointercancel", () => { isPanning = false; panStart = null; });
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const [cx, cy] = toCanvasCoords(e);
  zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, cx, cy);
}, { passive: false });
canvas.addEventListener("click", e => {
  if (panMoved) { panMoved = false; return; }
  const [rawX, rawY] = toCanvasCoords(e);
  const mx = (rawX - view.tx) / view.scale;
  const my = (rawY - view.ty) / view.scale;
  let hit = null;
  for (const pt of _points) {
    if (Math.hypot(mx - pt.x, my - pt.y) < clusterRadius(pt.visits.length) + 6) { hit = pt; break; }
  }
  if (hit) {
    const latest = hit.visits[0];
    const others = hit.visits.length - 1;
    document.getElementById("popupPlace").textContent = latest.place || "—";
    document.getElementById("popupMeta").textContent =
      `${latest.date || ""} ${latest.time || ""}${others > 0 ? ` (ほか${others}件)` : ""}${latest.memo ? "\n" + latest.memo : ""}`;
    const [sx, sy] = toScreen(hit.x, hit.y);
    const px = Math.min(sx + 10, _W - 200);
    const py = Math.max(sy - 60, 10);
    popup.style.left = px + "px";
    popup.style.top = py + "px";
    popup.classList.add("show");
  } else {
    popup.classList.remove("show");
  }
});
function initZoomControls() {
  const btnIn = document.getElementById("btnZoomIn");
  const btnOut = document.getElementById("btnZoomOut");
  const btnReset = document.getElementById("btnZoomReset");
  if (!btnIn) return;
  btnIn.addEventListener("click", () => zoomBy(ZOOM_STEP, _W / 2, canvas.height / 2));
  btnOut.addEventListener("click", () => zoomBy(1 / ZOOM_STEP, _W / 2, canvas.height / 2));
  btnReset.addEventListener("click", resetView);
}
initZoomControls();
async function load() {
  const listEl = document.getElementById("visitList");
  const emptyMsg = document.getElementById("emptyMsg");
  listEl.innerHTML = "";
  emptyMsg.style.display = "none";
  const [prefGeo, adjacentGeo, cityGeo, visitRes] = await Promise.all([
    fetchGeo("data/prefectures_east.geojson"),
    fetchGeo("data/prefectures_adjacent.geojson"),
    fetchGeo("data/cities_visited.geojson"),
    fetch(VISITS_API, { cache: "no-store", headers: { "X-Visits-Credential": window.__credential || "" } })
  ]);
  const allVisits = visitRes.ok ? await visitRes.json() : [];
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
  const H = 520;
  canvas.width = W;
  canvas.height = H;
  _W = W;
  const allFeatures = [...prefGeo.features, ...adjacentGeo.features, ...cityGeo.features];
  const proj = makeProjector(allFeatures, withLatLng, W, H);
  _mapData = { prefGeo, adjacentGeo, cityGeo, withLatLng, proj };
  renderMap();
  const today = todayStr();
  const todayVisits = allVisits.filter(v => v.date === today);
  if (todayVisits.length === 0) {
    emptyMsg.style.display = "block";
    return;
  }
  todayVisits.forEach(v => {
    const hasPin = !!(v.lat && v.lng);
    const cluster = hasPin ? _points.find(c => c.visits.some(cv => cv.id === v.id)) : null;
    addVisitRow(listEl, v, hasPin, hasPin ? () => {
      document.querySelectorAll(".visit-row").forEach(r => r.classList.remove("active"));
      if (cluster) {
        document.getElementById("popupPlace").textContent = v.place || "—";
        document.getElementById("popupMeta").textContent = `${v.date || ""} ${v.time || ""}`;
        const [sx, sy] = toScreen(cluster.x, cluster.y);
        popup.style.left = Math.min(sx + 10, W - 200) + "px";
        popup.style.top = Math.max(sy - 60, 10) + "px";
        popup.classList.add("show");
      }
    } : null);
  });
}
function onLoginSuccess() {
  initVisitInput();
  load();
}
if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("x5-login-success", onLoginSuccess, { once: true });
}
