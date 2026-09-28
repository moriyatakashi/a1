// g1(NESエミュレータ)のGamePad対応(ba-52 Phase1/2)のe2e。ab-12、ba-52分解の手順6。
// 実機コントローラーは使えないので navigator.getGamepads をモックし、
// (1) 接続表示が出る (2) ボタン押下/離しが cpu.joy1 に反映される ことを確かめる。
// cpu は app.js のモジュール内変数で外から見えないため、同じURLの cpu.js を import して
// (モジュールは1つだけ読み込まれるので app.js と同じ CPU クラスになる) step を包み、動いている cpu を捕まえる。
// 割当設定の保存→再読込での復元(手順6の(2))は、すまの手順2〜5(設定UI・保存)が入ってから足す。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".nes": "application/octet-stream" };

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

// Standard Gamepad(17ボタン)のモック。window.__padPressed の添字が押されている扱い。
function mockGamepads() {
  window.__padPressed = new Set();
  const pad = {
    id: "Mock Pad (e2e)",
    index: 0,
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    get buttons() {
      return Array.from({ length: 17 }, (_, i) => {
        const pressed = window.__padPressed.has(i);
        return { pressed, touched: pressed, value: pressed ? 1 : 0 };
      });
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

async function startRomAndCatchCpu(page) {
  await page.evaluate(async () => {
    const { CPU } = await import("./cpu.js");
    const step = CPU.prototype.step;
    CPU.prototype.step = function () { window.__cpu = this; return step.call(this); };
  });
  await page.click('.rom-btn[data-rom="rom/hello_nes4.nes"]');
  await page.waitForFunction(() => window.__cpu, null, { timeout: 5000 });
}

async function setPressed(page, buttons) {
  // pollGamepad は毎フレーム(requestAnimationFrame)呼ばれるので、時間でなくフレームを数えて待つ
  // (固定の150ms待ちは、ほかのe2eと並んで重いときに足りず落ちたことがある)
  await page.evaluate(async (b) => {
    window.__padPressed = new Set(b);
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(r));
  }, buttons);
}

async function pressAndReadJoy1(page, buttons) {
  await setPressed(page, buttons);
  return page.evaluate(() => Array.from(window.__cpu.joy1));
}

test("g1: モックしたGamePadの押下・離しが cpu.joy1 に反映される", async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.addInitScript(mockGamepads);

    await page.goto(`http://localhost:${port}/src/g/g1/`);
    const status = await page.textContent("#gamepadStatus");
    assert.ok(status.includes("Mock Pad (e2e)"), `接続表示にモックのidが出ていない: ${status}`);

    await startRomAndCatchCpu(page);
    const joy1After = (buttons) => pressAndReadJoy1(page, buttons);

    // joy1の並び: 0=A 1=B 2=Select 3=Start 4=Up 5=Down 6=Left 7=Right(app.js GAMEPAD_PROFILES の Standard)
    assert.deepEqual(await joy1After([1]), [1, 0, 0, 0, 0, 0, 0, 0], "button1 → NES A");
    assert.deepEqual(await joy1After([0, 9, 15]), [0, 1, 0, 1, 0, 0, 0, 1], "button0/9/15 → B/Start/Right");
    assert.deepEqual(await joy1After([8, 12, 13, 14]), [0, 0, 1, 0, 1, 1, 1, 0], "button8/12/13/14 → Select/Up/Down/Left");
    assert.deepEqual(await joy1After([]), [0, 0, 0, 0, 0, 0, 0, 0], "全部離すと0に戻る");

    assert.deepEqual(pageErrors, [], `未捕捉の例外が発生した: ${pageErrors.join(", ")}`);
  } finally {
    await browser.close();
    server.close();
  }
});

// ba-52 手順5(すま a1 19ca9b6)の割当設定UI: 割当→保存→再読込で復元、初期に戻すで既定へ。
test("g1: 割当をUIで変えると保存され、再読込しても効き、初期に戻すで既定に戻る", async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch();
  const STORE = "g1.gamepadMap.v1";
  const ID = "Mock Pad (e2e)";
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.addInitScript(mockGamepads);
    await page.goto(`http://localhost:${port}/src/g/g1/`);
    const openConfig = () => page.evaluate(() => { document.getElementById("gamepadConfig").open = true; });

    // NES A(joy1[0])の「割当」を押してから、パッドの button3 を押して離す
    await openConfig();
    await page.click('.gp-assign[data-nes="0"]');
    assert.equal(await page.textContent('.gp-assign[data-nes="0"]'), "待機中…");
    await setPressed(page, [3]);
    await setPressed(page, []);
    const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), STORE);
    assert.equal(saved[ID]?.["3"], 0, `button3→A が保存されていない: ${JSON.stringify(saved)}`);
    assert.equal(saved[ID]?.["1"], undefined, "A の古い割当(button1)が外れていない");

    // 再読込しても保存した割当が効く(button3でA、button1ではAにならない)
    await page.reload();
    await startRomAndCatchCpu(page);
    assert.equal((await pressAndReadJoy1(page, [3]))[0], 1, "再読込後、button3 で A にならない");
    assert.equal((await pressAndReadJoy1(page, [1]))[0], 0, "再読込後も button1 で A になっている");
    assert.deepEqual(await pressAndReadJoy1(page, [0]), [0, 1, 0, 0, 0, 0, 0, 0], "ほかの割当(button0→B)は既定のまま");

    // 初期に戻すと保存が消え、既定(button1→A)に戻る
    await setPressed(page, []);
    await openConfig();
    await page.click("#gpReset");
    const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), STORE);
    assert.equal(after[ID], undefined, "初期に戻したのに保存が残っている");
    assert.equal((await pressAndReadJoy1(page, [1]))[0], 1, "初期に戻したあと button1 で A にならない");
    assert.equal((await pressAndReadJoy1(page, [3]))[0], 0, "初期に戻したあとも button3 で A になっている");

    assert.deepEqual(pageErrors, [], `未捕捉の例外が発生した: ${pageErrors.join(", ")}`);
  } finally {
    await browser.close();
    server.close();
  }
});
