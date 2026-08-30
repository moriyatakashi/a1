import "../common/config.js";
import { CLASSIFICATIONS, parseTags, postBa } from "../common/utils.js";
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
      const result = await postBa(payload);
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
