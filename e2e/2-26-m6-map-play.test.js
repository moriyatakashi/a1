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

    // クイズ(形あて): 4択のどれかを押すと正解が緑になり、回答数が1になる
    await page.selectOption("#quizKind", "shape");
    assert.equal(await page.locator("#choices button").count(), 4);
    await page.locator("#choices button").first().click();
    assert.equal(await page.locator("#choices button.ok").count(), 1);
    assert.match(await page.textContent("#quizScore"), /^この回 [01] \/ 1/);

    // 10/03 2回目: 地方ごとの制覇・次の一県・次に晴らせる県・県の詳細
    assert.match(await page.textContent("#regions"), /近畿2\/7/);
    assert.match(await page.textContent("#nextPref"), /^次の一県: \S+\(最後の訪問地 大津市 から約\d+km/);
    assert.ok(await page.locator('#front [data-p="京都府"]').count() > 0, "京都府は次に晴らせる");
    assert.equal(await page.locator('#front [data-p="大阪府"]').count(), 0);
    await page.click('#prefs [data-p="大阪府"]');
    assert.match(await page.textContent("#info"), /近畿地方 \/ 県庁所在地 大阪市 \/ 面積 約1,900km²/);
    assert.match(await page.textContent("#info"), /となり: .*京都府/);
    await page.click("#nextPref button");
    assert.match(await page.textContent("#info"), /まだ行っていない/);
    assert.match(await page.textContent("#stamps"), /近畿 2\/7/);

    // クイズの種類: どれでも正解が1つ緑になり、答えのあとに一言が出る。1回は5問(形あての1問目と合わせて5問)
    for (const [kind, n] of [["neighbor", 4], ["area", 2], ["capital", 4], ["review", null]]) {
      await page.selectOption("#quizKind", kind);
      if (n) assert.equal(await page.locator("#choices button").count(), n, kind);
      await page.locator("#choices button").first().click();
      assert.equal(await page.locator("#choices button.ok").count(), 1, kind);
      assert.ok((await page.textContent("#quizAfter")).length > 3, kind);
    }
    assert.match(await page.textContent("#quizScore"), /^この回 \d \/ 5/);
    assert.match(await page.textContent("#quizAfter"), /5問中 \d問 正解/);
    assert.equal(await page.textContent("#btnNext"), "もう1回(5問)");
    assert.match(await page.textContent("#quizBank"), /^たまった正解 \d \/ 50\(あと\d+で1点\)/);
    await page.click("#btnNext");
    assert.equal(await page.textContent("#quizRound"), "1 / 5問目");

    // 歩く・霧を晴らすでエラーが出ない
    await page.click("#btnWalk");
    await page.click("#btnReveal");
    await page.waitForTimeout(300);

    assert.deepEqual(errors, []);
    const writes = await page.evaluate(() => [...(window.__fsWrites || []), ...(window.__fsOtherWrites || [])]);
    assert.deepEqual(writes, [], "正解が50たまるまでは何も書かない");

    // 正解が50たまっている状態で1回(5問)終えると、pointEvents に1点を1件書き、ためた分から50引く
    await page.evaluate(() => localStorage.setItem("m6.quizBank", "50"));
    await page.selectOption("#quizKind", "shape");
    for (let i = 0; i < 5; i++) {
      if (i) await page.click("#btnNext");
      await page.locator("#choices button").first().click();
    }
    await page.waitForFunction(() => (window.__fsOtherWrites || []).length === 1);
    const [pe] = await page.evaluate(() => window.__fsOtherWrites);
    assert.equal(pe.col, "pointEvents");
    assert.equal(pe.axis, "地図クイズ");
    assert.equal(pe.points, 1);
    assert.equal(pe.period, "week");
    assert.equal(pe.by, "takashi");
    await page.waitForFunction(() => /1点 加点した/.test(document.getElementById("quizAfter").textContent));
    assert.ok(Number(await page.evaluate(() => localStorage.getItem("m6.quizBank"))) <= 5);
  } finally {
    await browser.close();
    server.close();
  }
});
