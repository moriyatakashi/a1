// load.js — 毎日の処理の記録を集める(2026-10-17)。トップの1行(common/job-banner.js)と処理の様子のページ(app.js)が使う。
// jobStatus・steps は Firestore(読みは Takashi 本人だけ)、バックアップは GitHub Actions の実行結果(a1 は公開レポなので鍵なしで読める)。
// 1つ読めなくても他は出す(読めなかったものは unknown、トップには出さない)。
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureReadLogin } from "../common/firebase.js";
import { CHECKS, fromJobDoc, fromSteps, fromWorkflowRuns, evaluate } from "./jobs.js";

const GH_RUNS = (wf) => `https://api.github.com/repos/moriyatakashi/a1/actions/workflows/${wf}/runs?per_page=10`;
const err = (e) => ({ error: e.code || e.message || String(e) });

async function loadGh(wf) {
  const r = await fetch(GH_RUNS(wf), { headers: { Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return fromWorkflowRuns((await r.json()).workflow_runs);
}

export async function loadRecords() {
  const records = {};
  const jobs = CHECKS.filter((c) => c.source === "job");
  await ensureReadLogin();
  await Promise.all([
    getDocs(collection(db, "jobStatus")).then((snap) => {
      const byId = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
      for (const c of jobs) records[c.id] = fromJobDoc(byId[c.id]);
    }, (e) => { for (const c of jobs) records[c.id] = err(e); }),
    getDocs(collection(db, "steps")).then(
      (snap) => { records.steps = fromSteps(snap.docs.map((d) => d.data())); },
      (e) => { records.steps = err(e); }),
    ...CHECKS.filter((c) => c.source === "gh").map((c) =>
      loadGh(c.workflow).then((rec) => { records[c.id] = rec; }, (e) => { records[c.id] = err(e); })),
  ]);
  return records;
}

export async function loadItems(now = Date.now()) {
  return evaluate(await loadRecords(), now);
}
