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

// --- 朝の課題(b1 ah-202): すまが毎朝 bc-4 の notes に書く2種類の頭だけを手がかりに読む ---
// 【朝の課題】YYYY-MM-DD（発生日 M/D、判定 M/D 朝） の下に「a 題 → 振り先 …」を a・b・c の3行
// 【課題の判定】YYYY-MM-DD a できた（一言）/ b できない（一言）/ c … ＝ n/3。…
// 判定の日付は、同じ日付の朝の課題があればそれ、無ければ前の日の朝の課題に付ける(判定は翌朝に書くため)。
// 同じ朝の課題に判定が2つあれば、あとに書いたほうを使う(書き直し)。
export const MORNING_BC = 4;
export const MORNING_DAYS = 7;
const LETTERS = ["a", "b", "c"];
const MORNING_HEAD = "【朝の課題】";
const JUDGE_HEAD = "【課題の判定】";

const prevDay = (iso) => new Date(dayMs(iso) - 86400000).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

// 【朝の課題】1件 → { date, origin, judgeOn, items: [{ letter, title, to }] }。崩れていれば null
export function parseMorning(body) {
  const lines = String(body || "").split("\n").map((l) => l.trim());
  const m = (lines[0] || "").match(/^【朝の課題】\s*(\d{4}-\d{2}-\d{2})(.*)$/);
  if (!m) return null;
  const origin = (m[2].match(/発生日\s*([\d/-]+)/) || [])[1] || "";
  const judgeOn = (m[2].match(/判定\s*([\d/-]+)/) || [])[1] || "";
  const items = [];
  for (const l of lines.slice(1)) {
    const r = l.match(/^([abc])\s+(.+?)\s*→\s*(\S+)/);
    if (r && !items.some((x) => x.letter === r[1])) items.push({ letter: r[1], title: r[2], to: r[3] });
  }
  if (LETTERS.some((x) => !items.some((i) => i.letter === x))) return null;
  items.sort((x, y) => x.letter.localeCompare(y.letter));
  return { date: m[1], origin, judgeOn, items };
}

// 【課題の判定】1件 → { date, n, verdicts: { a: { ok, word } … } }。崩れていれば null
export function parseJudge(body) {
  const m = String(body || "").trim().match(/^【課題の判定】\s*(\d{4}-\d{2}-\d{2})\s*([\s\S]*)$/);
  if (!m) return null;
  const [head] = m[2].split("＝");
  const verdicts = {};
  // 区切りは「/」か「／」。一言の中の 11/21 などで割らないよう、次が「b できた」の形のときだけ割る
  for (const seg of head.split(/\s*[/／]\s*(?=[abc]\s*(?:できた|できない))/)) {
    const r = seg.trim().match(/^([abc])\s*(できた|できない)\s*(?:[（(]([^）)]*)[）)])?/);
    if (r && !verdicts[r[1]]) verdicts[r[1]] = { ok: r[2] === "できた", word: (r[3] || "").trim() };
  }
  if (LETTERS.some((x) => !verdicts[x])) return null;
  const n = LETTERS.filter((x) => verdicts[x].ok).length;
  return { date: m[1], n, verdicts };
}

// notes(bc-4 の note、{ body, createdAt }) → { latest, unreadable, days }
// latest: いちばん新しい朝の課題に判定を重ねたもの(items に verdict: { ok, word } か null)
// unreadable: いちばん新しい【朝の課題】の頭はあるが崩れている
// days: 直近 MORNING_DAYS 日(today を含む)の朝の課題を古い順に [{ date, n }](判定まちは n: null)
export function morning(notes, today) {
  const sorted = [...(notes || [])].sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const heads = sorted.filter((n) => String(n.body || "").trim().startsWith(MORNING_HEAD));
  const mornings = new Map();
  for (const n of heads) { const p = parseMorning(n.body); if (p) mornings.set(p.date, p); }
  const judges = new Map();
  for (const n of sorted.filter((x) => String(x.body || "").trim().startsWith(JUDGE_HEAD))) {
    const j = parseJudge(n.body);
    if (!j) continue;
    const on = mornings.has(j.date) ? j.date : prevDay(j.date);
    if (mornings.has(on)) judges.set(on, j);
  }
  const lastHead = heads[heads.length - 1];
  const unreadable = !!lastHead && !parseMorning(lastHead.body);
  const dates = [...mornings.keys()].sort();
  const latestDate = dates[dates.length - 1];
  const latest = unreadable || !latestDate ? null : (() => {
    const p = mornings.get(latestDate);
    const j = judges.get(latestDate);
    return { ...p, n: j ? j.n : null, items: p.items.map((i) => ({ ...i, verdict: j ? j.verdicts[i.letter] : null })) };
  })();
  const from = dayMs(today) - (MORNING_DAYS - 1) * 86400000;
  const days = dates.filter((d) => dayMs(d) >= from && dayMs(d) <= dayMs(today))
    .map((d) => ({ date: d, n: judges.has(d) ? judges.get(d).n : null }));
  return { latest, unreadable, days };
}
