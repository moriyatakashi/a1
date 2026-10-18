// jobs.js — 毎日の処理の様子(2026-10-17 利尻、Takashi「任せる、作って」)。画面に依らない判定だけ(テストは jobs.test.mjs)。
// 失敗を報告してもらうのではなく、成功の時刻(okAt)を見る: 「来ているはずの成功が来ていない」も止まったとみなす
// (電池切れ・Pi が落ちているなどで処理そのものが動かないと、失敗を書く人がいないため)。
// 記録は 3 通り: jobStatus(礼文の cron が b1/run job で書く)・steps(iPhone)・GitHub Actions の実行結果(a1 の公開レポ)。

export const GRACE_HOURS = 6; // 決まった時刻から遅れてよい幅(動画は時間がかかる・cron の時刻のずれ)

export const CHECKS = [
  { id: "steps", name: "歩数", when: "iPhone 毎晩 23:50", everyHours: 24, source: "steps" },
  { id: "refill", name: "票の補い", when: "礼文 毎日 2:30", everyHours: 24, source: "job" }, // 補わない日も記録する(ah-28)
  { id: "ab-dump", name: "ab の控え", when: "礼文 毎日 2:40", everyHours: 24, source: "job" },
  { id: "summary", name: "テーマのまとめ", when: "礼文 毎日 2:50", everyHours: 24, source: "job" },
  { id: "dopdf", name: "PDF", when: "礼文 毎日 3:00", everyHours: 24, source: "job" },
  // 通常版 PDF が読める量(30ページ)に収まったか。中身が前日と同じ日は PDF を作らず記録も無いので、3日空いたら「来ていない」
  { id: "dopdf-pages", name: "PDFのページ数", when: "礼文 毎日 PDF のとき(30ページまで)", everyHours: 72, source: "job", ngLabel: "問題あり" },
  { id: "video", name: "動画", when: "礼文 毎日 PDF のあと", everyHours: 24, source: "job" },
  { id: "backup", name: "バックアップ", when: "GitHub 毎日 4:00", everyHours: 24, source: "gh", workflow: "balog-backup.yml" },
  { id: "cost-weekly", name: "課金の指数", when: "礼文 毎週月曜 2:55", everyHours: 168, source: "job" },
];

// state: ok / ng(失敗が成功より新しい)/ late(来ているはずの成功が来ていない)/ none(まだ一度も記録が無い)/ unknown(読めなかった)
export function judge(check, rec, now) {
  if (!rec || rec.error) return { state: "unknown", note: rec?.error || "" };
  const { okAt, ngAt } = rec;
  if (!okAt && !ngAt) return { state: "none" };
  if (ngAt && (!okAt || ngAt > okAt)) return { state: "ng", note: rec.note || "" };
  const ageH = (now - Date.parse(okAt)) / 3600000;
  return ageH > check.everyHours + GRACE_HOURS ? { state: "late" } : { state: "ok" };
}

export const evaluate = (records, now, checks = CHECKS) =>
  checks.map((c) => ({ ...c, ...(records[c.id] || {}), ...judge(c, records[c.id], now) }));

// トップの1行に出すもの。none(まだ始まっていない)・unknown(読めなかった)は出さない
export const alerts = (items) => items.filter((i) => i.state === "ng" || i.state === "late");

// 「見た」の印。同じ失敗(同じ時刻)が続くあいだは出さない。新しく止まったもの・また失敗したものはまた出る
export const alertKey = (i) => `${i.id}@${i.state === "ng" ? i.ngAt : i.okAt || ""}`;
export const hasUnseen = (list, seen) => list.some((i) => !seen.includes(alertKey(i)));

export const STATE_LABEL = { ok: "ok", ng: "失敗", late: "来ていない", none: "まだ記録なし", unknown: "読めなかった" };

// GitHub Actions の実行(新しい順)→ 最後に成功した時刻・最後の実行が失敗ならその時刻
export function fromWorkflowRuns(runs) {
  const done = (runs || []).filter((r) => r && r.status === "completed");
  const ok = done.find((r) => r.conclusion === "success");
  const last = done[0];
  const failed = last && last.conclusion !== "success" && last.conclusion !== "skipped";
  return {
    okAt: ok ? ok.updated_at : null,
    ngAt: failed ? last.updated_at : null,
    note: failed ? `${last.conclusion}(${last.html_url || ""})` : "",
  };
}

// steps/{日付} の at のいちばん新しいものが成功の時刻
export function fromSteps(rows) {
  const at = (rows || []).map((r) => r && r.at).filter((a) => typeof a === "string").sort();
  return { okAt: at.length ? at[at.length - 1] : null, ngAt: null };
}

// jobStatus/{job} = {okAt, ngAt, ngNote}
export const fromJobDoc = (d) => ({ okAt: d?.okAt || null, ngAt: d?.ngAt || null, note: d?.ngNote || "" });

export function jst(iso) {
  if (!iso) return "—";
  const d = new Date(Date.parse(iso) + 9 * 3600000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
