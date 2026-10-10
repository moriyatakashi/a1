// 永続認証。2026-07-19〜10-10 は Azure の /api/session で無期限トークンに交換していた。
// 2026-10-10(ab-166 ④): Azure をやめるため /session を使わない。持ち主かは Google のトークンのメール(sha256)で見て、
// ログインを覚えるのは Firebase に任せる。localStorage には「ログイン済み」の印(kind:"firebase")だけを置き、トークンは置かない。
// ログアウトは Firebase からも出て、印を消し、ログインゲートに戻ること。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";
import { routeFirebaseStub } from "./firebase-stub.js";
import { FAKE_GOOGLE_CREDENTIAL, credFor, useTestOwner } from "./test-owner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript" };

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

// ba のページで確かめる。Azure の /session に行ったら数える(行かないことを見る)
async function openBa(act, { seed } = {}) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await useTestOwner(page);
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    const sessionCalls = [];
    await page.route("https://ab-board-api.azurewebsites.net/api/**", (route) => {
      if (route.request().url().includes("/session")) sessionCalls.push(route.request().method());
      return route.fulfill({ contentType: "application/json", body: "[]" });
    });
    await routeFirebaseStub(page, {});
    if (seed) await page.addInitScript((v) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("aa_credential", v); sessionStorage.setItem("seeded", "1"); } }, seed);
    await page.goto(`http://localhost:${server.address().port}/src/ba/`);
    const out = await act(page);
    return { ...out, sessionCalls };
  } finally {
    await browser.close();
    server.close();
  }
}

test("ba: 持ち主でログインすると幕が開き、Firebase にも入り、印だけ保存する。Azure の /session には行かない", async () => {
  const { stored, signedIn, afterLogout, signedOut, gateVisible, sessionCalls } = await openBa(async (page) => {
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#content", { state: "visible" });
    await page.waitForFunction(() => window.__fsSignedIn === true);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("aa_credential")));
    const signedIn = await page.evaluate(() => window.__fsSignedIn);
    // ログアウト: Firebase からも出て、印が消え、ゲートに戻る
    await page.waitForSelector("#aa-logout-link", { state: "visible" });
    const signedOutP = page.evaluate(() => new Promise((r) => { const t = setInterval(() => { if (window.__fsSignedOut) { clearInterval(t); r(true); } }, 10); }));
    await page.click("#aa-logout-link");
    const signedOut = await signedOutP.catch(() => "reloaded");
    await page.waitForSelector("#login-gate", { state: "visible" });
    const afterLogout = await page.evaluate(() => localStorage.getItem("aa_credential"));
    return { stored, signedIn, afterLogout, signedOut, gateVisible: await page.isVisible("#login-gate") };
  });
  assert.equal(stored.kind, "firebase");
  assert.equal(stored.credential, undefined, "トークンは保存しない");
  assert.equal(signedIn, true, "裏で Firebase にログインしている");
  assert.ok(signedOut === true || signedOut === "reloaded");
  assert.equal(afterLogout, null, "ログアウト後は印が消えている");
  assert.equal(gateVisible, true);
  assert.deepEqual(sessionCalls, [], "Azure の /session には行かない");
});

test("ba: 持ち主でないアカウントはログインさせない", async () => {
  const { visible, stored } = await openBa(async (page) => {
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), credFor("someone@example.com"));
    await page.waitForFunction(() => /このアカウントでは使えません/.test(document.getElementById("status").textContent));
    return { visible: await page.isVisible("#content"), stored: await page.evaluate(() => localStorage.getItem("aa_credential")) };
  });
  assert.equal(visible, false);
  assert.equal(stored, null);
});

test("ba: Azure の頃の印(kind:session)が残っている端末は、ログアウトさせずに入れて、印を書き換える", async () => {
  const seed = JSON.stringify({ credential: "session:old.sig", name: "Test User", kind: "session", savedAt: 1 });
  const { visible, stored, sessionCalls } = await openBa(async (page) => {
    await page.waitForSelector("#content", { state: "visible" });
    return { visible: true, stored: await page.evaluate(() => JSON.parse(localStorage.getItem("aa_credential"))) };
  }, { seed });
  assert.equal(visible, true);
  assert.equal(stored.kind, "firebase");
  assert.equal(stored.credential, undefined, "古いトークンは捨てる");
  assert.deepEqual(sessionCalls, []);
});
