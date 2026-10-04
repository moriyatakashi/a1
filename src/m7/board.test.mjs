// ab-44(2026-10-04): m7 地図すごろくの盤と進め方(board.js)を確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { STATIONS, LINES, PROPS, byId, adjacency, hops, newGame, roll, options, step, buy, endTurn, current, unownedProps, cpuStep, cpuBuy, ranking, yen, START_MONEY } from "./board.js";

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("盤: 線路は実在の駅どうし、全部の駅がつながっている、物件は物件駅だけ", () => {
  for (const [a, b] of LINES) assert.ok(byId.has(a) && byId.has(b), `${a}-${b}`);
  assert.equal(hops("osaka").size, STATIONS.length);
  for (const id of Object.keys(PROPS)) assert.equal(byId.get(id).kind, "prop", id);
  for (const s of STATIONS) if (s.kind === "prop") assert.ok(PROPS[s.id], s.id);
  assert.ok(adjacency().get("kyoto").includes("otsu"));
});

test("目的地: 大阪から4駅以上、賞金は駅数で決まる", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = newGame({ rng: seeded(seed) });
    const d = hops("osaka").get(g.dest);
    assert.ok(d >= 4, g.dest);
    assert.equal(g.reward, 1000 + 200 * d);
  }
});

test("進む: 来た道は戻らない、歩数を使い切ると止まる", () => {
  const g = newGame({ rng: seeded(1) });
  roll(g, 2);
  assert.deepEqual(options(g).sort(), ["amagasaki", "shinosaka", "tennoji"].sort());
  step(g, "shinosaka");
  assert.deepEqual(options(g), ["takatsuki"]); // 大阪へは戻らない
  if (g.dest !== "takatsuki") {
    step(g, "takatsuki");
    assert.equal(g.phase, "done");
    assert.equal(current(g).at, "takatsuki");
  }
});

test("目的地に着くと途中でも止まって賞金、次の目的地が決まる", () => {
  const g = newGame({ rng: seeded(2) });
  g.dest = "kyoto"; g.reward = 1800; g.destHops = hops("kyoto");
  current(g).at = "takatsuki"; current(g).from = "shinosaka";
  roll(g, 5);
  step(g, "kyoto");
  assert.equal(g.phase, "done");
  assert.equal(current(g).money, START_MONEY + 1800);
  assert.notEqual(g.dest, "kyoto");
  assert.match(g.msg, /一番乗り/);
});

test("物件: 買うとお金が減り、もう買えない。お金が足りなければ買えない", () => {
  const g = newGame({ rng: seeded(3) });
  g.dest = "shirahama"; g.destHops = hops("shirahama");
  roll(g, 1);
  step(g, "tennoji");
  assert.equal(g.phase, "buy");
  assert.equal(cpuBuy(g), "tennoji/1"); // 買える中でいちばん高い
  buy(g, "tennoji/1");
  assert.equal(current(g).money, START_MONEY - 400);
  assert.deepEqual(unownedProps(g).map((x) => x.name), ["串焼き屋"]);
  const g2 = newGame({ rng: seeded(3) });
  g2.dest = "shirahama"; g2.destHops = hops("shirahama"); current(g2).money = 10;
  roll(g2, 1); step(g2, "tennoji");
  assert.equal(cpuBuy(g2), null);
  buy(g2, "tennoji/0");
  assert.equal(current(g2).money, 10);
});

test("CPU は目的地に近い方へ進む", () => {
  const g = newGame({ rng: seeded(4) });
  g.dest = "sannomiya"; g.destHops = hops("sannomiya");
  roll(g, 1);
  assert.equal(cpuStep(g), "amagasaki");
});

test("1年遊ぶと、全員12回ずつ動いて決算して終わる。お金が減っても止まらない", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = newGame({ rng: seeded(seed), years: 1 });
    let turns = 0;
    while (g.phase !== "over" && turns < 1000) {
      roll(g);
      while (g.phase === "move") step(g, cpuStep(g));
      if (g.phase === "buy") buy(g, cpuBuy(g));
      endTurn(g);
      turns++;
    }
    assert.equal(g.phase, "over");
    assert.equal(turns, 48);
    assert.match(g.msg, /1年目の決算/);
    assert.equal(ranking(g).length, 4);
  }
});

test("お金の書き方", () => {
  assert.equal(yen(300), "300万円");
  assert.equal(yen(12000), "1億2000万円");
  assert.equal(yen(20000), "2億円");
  assert.equal(yen(-500), "-500万円");
});
