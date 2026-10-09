// ab-147(2026-10-09 礼文): m7 COBOL 入門。8問が出て、まちがえるとヒント、正解すると印と解説が開き、端末に覚える。
// 「動かしてみる」と Playground はページの中の解釈系で動く(外へは出ない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";
import { LESSONS } from "../src/m7/lessons.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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

test("m7: 四択でまちがえるとヒント、正解で印・解説・進み具合。動かしてみると Playground も動く", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const url = `http://localhost:${server.address().port}/src/m7/`;
    await page.goto(url);
    await page.waitForSelector(".lesson");
    assert.equal(await page.locator(".lesson").count(), LESSONS.length);
    assert.equal(await page.textContent("#progressText"), `正解 0 / ${LESSONS.length}`);

    const first = LESSONS[0];
    const card = page.locator(`#l-${first.id}`);
    // 正解がいつも A にならないよう、まぜてある
    const wrongIdx = first.choices.findIndex((_, i) => i !== first.answer);
    await card.locator(`.choices button[data-i="${wrongIdx}"]`).click();
    assert.match(await card.locator(".feedback").textContent(), /^ちがいました。ヒント: /);
    assert.equal(await card.locator(`.choices button[data-i="${wrongIdx}"]`).isDisabled(), true);
    await card.locator(`.choices button[data-i="${first.answer}"]`).click();
    assert.match(await card.locator(".feedback").textContent(), /^正解！/);
    assert.equal(await card.locator(".notes").getAttribute("open"), "");
    assert.equal(await page.textContent("#progressText"), `正解 1 / ${LESSONS.length}`);

    await card.locator('[data-act="run"]').click();
    assert.equal(await card.locator(".out").textContent(), "HELLO, COBOL");

    // ACCEPT の例題は入力つきで動く
    const acc = page.locator("#l-accept");
    await acc.locator('[data-act="run"]').click();
    assert.equal(await acc.locator(".out").textContent(), "入力: TARO / 7\nTARO  (007)");

    // Playground: 見本が動く。まちがいは行番号つきで止まる
    await page.click("#btnPlay");
    assert.match(await page.textContent("#playOut"), /^01こ: 01320円\n02こ: 02640円\n03こ: 03960円$/);
    await page.fill("#playCode", '       PROCEDURE DIVISION.\n           EVALUATE TRUE.\n');
    await page.click("#btnPlay");
    assert.match(await page.textContent("#playOut"), /止まった: 2行目: 「EVALUATE」はまだ使えない語/);

    // 開きなおしても正解ずみは残る(この端末に覚える)
    await page.reload();
    await page.waitForSelector(".lesson");
    assert.equal(await page.textContent("#progressText"), `正解 1 / ${LESSONS.length}`);
    assert.equal(await card.locator(".done-mark").isHidden(), false);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
});
