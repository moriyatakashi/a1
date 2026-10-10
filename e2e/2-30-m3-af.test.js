// ab-161(2026-10-10 すま): m3 の書き先を af(「ほぼba」、Firestore の afThreads)に切り替えた。
// 書く(番号は _meta/af_seq と同じトランザクション)・開いているものを読む・済みにする・note を足す。
// af の Rules がまだ反映されていない(書けない)うちは、今までどおり ba(Azure)に書く。Firestore はスタブ。
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

const AF = {
  a1: { title: "前からあるメモ", body: "本文", tags: ["気づき"], done: false, by: "takashi", createdAt: "2026-10-10T01:00:00.000Z", noteMeta: [], seq: 1 },
  a2: { title: "済んだメモ", body: "", tags: [], done: true, by: "takashi", createdAt: "2026-10-10T02:00:00.000Z", noteMeta: [], seq: 2 },
};

async function openM3({ denyAf = false } = {}, act) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    const baPosts = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "足したnote" : undefined));
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    await page.route(`${API_BASE}/**`, (route) => {
      const req = route.request();
      if (req.url().endsWith("/session")) {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ sessionToken: "session:testid.testsig" }) });
      }
      if (req.method() === "POST" && req.url().endsWith("/ba")) {
        baPosts.push(JSON.parse(req.postData()));
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ seq: 999 }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    if (denyAf) await page.addInitScript(() => { window.__fsDenyWrite = ["afThreads", "_meta"]; window.__fsDenyRead = ["afThreads"]; window.__fsCredentialFails = true; });
    await routeFirebaseStub(page, {}, { afThreads: denyAf ? {} : AF, _meta: denyAf ? {} : { af_seq: { value: 2 } } });
    await page.goto(`http://localhost:${server.address().port}/src/m3/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForFunction(() => !/読み込み中/.test(document.getElementById("afList").textContent));
    const out = await act(page);
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    return { ...out, writes, baPosts, errors };
  } finally {
    await browser.close();
    server.close();
  }
}

test("m3: 開いている af だけが一覧に出る(済みは出ない)", async () => {
  const { list, errors } = await openM3({}, async (page) => ({ list: await page.textContent("#afList") }));
  assert.match(list, /af-1/);
  assert.match(list, /前からあるメモ/);
  assert.doesNotMatch(list, /済んだメモ/);
  assert.deepEqual(errors, []);
});

test("m3: 追加すると af に書き、番号はカウンタの次(af-3)。ba には書かない", async () => {
  const { result, list, writes, baPosts } = await openM3({}, async (page) => {
    await page.fill("#newTitle", "新しいメモ");
    await page.fill("#newTags", "#設計 #スマホ");
    await page.fill("#newBody", "中身");
    await page.click("#btnAddThread");
    await page.waitForFunction(() => /追加しました|ba に書きました/.test(document.getElementById("postResult").textContent));
    await page.waitForFunction(() => /新しいメモ/.test(document.getElementById("afList").textContent));
    return { result: await page.textContent("#postResult"), list: await page.textContent("#afList") };
  });
  assert.match(result, /追加しました: af-3/);
  const t = writes.find((w) => w.col === "afThreads");
  assert.equal(t.title, "新しいメモ");
  assert.equal(t.seq, 3);
  assert.equal(t.by, "takashi");
  assert.equal(t.done, false);
  assert.deepEqual(t.tags, ["気づき", "設計", "スマホ"]);
  assert.deepEqual(writes.find((w) => w.col === "_meta"), { col: "_meta", id: "af_seq", value: 3 });
  assert.equal(baPosts.length, 0);
  assert.match(list, /af-3/);
});

test("m3: 済みにすると done が立ち、一覧から消える", async () => {
  const { list, writes } = await openM3({}, async (page) => {
    await page.click('.af-item[data-id="a1"] button:has-text("済みにする")');
    await page.waitForFunction(() => !/前からあるメモ/.test(document.getElementById("afList").textContent));
    return { list: await page.textContent("#afList") };
  });
  const w = writes.find((x) => x.col === "afThreads" && x.id === "a1");
  assert.equal(w.done, true);
  assert.equal(w.doneBy, "takashi");
  assert.match(list, /開いているものはありません/);
});

test("m3: note を足すと notes に1件と noteMeta に印", async () => {
  const { writes } = await openM3({}, async (page) => {
    await page.click('.af-item[data-id="a1"] button:has-text("note を足す")');
    await page.waitForFunction(() => /note 1/.test(document.getElementById("afList").textContent));
    return {};
  });
  const note = writes.find((x) => x.col === "afThreads/a1/notes");
  assert.equal(note.body, "足したnote");
  assert.equal(note.by, "takashi");
  assert.ok(writes.some((x) => x.col === "afThreads" && x.id === "a1" && x.noteMeta));
});

test("m3: af の Rules がまだで書けないときは、今までどおり ba に書く", async () => {
  const { result, list, baPosts, errors } = await openM3({ denyAf: true }, async (page) => {
    const list = await page.textContent("#afList");
    await page.fill("#newTitle", "逃げ道のメモ");
    await page.click("#btnAddThread");
    await page.waitForFunction(() => /追加しました|ba に書きました/.test(document.getElementById("postResult").textContent));
    return { result: await page.textContent("#postResult"), list };
  });
  assert.match(result, /ba に書きました: ba-999/);
  assert.equal(baPosts.length, 1);
  assert.equal(baPosts[0].type, "new");
  assert.equal(baPosts[0].title, "逃げ道のメモ");
  assert.match(list, /まだ読めません/);
  assert.deepEqual(errors, []);
});
