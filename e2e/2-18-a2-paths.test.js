// src/a2/(旧a2独立リポジトリのアプリ x1〜x6、2026-09-22にa2-archive/からsrc/a2/へ移設)の
// パス・深さの回帰テスト。
// a2の各ページは共通部品を ../../common/(src/common/)から読む。深さがずれると
// CSS/JSが404になる、またはモジュールのimportが失敗してページが動かなくなるため、
// 「全ページがローカルの404なし・スクリプトエラーなしで開く」「戻るリンクの行き先が合う」
// 「nav.ymlのa2リンク先が実在する」ことを確認する。API呼び出し・Google認証は
// page.route()でモックする(外部へは出ない)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".json": "application/json", ".geojson": "application/json",
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

const PAGES = ["", "x1/", "x2/", "x3/", "x4/", "x5/", "x6/"];

test("a2: 目次と全アプリがローカルの404・スクリプトエラーなしで開く", async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const browser = await chromium.launch();
  try {
    for (const rel of PAGES) {
      const page = await browser.newPage();
      const pageErrors = [];
      const localFailures = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      page.on("response", (r) => {
        if (r.url().startsWith(origin) && r.status() >= 400) localFailures.push(`${r.status()} ${r.url()}`);
      });
      // 外部(ab-board-api・GSI・CDN等)には出ない。APIは空データで返す。
      await page.route((u) => !u.href.startsWith(origin), (route) => {
        const url = route.request().url();
        if (url.includes("ab-board-api.azurewebsites.net")) {
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        return route.abort();
      });
      await page.goto(`${origin}/src/a2/${rel}`);
      await page.waitForTimeout(400);
      assert.deepEqual(localFailures, [], `src/a2/${rel}: ローカルファイルが404: ${localFailures.join(", ")}`);
      assert.deepEqual(pageErrors, [], `src/a2/${rel}: スクリプトエラー: ${pageErrors.join(" | ")}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("a2: 戻るリンクの行き先(各アプリ→a2目次、目次→トップ)", async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route((u) => !u.href.startsWith(origin), (route) => route.abort());
    for (const rel of PAGES) {
      await page.goto(`${origin}/src/a2/${rel}`);
      const href = await page.locator("a", { hasText: "← 戻る" }).first().evaluate((a) => a.href);
      const expected = rel === "" ? `${origin}/` : `${origin}/src/a2/`;
      assert.equal(href, expected, `src/a2/${rel} の戻るリンク`);
    }
  } finally {
    await browser.close();
    server.close();
  }
});

test("a2: nav.ymlのa2リンク先が実在し、robots.txtで検索除外されている", () => {
  const nav = yaml.load(fs.readFileSync(path.join(ROOT, "nav.yml"), "utf8"));
  const hrefs = nav.categories.flatMap((c) => c.items.map((i) => i.href)).filter((h) => h.startsWith("src/a2/"));
  assert.ok(hrefs.length >= 7, `nav.ymlのa2リンクが足りない: ${hrefs.length}`);
  for (const h of hrefs) {
    assert.ok(fs.existsSync(path.join(ROOT, h, "index.html")), `${h} が存在しない`);
  }
  const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
  assert.match(robots, /^Disallow: \/src\/a2\/$/m);
});
