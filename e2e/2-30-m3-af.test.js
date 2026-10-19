// ab-161(2026-10-10 すま): m3 の書き先を af(「ほぼba」、Firestore の afThreads)に切り替えた。
// 書く(番号は _meta/af_seq と同じトランザクション)・開いているものを読む・済みにする・note を足す。
// 2026-10-10(ab-166 ②): ba への逃げ道は外した。af に書けないときは失敗を出し、ba には書かない。Firestore はスタブ。
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

const AF = {
  a1: { title: "前からあるメモ", body: "本文", tags: ["気づき"], done: false, by: "takashi", createdAt: "2026-10-10T01:00:00.000Z", noteMeta: [], seq: 1 },
  a2: { title: "済んだメモ", body: "", tags: [], done: true, by: "takashi", createdAt: "2026-10-10T02:00:00.000Z", noteMeta: [], seq: 2 },
};

// ag(ab-185): 家人のやったあと。m3 は読むだけ・新しい順
const AG = {
  g1: { title: "古いまとめ", body: "■まとめ: 一つ目", related: [], by: "claude-mobile", createdAt: "2026-10-16T12:00:00.000Z", noteMeta: [], seq: 1 },
  g2: { title: "新しいまとめ", body: "", related: ["ab-167"], by: "claude-pc", createdAt: "2026-10-18T01:00:00.000Z", noteMeta: [], seq: 2 },
};

// ah(b1 ab-193): 作業票。m3 は読むだけ・済は出さない・次が Takashi の票が先頭・印が止まった票は落ちた
const AH = {
  h1: { title: "礼文の作業", state: "作業中", next: "rebun", holder: "rebun", owner: "rebun", beatAt: "2026-10-01T00:00:00.000Z", seq: 1 },
  h2: { title: "Takashi に頼む", state: "渡し先待ち", next: "takashi", holder: "", owner: "rebun", seq: 2 },
  h3: { title: "済んだ票", state: "済", next: "", holder: "", owner: "rebun", seq: 3 },
};

async function openM3({ denyAf = false } = {}, act) {
  const server = await serveStatic();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage()
    await useTestOwner(page);
    const errors = [];
    const baPosts = [];
    const dialogs = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (r.url().includes("azurewebsites.net")) baPosts.push(r.url()); }); // ab-182: 旧 ba(Azure)へは行かない
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(d.type() === "prompt" ? "足したnote" : undefined); });
    await page.route("https://accounts.google.com/gsi/client", (route) => route.fulfill({ contentType: "text/javascript", body: "" }));
    if (denyAf) await page.addInitScript(() => { window.__fsDenyWrite = ["afThreads", "_meta"]; window.__fsDenyRead = ["afThreads"]; window.__fsCredentialFails = true; });
    await routeFirebaseStub(page, {}, { afThreads: denyAf ? {} : AF, agThreads: denyAf ? {} : AG, ahThreads: denyAf ? {} : AH, _meta: denyAf ? {} : { af_seq: { value: 2 } } });
    await page.goto(`http://localhost:${server.address().port}/src/m3/`);
    await page.evaluate((cred) => window.handleCredentialResponse({ credential: cred }), FAKE_GOOGLE_CREDENTIAL);
    await page.waitForFunction(() => !/読み込み中/.test(document.getElementById("afList").textContent));
    const out = await act(page);
    const writes = await page.evaluate(() => window.__fsOtherWrites || []);
    return { ...out, writes, baPosts, errors, dialogs };
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

test("m3: ag は新しい順に読むだけで出る(ボタンなし)", async () => {
  const { ag, buttons } = await openM3({}, async (page) => {
    await page.waitForFunction(() => !/読み込み中/.test(document.getElementById("agList").textContent));
    return { ag: await page.textContent("#agList"), buttons: await page.locator("#agList button").count() };
  });
  assert.ok(ag.indexOf("新しいまとめ") < ag.indexOf("古いまとめ"), ag);
  assert.match(ag, /ag-2 · 2026-10-18 · claude-pc · 関連 ab-167/);
  assert.equal(buttons, 0);
});

test("m3: ah は済んでいない票を、次が Takashi の票から読むだけで出す", async () => {
  const { ah, buttons } = await openM3({}, async (page) => {
    await page.waitForFunction(() => !/読み込み中/.test(document.getElementById("ahList").textContent));
    return { ah: await page.textContent("#ahList"), buttons: await page.locator("#ahList button").count() };
  });
  assert.ok(ah.indexOf("Takashi に頼む") < ah.indexOf("礼文の作業"), ah);
  assert.match(ah, /ah-2 · 渡し先待ち · 次:Takashi/);
  assert.match(ah, /ah-1 · 落ちた · 次:礼文 · 握り:礼文/);
  assert.doesNotMatch(ah, /済んだ票/);
  assert.match(ah, /たかしさん待ち 1 · 窓を開けば進む 0 · 礼文が進めている 1/); // ah-37
  assert.equal(buttons, 0);
});

// ah-38: 礼文に絞った見え方。印が止まった作業中は目立たせる・回っている票・済んだ票
test("m3: 礼文の票に、握っている票(印が古い印つき)・回っている票・済んだ票が読むだけで出る", async () => {
  const { rb, buttons, stale, first } = await openM3({}, async (page) => {
    await page.waitForFunction(() => /最近済んだ票/.test(document.getElementById("rebunAh").textContent));
    return { rb: await page.textContent("#rebunAh"), buttons: await page.locator("#rebunAh button").count(), stale: await page.locator("#rebunAh .rb-stale").count(),
      first: await page.evaluate(() => [...document.getElementById("content").children].find((c) => c.id)?.id) };
  });
  assert.equal(first, "rebunAh"); // ah-40: ログイン後の中身のいちばん上(フォームより前)
  assert.match(rb, /^たかしさん待ち 1 · 窓を開けば進む 0 · 礼文が進めている 1/); // ah-40: 3つの数も頭に
  assert.match(rb, /ah-1 · 落ちた · 握って - · 最後の印 .*止まっているかも/);
  assert.match(rb, /ah-2 · 渡し先待ち · 次:Takashi/);
  assert.match(rb, /ah-3 · 済/);
  assert.ok(stale >= 1);
  assert.equal(buttons, 0);
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

test("m3: af に書けないときは失敗を出し、ba には書かない(ab-166 ②)", async () => {
  const { list, baPosts, errors, dialogs } = await openM3({ denyAf: true }, async (page) => {
    const list = await page.textContent("#afList");
    await page.fill("#newTitle", "書けないメモ");
    await page.click("#btnAddThread");
    await page.waitForFunction(() => !document.getElementById("btnAddThread").disabled);
    await page.waitForTimeout(200);
    return { list };
  });
  assert.equal(baPosts.length, 0);
  assert.ok(dialogs.some((m) => /af に書けませんでした/.test(m)), dialogs.join(" / "));
  assert.match(list, /まだ読めません/);
  assert.deepEqual(errors, []);
});
