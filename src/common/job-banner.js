// job-banner.js — トップの頭の細い1行(2026-10-17 利尻、Takashi「任せる、作って」)。
// 毎日の処理が1つでも 失敗・来ていない なら「⚠ うまくいっていない処理: PDF、動画  詳しく ›」を出す。全部 ok なら何も出さない。
// 「見た」を押すと、その失敗(処理と時刻の組)は出さない。新しく止まったもの・また失敗したものはまた出る。直れば自然に消える。
// 「見た」の印はこの端末だけ(localStorage)。読めなくても困らない(毎回出るだけ)。
import { loadItems } from "../jobs/load.js";
import { alerts, alertKey, hasUnseen } from "../jobs/jobs.js";

const SEEN_KEY = "aa_jobs_seen";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); } catch (e) { return []; } };
const writeSeen = (keys) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(keys)); } catch (e) { /* 出続けるだけ */ } };

export async function showJobBanner(el, href) {
  let list;
  try {
    list = alerts(await loadItems());
  } catch (e) {
    return; // 読めないときは出さない(詳しく見るページで分かる)
  }
  if (!list.length || !hasUnseen(list, readSeen())) return;
  const names = list.map((i) => i.name).join("、");
  el.innerHTML = `<span class="job-alert-text">⚠ うまくいっていない処理: ${names}</span>
    <a href="${href}">詳しく ›</a><button type="button" aria-label="見た(この失敗はもう出さない)">見た</button>`;
  el.hidden = false;
  el.querySelector("button").addEventListener("click", () => {
    writeSeen(list.map(alertKey));
    el.hidden = true;
  });
}
