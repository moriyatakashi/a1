// ab-53(2026-10-03): 訪問(m2・a2/x5)は Firestore の visits/{id} を直接読み書きし、初訪問の加点も pointEvents/{id} へ
// 同じ batch で書く。Azure の /api/visits・/api/points には一切行かないことを確かめる(Firebase SDK はスタブ、ネットワークに出ない)。
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
    server.listen(0, () => resolve(server));
  });
}

// 既に大阪府・大阪市・北区に行ったことがある。
const VISITS = {
  v1: { place: "大阪市 北区", date: "2026-09-20", time: "10:00", memo: "", lat: 34.70, lng: 135.50,
        pref: "大阪府", city: "大阪市", town: "北区", autoPointGranularity: "town", createdAt: "2026-09-20T01:00:00.000Z", by: "takashi" },
};

async function addVisitVia(rel, address) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ geolocation: { latitude: 34.69, longitude: 135.52 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    const azureCalls = [];
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith(`${API_BASE}/visits`) || u.startsWith(`${API_BASE}/points`)) azureCalls.push(u);
    });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => {
      if (route.request().url().endsWith("/session")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.route("https://nominatim.openstreetmap.org/**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ address }) }));
    await routeFirebaseStub(page, {}, { visits: VISITS });

    await page.goto(`http://localhost:${server.address().port}/src/${rel}`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForFunction(() => document.getElementById("statTotal").textContent === "1", null, { timeout: 5000 });

    await page.click("#btnGps");
    await page.waitForFunction(() => document.getElementById("placeInput").value !== "", null, { timeout: 5000 });
    await page.click("#btnAddVisit");
    // m2 は「✓」を3秒で消すので、後から読むと重いときに空になる(ab-106)。待つのと同時に拾う
    const status = await (await page.waitForFunction(() => {
      const t = document.getElementById("visitInputStatus").textContent || "";
      return t.startsWith("✓") && t;
    }, null, { timeout: 5000 })).jsonValue();
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    return { writes, status, azureCalls };
  } finally {
    await browser.close();
    server.close();
  }
}

test("m2: 新しい町への訪問は visits と pointEvents(町=2点)を Firestore に書き、Azure には行かない", async () => {
  const { writes, status, azureCalls } = await addVisitVia("m2/", { state: "大阪府", city: "大阪市", suburb: "中央区" });
  const visit = writes.find((w) => w.col === "visits");
  const point = writes.find((w) => w.col === "pointEvents");
  assert.equal(visit.place, "大阪市 中央区");
  assert.equal(visit.pref, "大阪府");
  assert.equal(visit.town, "中央区");
  assert.equal(visit.autoPointGranularity, "town");
  assert.equal(visit.by, "takashi");
  assert.equal(typeof visit.lat, "number");
  assert.match(visit.id, /^[0-9a-f-]{36}$/);
  assert.equal(point.points, 2);
  assert.equal(point.note, "中央区(town)");
  assert.equal(point.catalogId, "visit_new");
  assert.equal(point.visitId, visit.id);
  assert.match(status, /初町で自動加点/);
  assert.deepEqual(azureCalls, []);
});

test("a2/x5: 新しい県なら県=10点だけ(市・町も新しくても二重加点しない)", async () => {
  const { writes, status, azureCalls } = await addVisitVia("a2/x5/", { state: "京都府", city: "京都市", suburb: "山科区" });
  const points = writes.filter((w) => w.col === "pointEvents");
  assert.equal(points.length, 1);
  assert.equal(points[0].points, 10);
  assert.equal(points[0].note, "京都府(pref)");
  assert.match(status, /初県で自動加点/);
  assert.deepEqual(azureCalls, []);
});

test("m2: 行ったことのある県・市・町なら加点は書かない", async () => {
  const { writes, status } = await addVisitVia("m2/", { state: "大阪府", city: "大阪市", suburb: "北区" });
  assert.equal(writes.filter((w) => w.col === "visits").length, 1);
  assert.equal(writes.filter((w) => w.col === "pointEvents").length, 0);
  assert.equal(status, "✓ 追加しました");
});
