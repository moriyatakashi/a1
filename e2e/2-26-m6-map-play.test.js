// ab-44(2026-10-03): m6 地図あそび。訪問(visits)と点数(scores)を Firestore から読み(SDK はスタブ)、
// 制覇数・県ごとの集計・スタンプ・県あてクイズが出ること、このページからは何も書かないことを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
};

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

const v = (place, date, pref, lat, lng) => ({ place, date, time: "10:00", pref, lat, lng, by: "takashi" });
const VISITS = {
  a: v("大阪市 北区", "2026-09-20", "大阪府", 34.70, 135.50),
  b: v("大阪市 西区", "2026-09-21", "大阪府", 34.68, 135.48),
  c: v("大津市", "2026-09-22", "滋賀県", 35.00, 135.86),
};
const SCORES = { "2026-09-20": { score: 80 }, "2026-09-21": { score: 90 }, "2026-09-22": { score: 70 } };

test("m6: 訪問と点数を読んで、制覇数・県の集計・スタンプ・クイズが出る", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await routeFirebaseStub(page, SCORES, { visits: VISITS });
    await page.goto(`http://localhost:${server.address().port}/src/m6/`);
    await page.waitForFunction(() => document.getElementById("statPrefs").textContent === "2");
    assert.equal(await page.textContent("#statVisits"), "3");
    assert.equal(await page.textContent("#statDays"), "3");

    // 大阪府: 2回・2日、その日の点数の平均 85
    await page.click('#prefs [data-p="大阪府"]');
    const info = await page.textContent("#info");
    assert.match(info, /大阪府 — 2回・2日、初訪問 2026-09-20、その日の点数 平均 85\.0/);

    // スタンプは47枠、押されているのは2つ
    assert.equal(await page.locator(".stamp").count(), 47);
    assert.equal(await page.locator('.stamp circle[stroke="#c94545"]').count(), 4); // 判1つに円2つ

    // クイズ: 4択のどれかを押すと正解が緑になり、回答数が1になる
    assert.equal(await page.locator("#choices button").count(), 4);
    await page.locator("#choices button").first().click();
    assert.equal(await page.locator("#choices button.ok").count(), 1);
    assert.match(await page.textContent("#quizScore"), /^[01] \/ 1/);

    // 歩く・霧を晴らすでエラーが出ない
    await page.click("#btnWalk");
    await page.click("#btnReveal");
    await page.waitForTimeout(300);

    assert.deepEqual(errors, []);
    const writes = await page.evaluate(() => [...(window.__fsWrites || []), ...(window.__fsOtherWrites || [])]);
    assert.deepEqual(writes, [], "m6 は何も書かない");
  } finally {
    await browser.close();
    server.close();
  }
});
