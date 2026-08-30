export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function fmtTs(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const jst = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  return jst.replace(",", "") + " JST";
}
export const CLASSIFICATIONS = ["案件", "確定仕様", "気づき", "保留論点", "旧仕様", "記録"];
export const CLS_KEY = {
  "案件": "anken",
  "確定仕様": "shiyou",
  "気づき": "kizuki",
  "保留論点": "horyu",
  "旧仕様": "kyuushiyou",
  "記録": "kiroku"
};
export const BY_LABEL = { "claude-pc": "利尻", "claude-mobile": "すまさん", "takashi": "takashi" };
export function findClassification(tags) {
  const tagArray = Array.isArray(tags) ? tags : [];
  return tagArray.find((t) => CLASSIFICATIONS.includes(t)) || null;
}
export function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}
export function withCredential(body = {}) {
  return { ...body, credential: window.__credential };
}
export async function postBa(body) {
  const res = await fetch(`${window.AA_API_BASE}/ba`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withCredential(body)),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export function filterFreeTags(tags) {
  const tagArray = Array.isArray(tags) ? tags : [];
  return tagArray.filter((t) => !CLASSIFICATIONS.includes(t));
}
export function parseTags(text) {
  return text
    .split(/[\s,、]+/)
    .map((t) => t.trim().replace(/^#/, ""))
    .filter(Boolean);
}
