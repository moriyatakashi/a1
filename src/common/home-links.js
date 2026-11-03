// common/home-links.js — トップのログイン後に出す「家のリンク」(b1 ah-149、2026-11-03 礼文)。
// 家の中だけで開くページ(山行記・Redmine など)を1押しで開く。アドレスは Firestore homeLinks/{id} に置き、
// コードにも pub/ にも書かない(家のネットワークの情報は書かない、ac-25 の 9)。読む・足す・消すは Takashi 本人だけ(Rules)。
// 中身は {name, url, createdAt, by}。直さない(直すときは消して足す)。

export const MAX_NAME = 30; // Rules の name の上限
export const MAX_URL = 300; // Rules の url の上限

// 開いてよいアドレスか。http(s) だけ(javascript: などを href に入れない)
export function isLinkUrl(url) {
  return typeof url === "string" && url.length <= MAX_URL && /^https?:\/\/[^\s"'<>]+$/.test(url);
}

// 保存する1件。名前が空・長すぎ、アドレスが http(s) でなければ null(Rules で弾かれる前に止める)
export function makeLink({ name, url }, now = new Date()) {
  const n = String(name || "").trim();
  const u = String(url || "").trim();
  if (!n || n.length > MAX_NAME || !isLinkUrl(u)) return null;
  return { name: n, url: u, createdAt: now.toISOString(), by: "takashi" };
}

// 並びは足した順(古いものが上)。形の合わないものは出さない
export function sortLinks(rows) {
  return rows
    .filter((r) => r && typeof r.name === "string" && r.name && isLinkUrl(r.url))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// box(section)に一覧と「直す」を出す。読めない(Rules がまだ・本人でない)ときは box を隠したまま
export async function showHomeLinks(box) {
  let fs, fb, rows;
  try {
    fs = await import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js");
    fb = await import("./firebase.js");
  } catch (e) {
    return;
  }
  const { collection, doc, getDocs, setDoc, deleteDoc } = fs;
  const { db, ensureFirebaseLogin, ensureReadLogin, saveErrorText } = fb;
  try {
    await ensureReadLogin();
    const snap = await getDocs(collection(db, "homeLinks"));
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    return;
  }
  let editing = false;
  box.hidden = false;

  const render = (msg = "") => {
    const links = sortLinks(rows);
    const items = links.map((r) => `<li><a class="hl-link" href="${esc(r.url)}">${esc(r.name)}</a>${editing ? ` <button type="button" class="hl-del" data-id="${esc(r.id)}" aria-label="${esc(r.name)} を消す">消す</button>` : ""}</li>`).join("");
    box.innerHTML = `<div class="hl-head"><span class="hl-title">家のリンク(家の中だけで開く)</span>
        <button type="button" class="hl-edit">${editing ? "おわる" : "直す"}</button></div>
      ${links.length ? `<ul class="hl-list">${items}</ul>` : `<p class="hl-empty">まだありません。「直す」から名前とアドレスを足します。</p>`}
      ${editing ? `<form class="hl-form">
        <input type="text" name="name" maxlength="${MAX_NAME}" placeholder="名前(例: 山行記)" required>
        <input type="url" name="url" maxlength="${MAX_URL}" placeholder="http://…" required>
        <button type="submit">足す</button>
      </form>` : ""}
      <p class="hl-msg" aria-live="polite">${esc(msg)}</p>`;
  };

  box.addEventListener("click", async (e) => {
    if (e.target.closest(".hl-edit")) {
      editing = !editing;
      render();
      return;
    }
    const del = e.target.closest(".hl-del");
    if (!del) return;
    const r = rows.find((x) => x.id === del.dataset.id);
    if (!r || !confirm(`「${r.name}」を消しますか`)) return;
    try {
      await ensureFirebaseLogin();
      await deleteDoc(doc(db, "homeLinks", r.id));
      rows = rows.filter((x) => x.id !== r.id);
      render(`消しました: ${r.name}`);
    } catch (err) {
      render(saveErrorText(err));
    }
  });

  box.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements; // form.name はフォーム自身の名前なので elements から引く
    const link = makeLink({ name: f.namedItem("name").value, url: f.namedItem("url").value });
    if (!link) {
      render(`名前(${MAX_NAME}字まで)と http:// か https:// で始まるアドレスを入れてください`);
      return;
    }
    try {
      await ensureFirebaseLogin();
      const id = crypto.randomUUID();
      await setDoc(doc(db, "homeLinks", id), link);
      rows.push({ id, ...link });
      render(`足しました: ${link.name}`);
    } catch (err) {
      render(saveErrorText(err));
    }
  });

  render();
}
