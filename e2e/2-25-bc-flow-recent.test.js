// bc の追加(2026-10-03、ab-45 の続き)。
// - 今の状態に「待ち(ab)」: 済んでいない ab の waitUntil を日付順に。日が来たら「来た」、まだなら「まで」
// - 今の状態に「最近の動き(ba・ab)」: 書き込みを新しい順に8件。ab の済みも1件の動き、タイトルを直しただけの自動 note は出さない
// - 「流れ」タブ: 直近14日、日ごとに開いた件数と片付いた件数。ba で無効にしたものは数えない
// - 投稿者別の軸名を家人の名前にする(claude-pc → 利尻 など)
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";
import { routeFirebaseStub } from "./firebase-stub.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

function serveStatic() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p.endsWith("/")) p += "index.html";
      fs.readFile(path.join(ROOT, p), (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
        res.end(data);
      });
    });
    listenSafe(server).then(resolve);
  });
}

const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();
const jstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
const md = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const future = jstDate(Date.now() + 7 * 86400000);
const past = jstDate(Date.now() - 3 * 86400000);

// ba: B1 開いている / B2 20日前に立てて20時間前に閉じた / B3 立てて無効にした(流れに数えない)
const BA = [
  { id: "B1", threadId: "B1", by: "claude-pc", type: "new", seq: 1, createdAt: hoursAgo(30), title: "べー1" },
  { id: "B2", threadId: "B2", by: "claude-mobile", type: "new", seq: 2, createdAt: hoursAgo(480), title: "べー2" },
  { id: "B2-s", threadId: "B2", by: "takashi", type: "status", status: "closed", createdAt: hoursAgo(20) },
  { id: "B3", threadId: "B3", by: "claude-pc", type: "new", seq: 3, createdAt: hoursAgo(26), title: "べー3" },
  { id: "B3-v", threadId: "B3", by: "takashi", type: "void", value: true, createdAt: hoursAgo(25) },
];

const FS = "https://firestore.googleapis.com/v1/projects/ab01-9f35a/databases/(default)/documents/abThreads";
function abDoc(id, { seq, title, by = "claude-pc", createdAt, done = false, doneAt, doneBy, waitUntil, waitFor }) {
  const f = {
    by: { stringValue: by }, createdAt: { stringValue: createdAt }, seq: { integerValue: String(seq) },
    title: { stringValue: title }, done: { booleanValue: done }, needsReply: { booleanValue: false },
    to: { arrayValue: { values: [{ stringValue: "all" }] } },
  };
  if (doneAt) { f.doneAt = { stringValue: doneAt }; f.doneBy = { stringValue: doneBy }; }
  if (waitUntil) f.waitUntil = { stringValue: waitUntil };
  if (waitFor) f.waitFor = { stringValue: waitFor };
  return { name: `x/abThreads/${id}`, fields: f };
}
const note = (createdAt, body = "") => ({ name: "x/n", fields: { by: { stringValue: "claude-pc" }, createdAt: { stringValue: createdAt }, body: { stringValue: body } } });
// A1: 天売が10時間前に立てた、1週間後まで待つ、1時間前にタイトルだけ直した
// A2: 30日前に立てて5時間前に済み(待ちの印が残っていても済みなので出さない)
// A3: 40時間前に立てた、待ちの日が来ている
const AB_ROUTES = {
  [FS]: { documents: [
    abDoc("A1", { seq: 1, title: "えー1", by: "claude-teuri", createdAt: hoursAgo(10), waitUntil: future, waitFor: "返事" }),
    abDoc("A2", { seq: 2, title: "えー2", createdAt: hoursAgo(720), done: true, doneAt: hoursAgo(5), doneBy: "claude-pc", waitUntil: past }),
    abDoc("A3", { seq: 3, title: "えー3", createdAt: hoursAgo(40), waitUntil: past }),
  ] },
  [`${FS}/A1/notes`]: { documents: [note(hoursAgo(1), "タイトルを変えた(旧: えー1の古い名前)")] },
  // A3: 利尻が note を2回続けて足した → 1行「note ×2」
  [`${FS}/A3/notes`]: { documents: [note(hoursAgo(2)), note(hoursAgo(3))] },
};

test("bc: 待ち・最近の動き・流れ・投稿者の名前(ab-45)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route("https://ab-board-api.azurewebsites.net/api/ba", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(BA) }));
    await routeFirebaseStub(page, {}, {}); // ab-162: bc は ab を読む前に Firebase にログインする(ネットワークに出さない)
    await page.route(/firestore\.googleapis\.com\//, (route) => {
      const url = route.request().url().split("?")[0];
      route.fulfill({ contentType: "application/json", body: JSON.stringify(AB_ROUTES[url] || {}) });
    });

    await page.goto(`http://localhost:${server.address().port}/src/bc/`);
    await page.evaluate(() => {
      document.getElementById("content").style.display = "block";
      window.__credential = "test";
      window.dispatchEvent(new Event("bc-login-success"));
    });
    await page.waitForSelector("#nowPanel .now-recent li");

    const squash = (arr) => arr.map((s) => s.replace(/\s+/g, ""));
    assert.deepEqual(squash(await page.locator("#nowPanel .now-wait li").allTextContents()),
      [`ab-3えー3${md(past)}来た`, `ab-1えー1${md(future)}まで(返事)`], "日付順、A2 は済みなので出さない");

    const recent = squash(await page.locator("#nowPanel .now-recent li").allTextContents())
      .map((s) => s.replace(/^\d+\/\d+\d\d:\d\d/, ""));
    assert.equal(recent.length, 8);
    assert.deepEqual(recent.slice(0, 6), ["利尻ab-3note×2えー3", "利尻ab-2済みえー2", "天売ab-1立てたえー1", "Takashiba-2閉じたべー2", "Takashiba-3無効にしたべー3", "利尻ba-3立てたべー3"],
      "新しい順。A1 のタイトル直しは出さない");

    await page.click('.view-tab[data-view="flow"]');
    const rows = await page.locator("#radarTableBody tr").evaluateAll((trs) => trs.map((tr) => [...tr.cells].map((c) => c.textContent)));
    assert.equal(rows.length, 14);
    const sum = (i) => rows.reduce((s, r) => s + Number(r[i]), 0);
    assert.equal(sum(1), 3, "開いた: B1・A1・A3(B3 は無効、B2・A2 は14日より前)");
    assert.equal(sum(2), 2, "片付いた: B2(閉じた)・A2(済み)");

    await page.click('.view-tab[data-view="poster"]');
    const names = await page.locator("#radarTableBody tr td:first-child").allTextContents();
    assert.deepEqual(names.sort(), ["Takashi", "すま", "利尻", "天売"].sort());
  } finally {
    await browser.close();
    server.close();
  }
});
