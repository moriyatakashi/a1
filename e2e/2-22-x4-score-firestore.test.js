// 2026-10-02: a2/x4 も m1 と同じく(common/score-store.js 経由)。元は ab-24(2026-09-29): m1 の毎日スコアは Firestore(ab01-9f35a の scores/{日付})に直接書く。
// ログイン後に「保存」を押すと、Firebase のログインを経て scores/{今日} に {score, note, by:"takashi"} が書かれ、
// Azure の /api/scores には一切行かないことを確かめる(Firebase SDK はスタブ、ネットワークに出ない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const API_BASE = "https://ab-board-api.azurewebsites.net/api";
const FAKE_GOOGLE_CREDENTIAL = "header." + Buffer.from(JSON.stringify({ name: "Test User" })).toString("base64") + ".sig";

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
    server.listen(0, () => resolve(server));
  });
}

test("a2/x4: 保存は Firestore の scores/{今日} へ直接書き、Azure の /api/scores には行かない(x4 を Azure PUT から切り替え)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const azureScoreCalls = [];
    page.on("request", (req) => { if (req.url().startsWith(`${API_BASE}/scores`)) azureScoreCalls.push(req.url()); });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/session`, (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) }));
    await routeFirebaseStub(page, { "2026-07-18": { score: 80, note: "" } });

    await page.goto(`http://localhost:${server.address().port}/src/a2/x4/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#scoreChartSection", { state: "visible", timeout: 5000 });

    await page.fill("#noteInput", "よく眠れた");
    await page.$eval("#slider", (el) => { el.value = "33"; el.dispatchEvent(new Event("input")); });
    await page.click("#btnSaveScore");
    await page.waitForFunction(() => (window.__fsWrites || []).length === 1, null, { timeout: 5000 });
    // 保存後は scores を読み直さず、手元の一覧に今日の分を入れて描き直す(ab-97)。最新が 33 になる
    await page.waitForFunction(() => document.getElementById("statLatest").textContent === "33", null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => (window.__fsReads || []).filter((n) => n === "scores").length), 1);
    const [w] = await page.evaluate(() => window.__fsWrites);
    assert.match(w.id, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(w.note, "よく眠れた");
    assert.equal(w.by, "takashi");
    assert.equal(typeof w.score, "number");
    assert.equal(await page.evaluate(() => typeof window.__googleIdToken), "string", "GSIのIDトークンがメモリに渡っている");
    assert.deepEqual(azureScoreCalls, []);
  } finally {
    await browser.close();
    server.close();
  }
});
