// ab-43(2026-10-03): m1 の2つ目の点=チェック項目を数えた点。
// 項目は Firestore の scoreConfig/current から読み、押した結果を scores/{今日}.check に文面ごと残す。
// 「項目を変える」では、棚(scoreItems)にある文面は使い回し、無い文面だけ棚に足して scoreConfig/current を入れ替える。
// Firebase SDK はスタブ(ネットワークに出ない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";

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
    listenSafe(server).then(resolve);
  });
}

test("m1: チェック項目を押して保存すると check が残り、項目の入れ替えは棚を使い回す(ab-43)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage();
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/session`, (route) =>
      route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) }));
    await routeFirebaseStub(page, { "2026-07-18": { score: 80, note: "" } }, {
      scoreItems: { a: { text: "3食" }, b: { text: "散歩" } },
      scoreConfig: { current: { items: [{ id: "a", text: "3食" }, { id: "b", text: "散歩" }] } },
    });

    await page.goto(`http://localhost:${server.address().port}/src/m1/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#checkBox", { state: "visible" });
    assert.deepEqual(await page.locator(".check-text").allTextContents(), ["3食", "散歩"]);
    // 押していない項目は △(Takashi 2026-10-08、前は ×)
    assert.deepEqual(await page.locator('.mark[aria-pressed="true"]').allTextContents(), ["△", "△"]);
    assert.equal(await page.textContent("#checkScoreNum"), "50");

    // ○ と △ → (1 + 0.5) / 2 = 75点(△は半分、ab-129)。保存すると scores/{今日}.check に文面と印が入る
    await page.getByRole("button", { name: "3食: ○" }).click();
    assert.equal(await page.textContent("#checkScoreNum"), "75");
    await page.getByRole("button", { name: "散歩: △" }).click();
    assert.equal(await page.textContent("#checkScoreNum"), "75");
    await page.click("#btnSaveScore");
    await page.waitForFunction(() => (window.__fsWrites || []).length === 1);
    const [w] = await page.evaluate(() => window.__fsWrites);
    assert.equal(w.check.score, 75);
    assert.deepEqual(w.check.items, [{ id: "a", text: "3食", done: true, mark: "○" }, { id: "b", text: "散歩", done: false, mark: "△" }]);

    // 項目を入れ替える: 3食(棚にある)+読書(新しい)。3食の今日の○は残り、読書は△から
    await page.click("#btnEditItems");
    const inputs = page.locator("#itemInputs input");
    await inputs.nth(0).fill("3食");
    await inputs.nth(1).fill("読書");
    await inputs.nth(2).fill("");
    await page.click("#btnSaveItems");
    await page.waitForFunction(() => (window.__fsOtherWrites || []).some((x) => x.col === "scoreConfig"));
    const others = await page.evaluate(() => window.__fsOtherWrites);
    assert.deepEqual(others.filter((x) => x.col === "scoreItems").map((x) => x.text), ["読書"], "棚に足すのは新しい文面だけ");
    const cur = others.find((x) => x.col === "scoreConfig");
    assert.equal(cur.id, "current");
    assert.deepEqual(cur.items.map((i) => i.text), ["3食", "読書"]);
    assert.equal(cur.items[0].id, "a", "3食は棚の id を使い回す");
    assert.deepEqual(await page.locator(".check-text").allTextContents(), ["3食", "読書"]);
    assert.deepEqual(await page.locator('.mark[aria-pressed="true"]').allTextContents(), ["○", "△"]);
    assert.equal(await page.textContent("#checkScoreNum"), "75");
  } finally {
    await browser.close();
    server.close();
  }
});

test("m1: 前の記録(done だけ)は ○/× として読む(ab-129)", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ timezoneId: "Asia/Tokyo" })).newPage();
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    await routeFirebaseStub(page, {
      [today]: { score: 80, note: "", check: { items: [{ id: "a", text: "3食", done: true }, { id: "b", text: "散歩", done: false }], score: 50 } },
    }, {
      scoreItems: { a: { text: "3食" }, b: { text: "散歩" } },
      scoreConfig: { current: { items: [{ id: "a", text: "3食" }, { id: "b", text: "散歩" }] } },
    });
    await page.goto(`http://localhost:${server.address().port}/src/m1/`);
    await page.waitForSelector("#checkBox", { state: "visible" });
    assert.deepEqual(await page.locator('.mark[aria-pressed="true"]').allTextContents(), ["○", "×"]);
    assert.equal(await page.textContent("#checkScoreNum"), "50");
  } finally {
    await browser.close();
    server.close();
  }
});
