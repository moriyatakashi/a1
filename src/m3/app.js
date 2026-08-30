// app.js — m3(たかし専用の記入面)。src/ba/app.jsの「新規スレッドを追加」フォーム
// (type=new / by=takashi固定)だけを切り出したもの(2026-08-16、非破壊のコピーで作成。
// 元のba側フォームはまだ残っている。分割計画のA案: 投稿先は引き続きba API)。
// 一覧・検索・関連付け等の閲覧機能は持たない(既存のba/bb/bc/bd/beに任せる)。
import "../common/config.js";
import { CLASSIFICATIONS, parseTags, withCredential } from "../common/utils.js";

const API_BASE = window.AA_API_BASE; // common/config.js から
const BA_API = `${API_BASE}/ba`;

async function postEntry(body) {
  const res = await fetch(BA_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withCredential(body)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function initNewEntryForm() {
  const elTitle = document.getElementById("newTitle");
  const elTags = document.getElementById("newTags");
  const elBody = document.getElementById("newBody");
  const elJson = document.getElementById("newJson");
  const elSubmit = document.getElementById("btnAddThread");
  const elResult = document.getElementById("postResult");

  elSubmit.addEventListener("click", async () => {
    try {
      let payload;
      if (elJson.value.trim()) {
        const parsed = JSON.parse(elJson.value);
        payload = { type: "new", title: parsed.title, tags: parsed.tags, body: parsed.body };
      } else {
        const title = elTitle.value.trim();
        if (!title) { elTitle.focus(); return; }
        payload = { type: "new", title, tags: parseTags(elTags.value), body: elBody.value.trim() };
      }
      // ba-32/ba-33: 分類を必ずtagsに含める(JSON貼り付け側に既に分類があればそれを尊重)。
      const curTags = Array.isArray(payload.tags) ? payload.tags : [];
      if (!curTags.some((t) => CLASSIFICATIONS.includes(t))) {
        const clsEl = document.querySelector('input[name="newCls"]:checked');
        if (clsEl) payload.tags = [clsEl.value, ...curTags];
      }
      const result = await postEntry(payload);
      elTitle.value = "";
      elTags.value = "";
      elBody.value = "";
      elJson.value = "";
      if (elResult) elResult.textContent = `追加しました: ba-${result.seq}`;
    } catch (e) {
      if (elResult) elResult.textContent = "";
      alert("追加に失敗しました: " + e.message);
    }
  });
}

if (window.__loginState && window.__loginState.loggedIn) {
  initNewEntryForm();
} else {
  window.addEventListener("m3-login-success", initNewEntryForm, { once: true });
}
