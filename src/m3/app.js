import "../common/config.js";
import { CLASSIFICATIONS, parseTags, withCredential } from "../common/utils.js";
const BA_API = `${window.AA_API_BASE}/ba`;
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
  const elResult = document.getElementById("postResult");
  document.getElementById("btnAddThread").addEventListener("click", async () => {
    try {
      const title = elTitle.value.trim();
      if (!title) { elTitle.focus(); return; }
      const payload = { type: "new", title, tags: parseTags(elTags.value), body: elBody.value.trim() };
      if (!payload.tags.some((t) => CLASSIFICATIONS.includes(t))) {
        const clsEl = document.querySelector('input[name="newCls"]:checked');
        if (clsEl) payload.tags = [clsEl.value, ...payload.tags];
      }
      const result = await postEntry(payload);
      elTitle.value = "";
      elTags.value = "";
      elBody.value = "";
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
