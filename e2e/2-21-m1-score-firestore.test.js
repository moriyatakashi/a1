// ab-24(2026-09-29): m1 の毎日スコアは Firestore(ab01-9f35a の scores/{日付})に直接書く。
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
import { listenSafe } from "./listen-safe.js";
import { FAKE_GOOGLE_CREDENTIAL, useTestOwner } from "./test-owner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const API_BASE = "https://ab-board-api.azurewebsites.net/api";

// ab-162: 公開の閲覧モードをやめたので、開いたらログインする(セッション交換はスタブ)
async function openLoggedIn(page, url) {
  await page.route(`${API_BASE}/session`, (route) =>
    route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) }));
  await page.goto(url);
  await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
}

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

test("m1: 保存は Firestore の scores/{今日} へ直接書き、Azure の /api/scores には行かない(ab-24)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage()
    await useTestOwner(page);
    const azureScoreCalls = [];
    page.on("request", (req) => { if (req.url().startsWith(`${API_BASE}/scores`)) azureScoreCalls.push(req.url()); });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/session`, (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) }));
    await routeFirebaseStub(page, { "2026-07-18": { score: 80, note: "" } });

    await page.goto(`http://localhost:${server.address().port}/src/m1/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#scoreChartSection", { state: "visible" });

    await page.fill("#noteInput", "よく眠れた");
    await page.$eval("#slider", (el) => { el.value = "33"; el.dispatchEvent(new Event("input")); });
    await page.click("#btnSaveScore");
    await page.waitForFunction(() => (window.__fsWrites || []).length === 1);
    // 保存後は scores を読み直さず、手元の一覧に今日の分を入れて描き直す(ab-97)。最新が 33 になる
    await page.waitForFunction(() => document.getElementById("statLatest").textContent === "33");
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

test("m1: スライダーは普段 100 まで、「120まで」で広げる。100 超えの日を開くと広がっている(Takashi 2026-10-08)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage()
    await useTestOwner(page);
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

    await routeFirebaseStub(page, {});
    await openLoggedIn(page, `http://localhost:${server.address().port}/src/m1/`);
    await page.waitForFunction(() => document.getElementById("scoreNum").textContent === "80");
    assert.equal(await page.getAttribute("#slider", "max"), "100");
    await page.click("#btnWide");
    assert.equal(await page.getAttribute("#slider", "max"), "120");
    await page.$eval("#slider", (el) => { el.value = "115"; el.dispatchEvent(new Event("input")); });
    await page.click("#btnWide"); // 戻すと 100 に丸まる
    assert.equal(await page.getAttribute("#slider", "max"), "100");
    assert.equal(await page.textContent("#scoreNum"), "100");

    const page2 = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage()

    await useTestOwner(page2);
    await page2.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await routeFirebaseStub(page2, { [today]: { score: 110, note: "" } });
    await openLoggedIn(page2, `http://localhost:${server.address().port}/src/m1/`);
    await page2.waitForFunction(() => document.getElementById("scoreNum").textContent === "110");
    assert.equal(await page2.getAttribute("#slider", "max"), "120");
    assert.equal(await page2.getAttribute("#btnWide", "aria-pressed"), "true");
  } finally {
    await browser.close();
    server.close();
  }
});
