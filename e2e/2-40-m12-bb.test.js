// 2026-11-07 Takashi: メモ2(m12)。bb に書く・開いているものを読む・済みにする・note を足す。種類はメモに固定。Firestore はスタブ
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFirebaseStub } from "./firebase-stub.js";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listenSafe } from "./listen-safe.js";
import { FAKE_GOOGLE_CREDENTIAL, useTestOwner } from "./test-owner.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
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

const BB = {
  b1: { title: "前からあるメモ", body: "本文", kind: "メモ", done: false, by: "claude-pi", createdAt: "2026-11-07T01:00:00.000Z", noteMeta: [], seq: 3 },
  b2: { title: "済んだメモ", body: "", kind: "メモ", done: true, by: "claude-pc", createdAt: "2026-11-07T02:00:00.000Z", noteMeta: [], seq: 2 },
};

async function openM12({ deny = false } = {}, act) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await useTestOwner(page);
    const errors = [];
    const dialogs = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(d.type() === "prompt" ? "足したnote" : undefined); });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    if (deny) await page.addInitScript(() => { window.__fsDenyWrite = ["bbThreads", "_meta"]; });
    await routeFirebaseStub(page, {}, { bbThreads: BB, _meta: { bb_seq: { value: 3 } } });
    await page.goto(`http://localhost:${server.address().port}/src/m12/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForFunction(() => !/読み込み中/.test(document.getElementById("bbList").textContent));
    const out = await act(page);
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    return { ...out, writes, errors, dialogs };
  } finally {
    await browser.close();
    server.close();
  }
}

test("m12: 開いている bb だけが一覧に出る", async () => {
  const { list, errors } = await openM12({}, async (page) => ({ list: await page.textContent("#bbList") }));
  assert.match(list, /bb-3/);
  assert.match(list, /前からあるメモ/);
  assert.match(list, /claude-pi/);
  assert.doesNotMatch(list, /済んだメモ/);
  assert.deepEqual(errors, []);
});

test("m12: 追加すると bb に書き、番号はカウンタの次。種類はメモ、af には書かない", async () => {
  const { result, list, writes, errors } = await openM12({}, async (page) => {
    await page.fill("#newTitle", "山行記: 新しいメモ");
    await page.fill("#newBody", "中身");
    await page.click("#btnAdd");
    await page.waitForFunction(() => /追加しました/.test(document.getElementById("postResult").textContent));
    await page.waitForFunction(() => /新しいメモ/.test(document.getElementById("bbList").textContent));
    return { result: await page.textContent("#postResult"), list: await page.textContent("#bbList") };
  });
  assert.match(result, /bb-4/);
  assert.match(list, /山行記: 新しいメモ/);
  const t = writes.find((w) => w.col === "bbThreads");
  assert.equal(t.title, "山行記: 新しいメモ");
  assert.equal(t.body, "中身");
  assert.equal(t.kind, "メモ");
  assert.equal(t.by, "takashi");
  assert.equal(t.done, false);
  assert.equal(t.seq, 4);
  assert.deepEqual(writes.find((w) => w.col === "_meta"), { col: "_meta", id: "bb_seq", value: 4 });
  assert.ok(!writes.some((w) => w.col === "afThreads"));
  assert.deepEqual(errors, []);
});

test("m12: 済みにすると done が立ち、一覧から消える", async () => {
  const { list, writes } = await openM12({}, async (page) => {
    await page.click('.af-item[data-id="b1"] button:has-text("済みにする")');
    await page.waitForFunction(() => !/前からあるメモ/.test(document.getElementById("bbList").textContent));
    return { list: await page.textContent("#bbList") };
  });
  assert.doesNotMatch(list, /前からあるメモ/);
  const w = writes.find((x) => x.col === "bbThreads" && x.id === "b1");
  assert.equal(w.done, true);
  assert.equal(w.doneBy, "takashi");
});

test("m12: note を足すと notes に1件と noteMeta に印", async () => {
  const { writes } = await openM12({}, async (page) => {
    await page.click('.af-item[data-id="b1"] button:has-text("note を足す")');
    await page.waitForFunction(() => /note 1/.test(document.getElementById("bbList").textContent));
    return {};
  });
  const note = writes.find((x) => x.col === "bbThreads/b1/notes");
  assert.equal(note.body, "足したnote");
  assert.equal(note.by, "takashi");
  assert.ok(writes.some((x) => x.col === "bbThreads" && x.id === "b1" && x.noteMeta));
});

test("m12: 書けないときは失敗を出す", async () => {
  const { dialogs, result } = await openM12({ deny: true }, async (page) => {
    await page.fill("#newTitle", "書けないメモ");
    await page.click("#btnAdd");
    await page.waitForFunction(() => !document.getElementById("btnAdd").disabled);
    return { result: await page.textContent("#postResult") };
  });
  assert.doesNotMatch(result, /追加しました/);
  assert.ok(dialogs.some((d) => /bb に書けませんでした/.test(d)), dialogs.join("|"));
});
