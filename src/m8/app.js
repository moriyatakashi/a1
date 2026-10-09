// app.js — m8「ここに来た」(ab-159、2026-10-10 すま)。
// 訪問を保存するだけのページ。ボタンを押すと、押した時刻と現在地で visits に1件保存し、
// 初めての県・市・町かどうかだけを出す。速さ優先で地図は描かない(地図・あとからの入力は m2)。
// 保存・初訪問の判定・加点は m2 と同じ common/visit-store.js(Firestore、ab-53)。
import "../common/config.js";
import { todayStr } from "../common/utils.js";
import { fetchVisits, saveVisit } from "../common/visit-store.js";
import { saveErrorText } from "../common/firebase.js";

const GRAN_LABEL = { pref: "県", city: "市", town: "町" };

// 開いたときに読んでおく visits。初訪問の判定に使い回す(押してから読むと遅い)。読めなければ null
let _visits = null;
let _visitsReady = null;

function hhmm(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("この端末は位置情報が使えません")); return; }
    // 速さ優先: 1分以内に取った位置があればそれを使う。市区町村が分かれば足りるので高精度は求めない
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      () => reject(new Error("位置情報を取得できませんでした")),
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 },
    );
  });
}

// 住所(県・市・町)を調べる。取れなければ null(保存は座標だけで続ける)
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

function showResult(html) {
  document.getElementById("hereResult").innerHTML = html;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function onHere() {
  const btn = document.getElementById("btnHere");
  const step = document.getElementById("hereStep");
  if (!window.__credential) {
    if (window.aaShowLoginGate) window.aaShowLoginGate();
    return;
  }
  // 押した時刻で記録する(開いた時刻ではない)
  const pressed = new Date();
  const date = todayStr();
  const time = hhmm(pressed);
  btn.disabled = true;
  showResult("");
  try {
    step.textContent = "現在地を取っています…";
    const { latitude: lat, longitude: lng } = await getPosition();
    step.textContent = "場所を調べています…";
    const addr = await reverseGeocode(lat, lng);
    const place = addr ? [addr.city, addr.town].filter(Boolean).join(" ") : "";
    step.textContent = "保存しています…";
    await _visitsReady;
    const saved = await saveVisit({
      place: place || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, date, time, lat, lng,
      pref: addr && addr.pref, city: addr && addr.city, town: addr && addr.town,
    }, _visits);
    if (_visits) _visits.push(saved);
    step.textContent = `✓ 保存しました(${time})`;

    const gran = GRAN_LABEL[saved.autoPointGranularity];
    const extra = saved.roundPoint ? "<div class=\"place\">今日あちこち回ったので1点</div>" : "";
    if (!addr) {
      showResult(`<div class="big">保存しました</div><div class="place">住所が分からなかったので、新しいかは判定できませんでした</div>${extra}`);
    } else if (gran) {
      const label = { pref: addr.pref, city: addr.city, town: addr.town }[saved.autoPointGranularity];
      showResult(`<div class="big new">初めての${gran}!</div><div class="place">${esc(label)}(${esc(saved.place)})</div>${extra}`);
    } else {
      showResult(`<div class="big">来たことある</div><div class="place">${esc(saved.place)}</div>${extra}`);
    }
  } catch (e) {
    step.textContent = "";
    const msg = e && e.code ? saveErrorText(e) : "エラー: " + ((e && e.message) || String(e));
    showResult(`<div class="err">${esc(msg)}</div>`);
  } finally {
    btn.disabled = false;
  }
}

function onLoginSuccess() {
  _visitsReady = fetchVisits().then((v) => { _visits = v; }).catch((e) => { console.warn("訪問の読み込みに失敗(保存時に読み直す)", e); });
  document.getElementById("btnHere").addEventListener("click", onHere);
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m8-login-success", onLoginSuccess, { once: true });
}
