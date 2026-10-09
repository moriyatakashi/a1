// ab-162(2026-10-10): Rules の読みを本人だけに絞ったあと、この端末で Firebase にログインしていないと読めない。
// そのとき「読むためにログイン」の帯が出て、押すとログインして読み直すこと(Firebase はスタブ、ネットワークに出ない)。
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
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/json" };
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

test("m8: Firebase にログインしていない端末で訪問が読めないと、帯が出て、押すと読み直す", async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ timezoneId: "Asia/Tokyo", geolocation: { latitude: 34.69, longitude: 135.52 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => route.request().url().endsWith("/session")
      ? route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:t.s" }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.route("https://nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ address: { state: "大阪府", city: "東大阪市", suburb: "布施" } }) }));
    await routeFirebaseStub(page, {}, { visits: {} });
    // 読みは本人だけ(Rules)、かつ GSI のトークンでの Firebase ログインも通らない端末(保存済みのセッションで開いた、など)
    await page.addInitScript(() => { window.__fsDenyRead = ["visits"]; window.__fsCredentialFails = true; });

    await page.goto(`http://localhost:${server.address().port}/src/m8/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForSelector("#aa-read-login", { state: "visible" });
    assert.match(await page.textContent("#aa-read-login"), /ログインが要ります/);
    const nav = page.waitForEvent("framenavigated");
    await page.click("#aa-read-login button");
    await nav; // ログインできたら読み直す(再読み込み)
  } finally {
    await browser.close();
    server.close();
  }
});
