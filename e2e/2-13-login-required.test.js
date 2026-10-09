// ab-162(2026-10-10): 公開の閲覧モード(AA_PUBLIC_VIEW、ba-35残課題(2) で m1・m2・bc・cc・a2/x3〜x5 に入れていた)をやめた。
// ログインしていなければ中身(#content)は出ず、ログインの幕だけが見えること。データも取りに行かないこと。
// (旧 2-13-public-view-k2.test.js は「ログインなしで中身が見える」ことを確かめていた。向きを逆にした)
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

const PAGES = ["m1", "m2", "bc", "cc", "a2/x3", "a2/x4", "a2/x5"];

for (const rel of PAGES) {
  test(`${rel}: ログインしていなければ中身を出さず、データも取りに行かない(ab-162)`, async () => {
    const server = await serveStatic();
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const dataCalls = [];
      page.on("request", (req) => {
        const u = req.url();
        // 最終更新の時刻(/last-updated)はページの作りの情報なので数えない
        if ((u.startsWith(API_BASE) && !u.startsWith(`${API_BASE}/last-updated`)) || /firestore\.googleapis\.com/.test(u)) dataCalls.push(u);
      });
      await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
      await page.route(`${API_BASE}/**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
      await page.route(/firestore\.googleapis\.com\//, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
      await routeFirebaseStub(page, {}, {});

      await page.goto(`http://localhost:${server.address().port}/src/${rel}/`);
      await page.waitForTimeout(800);
      assert.equal(await page.isVisible("#content"), false, "ログインなしで中身が見えている");
      assert.equal(await page.isVisible("#login-gate"), true, "ログインの幕が出ていない");
      assert.equal(await page.isVisible("#aa-login-link"), false, "公開の閲覧モードの「ログイン」リンクが出ている");
      const fsReads = await page.evaluate(() => (window.__fsReads || []).length);
      assert.equal(fsReads, 0, "ログインなしで Firestore を読んでいる");
      assert.deepEqual(dataCalls, [], "ログインなしでデータを取りに行っている");
    } finally {
      await browser.close();
      server.close();
    }
  });
}
