// bc.js — 7つの関門(bc、b1 ah-163)の並べ方と色。画面から切り離して node --test で確かめる。
// 親は開いている bc。子は ah・af・ae のうち、related に bc-n を持つ開いているもの(ae に親の欄は無いので related でつなぐ、ah-73)。
// どの bc も指していない ae は受け皿(題に「もろもろ」の入った bc、無ければ番号の大きい bc)に出す。
// 色は Redmine の一覧に寄せる(ah-163): 子に期日超えがあれば赤、期日が近い(NEAR_DAYS 日以内)だけならオレンジ、子が0件なら薄く。
// aX には Redmine の「進み」が無いので、オレンジは進み不足ではなく期日の近さで見る(礼文が決めた、2026-11-08)。

export const NEAR_DAYS = 3;
export const CATCHALL = "もろもろ";

const bcKeys = (t) => (Array.isArray(t.related) ? t.related : [])
  .map((r) => String(r).trim().toLowerCase()).filter((r) => /^bc-\d+$/.test(r));

const dayMs = (iso) => Date.parse(`${iso}T00:00:00+09:00`);

// 子1件の色。期日が無ければ色なし
export function kidColor(dueDate, today) {
  if (!dueDate || Number.isNaN(dayMs(dueDate))) return "";
  const days = Math.round((dayMs(dueDate) - dayMs(today)) / 86400000);
  if (days < 0) return "red";
  return days <= NEAR_DAYS ? "orange" : "";
}

// 枠の色。赤がひとつでもあれば赤、オレンジだけならオレンジ、子が0件なら faint
export function gateColor(kids) {
  if (!kids.length) return "faint";
  if (kids.some((k) => k.color === "red")) return "red";
  return kids.some((k) => k.color === "orange") ? "orange" : "";
}

// 並び(2026-11-08 Takashi): ①期日超え・期日が近いものが上(赤→オレンジ→ほか) ②同じなら子の多いものが上 ③番号順
const RANK = { red: 0, orange: 1 };
const byRank = (x, y) => (RANK[x.color] ?? 2) - (RANK[y.color] ?? 2) || y.kids.length - x.kids.length || x.seq - y.seq;

// gates(bc の開いているもの, { ah, af, ae }(開いているもの), 今日 "YYYY-MM-DD")
// → [{ seq, title, color, kids: [{ key, title, dueDate, color }] }] 並びは byRank
export function gates(bcs, { ah = [], af = [], ae = [] } = {}, today) {
  const open = [...bcs].sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
  const byKey = new Map(open.map((b) => [`bc-${b.seq}`, []]));
  const catchall = open.find((b) => (b.title || "").includes(CATCHALL)) || open[open.length - 1];
  const add = (name, t) => {
    const kid = { key: `${name}-${t.seq}`, title: t.title || "", dueDate: t.dueDate || "", color: kidColor(t.dueDate, today) };
    const hit = bcKeys(t).filter((k) => byKey.has(k));
    for (const k of hit) byKey.get(k).push(kid);
    if (!hit.length && name === "ae" && catchall) byKey.get(`bc-${catchall.seq}`).push(kid);
  };
  for (const [name, list] of [["ah", ah], ["af", af], ["ae", ae]]) for (const t of list) add(name, t);
  return open.map((b) => {
    const kids = byKey.get(`bc-${b.seq}`)
      .sort((x, y) => (x.dueDate || "9999").localeCompare(y.dueDate || "9999") || x.key.localeCompare(y.key));
    return { seq: Number(b.seq) || 0, title: b.title || "", color: gateColor(kids), kids };
  }).sort(byRank);
}
