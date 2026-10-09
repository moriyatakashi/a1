// app.js — m8「ここに来た」(ab-159、2026-10-10 すま)。
// 流れ(2026-10-10 Takashi): ①開くと今の町名が出る ②前回と変わったか・初めての町かを見て、登録するか自分で決める
// ③ボタンを押すと、押した時刻とその場所で visits に1件保存する。速さ優先で地図は描かない(地図・あとからの入力は m2)。
// 保存・初訪問の判定・加点は m2 と同じ common/visit-store.js(Firestore、ab-53)。
import "../common/config.js";
import { todayStr } from "../common/utils.js";
import { fetchVisits, saveVisit, newVisitGranularity } from "../common/visit-store.js";
import { saveErrorText } from "../common/firebase.js";

const GRAN_LABEL = { pref: "県", city: "市", town: "町" };

let _visits = null;       // 開いたときに読んだ visits(読めなければ null)
let _visitsReady = null;
let _here = null;         // いま出している場所 {lat, lng, pref, city, town, place}(住所が取れなければ pref などは null)
let _locating = false;

const $ = (id) => document.getElementById(id);

function hhmm(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("この端末は位置情報が使えません")); return; }
    // 速さ優先: 30秒以内に取った位置があればそれを使う。町が分かれば足りるので高精度は求めない
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => reject(new Error("位置情報を取得できませんでした")),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 },
    );
  });
}

// 住所(県・市・町)を調べる。取れなければ null
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`);
    if (!res.ok) return null;
    const addr = (await res.json()).address || {};
    return {
      pref: addr.state || addr.province || null,
      city: addr.city || addr.town || addr.village || null,
      town: addr.suburb || addr.neighbourhood || addr.quarter || null,
    };
  } catch {
    return null;
  }
}

// 一番新しい訪問(createdAt で比べる)。無ければ null
function lastVisit(visits) {
  if (!visits || !visits.length) return null;
  return visits.reduce((a, b) => (new Date(b.createdAt || 0) > new Date(a.createdAt || 0) ? b : a));
}

function fmtWhen(v) {
  const d = (v.date || "").slice(5).replace("-", "/");
  return `${d} ${v.time || ""}`.trim();
}

// 判断の材料(前回と変わったか・初めてか)を描く
function renderJudge() {
  const el = $("hereJudge");
  if (!_here) { el.innerHTML = ""; return; }
  const lines = [];
  if (_here.pref) {
    if (_visits) {
      const gran = newVisitGranularity(_visits, _here);
      lines.push(gran
        ? `<div class="tag new">初めての${GRAN_LABEL[gran]}</div>`
        : `<div class="tag">来たことある町</div>`);
    }
  } else {
    lines.push(`<div class="tag">住所が分からないので、初めてかは判定できません</div>`);
  }
  const last = lastVisit(_visits);
  if (last) {
    const same = !!_here.pref && last.pref === _here.pref && last.city === _here.city && last.town === _here.town;
    lines.push(`<div class="last">${same ? "前回と同じ" : "前回と違う"}　<span>前回: ${esc(last.place || "—")}(${esc(fmtWhen(last))})</span></div>`);
  } else if (_visits === null) {
    lines.push(`<div class="last"><span>前回の記録を読めませんでした</span></div>`);
  }
  el.innerHTML = lines.join("");
}

// ①今の場所を取って町名を出す
async function locate() {
  if (_locating) return;
  _locating = true;
  $("btnSave").disabled = true;
  $("btnRelocate").disabled = true;
  $("hereSaved").textContent = "";
  $("herePlace").textContent = "現在地を取っています…";
  $("hereSub").textContent = "";
  $("hereJudge").innerHTML = "";
  try {
    const { latitude: lat, longitude: lng } = await getPosition();
    $("herePlace").textContent = "町名を調べています…";
    const addr = await reverseGeocode(lat, lng);
    const place = addr ? [addr.city, addr.town].filter(Boolean).join(" ") : "";
    _here = { lat, lng, pref: addr && addr.pref, city: addr && addr.city, town: addr && addr.town,
              place: place || `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    $("herePlace").textContent = (addr && (addr.town || addr.city)) || _here.place;
    $("hereSub").textContent = addr ? [addr.pref, addr.city].filter(Boolean).join(" ") : "住所が取れませんでした(座標で保存します)";
    await _visitsReady;
    renderJudge();
    $("btnSave").disabled = false;
  } catch (e) {
    _here = null;
    $("herePlace").textContent = "—";
    $("hereSub").textContent = (e && e.message) || String(e);
  } finally {
    _locating = false;
    $("btnRelocate").disabled = false;
  }
}

// ③押したら保存(押した時刻で記録する)
async function onSave() {
  if (!_here) return;
  if (!window.__credential) {
    if (window.aaShowLoginGate) window.aaShowLoginGate();
    return;
  }
  const date = todayStr();
  const time = hhmm(new Date());
  const btn = $("btnSave");
  btn.disabled = true;
  $("hereSaved").textContent = "保存しています…";
  try {
    const saved = await saveVisit({ place: _here.place, date, time, lat: _here.lat, lng: _here.lng,
      pref: _here.pref, city: _here.city, town: _here.town }, _visits);
    if (_visits) _visits.push(saved);
    const gran = GRAN_LABEL[saved.autoPointGranularity];
    const notes = [gran && `初${gran}で自動加点`, saved.roundPoint && "今日あちこち回ったので1点"].filter(Boolean);
    $("hereSaved").textContent = `✓ 保存しました(${time})${notes.length ? " " + notes.join("、") : ""}`;
    renderJudge(); // 保存した分が「前回」になる
  } catch (e) {
    $("hereSaved").textContent = e && e.code ? saveErrorText(e) : "エラー: " + ((e && e.message) || String(e));
    btn.disabled = false;
  }
}

function onLoginSuccess() {
  _visitsReady = fetchVisits().then((v) => { _visits = v; }).catch((e) => { console.warn("訪問の読み込みに失敗(保存時に読み直す)", e); });
  $("btnSave").addEventListener("click", onSave);
  $("btnRelocate").addEventListener("click", locate);
  // 開きっぱなしで戻ってきたら場所を取り直す(移動していることがあるので)
  document.addEventListener("visibilitychange", () => { if (!document.hidden) locate(); });
  locate();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m8-login-success", onLoginSuccess, { once: true });
}
