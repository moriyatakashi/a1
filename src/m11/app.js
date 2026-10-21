// app.js — m11「どこまで読んだ」(b1 ah-47・af-9、2026-10-22 礼文)。
// 漫画のどこまで読んだかを片手・数タップで残す(ac-35「登山の道具」)。作品を選ぶ → 話 +1(巻 +1)→ 残す。
// Firestore mangaReads/{id} に足すだけ(直さない・消さない)。読む・書くは Takashi 本人だけ(Rules)。
import { collection, doc, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureFirebaseLogin, ensureReadLogin, guardRead, saveErrorText } from "../common/firebase.js";
import { latestByTitle, lastPlace, clampNum, makeRead, md } from "./reads.js";

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let rows = [];
let picked = null; // 編んでいる作品の title(新しい作品は "")

async function fetchReads() {
  await ensureReadLogin();
  const snap = await guardRead(() => getDocs(collection(db, "mangaReads")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function renderList() {
  const latest = latestByTitle(rows);
  $("works").innerHTML = latest.length
    ? latest.map((r) => `<button class="work" type="button" data-title="${esc(r.title)}">
        <span class="wt">${esc(r.title)}</span>
        <span class="wm">${r.vol}巻 ${r.ch}話・${md(r.date)}${r.place ? " " + esc(r.place) : ""}</span>
      </button>`).join("")
    : `<p class="empty">まだ記録がありません。下の「+ 作品」から始めます。</p>`;
}

function openEditor(title) {
  picked = title;
  const last = latestByTitle(rows).find((r) => r.title === title);
  $("edTitle").hidden = !!title;
  $("edName").textContent = title || "新しい作品";
  $("edTitle").value = "";
  $("vol").value = last ? last.vol : 1;
  $("ch").value = last ? last.ch : 1;
  $("place").value = (last && last.place) || lastPlace(rows);
  $("msg").textContent = last ? `前回: ${last.vol}巻 ${last.ch}話(${md(last.date)})` : "";
  $("list").hidden = true;
  $("editor").hidden = false;
  if (!title) $("edTitle").focus();
}

function closeEditor() {
  picked = null;
  $("editor").hidden = true;
  $("list").hidden = false;
  renderList();
}

async function save() {
  const read = makeRead({ title: picked || $("edTitle").value, vol: $("vol").value, ch: $("ch").value, place: $("place").value });
  if (!read) {
    $("msg").textContent = "作品名を入れてください(60字まで)";
    return;
  }
  $("save").disabled = true;
  $("msg").textContent = "残しています…";
  try {
    await ensureFirebaseLogin();
    const id = crypto.randomUUID();
    await setDoc(doc(db, "mangaReads", id), read);
    rows.push({ id, ...read });
    closeEditor();
    $("done").textContent = `残しました: ${read.title} ${read.vol}巻 ${read.ch}話`;
  } catch (e) {
    $("msg").textContent = saveErrorText(e);
  } finally {
    $("save").disabled = false;
  }
}

function bump(id, by) {
  $(id).value = clampNum(Number($(id).value) + by);
}

async function onLoginSuccess() {
  $("works").addEventListener("click", (e) => {
    const b = e.target.closest(".work");
    if (b) openEditor(b.dataset.title);
  });
  $("add").addEventListener("click", () => openEditor(""));
  $("chUp").addEventListener("click", () => bump("ch", 1));
  $("chDown").addEventListener("click", () => bump("ch", -1));
  $("volUp").addEventListener("click", () => bump("vol", 1));
  $("volDown").addEventListener("click", () => bump("vol", -1));
  $("save").addEventListener("click", save);
  $("cancel").addEventListener("click", closeEditor);
  try {
    rows = await fetchReads();
  } catch (e) {
    $("works").innerHTML = `<p class="empty">記録を読めませんでした(${esc(e.code || e.message)})。開き直してください。</p>`;
    return;
  }
  renderList();
}

if (window.__loginState && window.__loginState.loggedIn) {
  onLoginSuccess();
} else {
  window.addEventListener("m11-login-success", onLoginSuccess, { once: true });
}
