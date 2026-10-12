// ab-177(2026-10-12 すま): m9「打倒あすけん」。食べ物を選ぶと1食の点(そろうと +3)と1日の合計、足りないものが出る。
// 何も書き込まない(結果は残さない)ことも見る。Firestore はスタブ、ネットワークに出ない。
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

test("m9: ご飯・納豆・みそ汁で 12点(そろい +3)、2食目のカップ麺は足りないものが出る。何も書かない", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage();
    await useTestOwner(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => route.request().url().endsWith("/session")
      ? route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await routeFirebaseStub(page, {}, {});
    await page.goto(`http://localhost:${server.address().port}/src/m9/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector(".food");
    for (const n of ["ご飯(1膳)", "納豆", "みそ汁"]) await page.click(`.food[data-name="${n}"]`);
    assert.match(await page.textContent("#mealLine"), /1食目 12点\(9 \+ そろい 3\) \/ ¥110/);
    assert.equal((await page.textContent("#mealLack")).trim(), "");
    await page.click(".tab[data-i='1']");
    await page.click(`.food[data-name="カップ麺"]`);
    assert.match(await page.textContent("#mealLack"), /たんぱく・野菜が足りない/);
    assert.match(await page.textContent("#dayTotal"), /^12/);
    assert.match(await page.textContent("#dayLack"), /果物・乳が足りない/);
    await page.click(".chip[data-rm='0']");
    assert.match(await page.textContent("#mealLine"), /2食目 まだ選んでいません/);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.screenshot({ path: process.env.M9_SHOT || "/dev/null", fullPage: false }).catch(() => {});
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
