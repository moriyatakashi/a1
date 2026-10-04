// board.js — m7 地図すごろく(ab-44、2026-10-04 Takashi「桃鉄みたいな地図ゲーム、めがありみたいにコントローラありき、
// 細部は決めてない、整理したいし、なんかためしたい」)の盤と進め方。画面を持たない(テストできるように)。
// お試しの決め: 関西の駅34個を線路でつないだ盤、Takashi と家人3人(CPU)、サイコロで進んで目的地を目指す。
// 駅は3種類: 物件駅(物件を買える)・青(お金が増える)・赤(減る)。3月の終わりに決算(物件の収益)。
// 遊ぶ長さは年数で決める(1年=12か月、全員が1回ずつ動くと1か月)。

// [id, 名前, 緯度, 経度, 種類]
export const STATIONS = [
  ["osaka", "大阪", 34.702, 135.496, "prop"],
  ["shinosaka", "新大阪", 34.733, 135.500, "blue"],
  ["kyoto", "京都", 34.985, 135.758, "prop"],
  ["sannomiya", "三ノ宮", 34.695, 135.195, "prop"],
  ["nara", "奈良", 34.681, 135.820, "prop"],
  ["wakayama", "和歌山", 34.232, 135.191, "prop"],
  ["otsu", "大津", 35.003, 135.865, "prop"],
  ["himeji", "姫路", 34.827, 134.691, "prop"],
  ["akashi", "明石", 34.649, 134.993, "blue"],
  ["amagasaki", "尼崎", 34.718, 135.416, "red"],
  ["takatsuki", "高槻", 34.851, 135.618, "blue"],
  ["kusatsu", "草津", 35.022, 135.960, "blue"],
  ["hikone", "彦根", 35.272, 136.259, "prop"],
  ["maibara", "米原", 35.315, 136.290, "blue"],
  ["tennoji", "天王寺", 34.646, 135.514, "prop"],
  ["sakai", "堺", 34.581, 135.480, "red"],
  ["kishiwada", "岸和田", 34.461, 135.371, "blue"],
  ["kix", "関西空港", 34.432, 135.244, "prop"],
  ["takarazuka", "宝塚", 34.811, 135.344, "prop"],
  ["sanda", "三田", 34.888, 135.226, "red"],
  ["fukuchiyama", "福知山", 35.296, 135.126, "prop"],
  ["maizuru", "舞鶴", 35.468, 135.395, "prop"],
  ["kameoka", "亀岡", 35.016, 135.574, "blue"],
  ["yagi", "大和八木", 34.510, 135.794, "blue"],
  ["yoshino", "吉野", 34.367, 135.857, "prop"],
  ["tanabe", "紀伊田辺", 33.735, 135.376, "blue"],
  ["shirahama", "白浜", 33.666, 135.357, "prop"],
  ["gobo", "御坊", 33.891, 135.152, "red"],
  ["omihachiman", "近江八幡", 35.130, 136.098, "blue"],
  ["kakogawa", "加古川", 34.769, 134.829, "red"],
  ["sasayamaguchi", "篠山口", 35.058, 135.177, "blue"],
  ["uji", "宇治", 34.894, 135.807, "blue"],
  ["oji", "王寺", 34.597, 135.705, "red"],
  ["tsuruga", "敦賀", 35.645, 136.076, "prop"],
].map(([id, name, lat, lng, kind]) => ({ id, name, lat, lng, kind }));

// 線路(だいたい実際の路線どおり)
export const LINES = [
  ["shinosaka", "osaka"], ["osaka", "amagasaki"], ["amagasaki", "sannomiya"], ["amagasaki", "takarazuka"],
  ["takarazuka", "sanda"], ["sanda", "sasayamaguchi"], ["sasayamaguchi", "fukuchiyama"], ["fukuchiyama", "maizuru"],
  ["maizuru", "tsuruga"], ["tsuruga", "maibara"], ["maibara", "hikone"], ["hikone", "omihachiman"],
  ["omihachiman", "kusatsu"], ["kusatsu", "otsu"], ["otsu", "kyoto"], ["kyoto", "kameoka"], ["kameoka", "fukuchiyama"],
  ["kyoto", "takatsuki"], ["takatsuki", "shinosaka"], ["kyoto", "uji"], ["uji", "nara"], ["nara", "oji"],
  ["oji", "tennoji"], ["tennoji", "osaka"], ["tennoji", "sakai"], ["sakai", "kishiwada"], ["kishiwada", "kix"],
  ["kishiwada", "wakayama"], ["wakayama", "gobo"], ["gobo", "tanabe"], ["tanabe", "shirahama"], ["oji", "yagi"],
  ["nara", "yagi"], ["yagi", "yoshino"], ["sannomiya", "akashi"], ["akashi", "kakogawa"], ["kakogawa", "himeji"],
  ["himeji", "fukuchiyama"],
];

// 物件 [名前, 値段(万円), 収益率(%)]。決算でもらえるのは 値段×収益率。
export const PROPS = {
  osaka: [["たこ焼き屋", 100, 40], ["串カツ屋", 300, 30], ["百貨店", 2000, 8]],
  kyoto: [["八ツ橋屋", 200, 35], ["寺社みやげ", 500, 20], ["旅館", 1000, 15]],
  sannomiya: [["洋菓子店", 300, 30], ["中華街の店", 600, 20]],
  nara: [["鹿せんべい屋", 50, 80], ["柿の葉寿司屋", 200, 30]],
  wakayama: [["梅干し屋", 300, 25], ["みかん農園", 500, 20]],
  otsu: [["湖の遊覧船", 800, 15]],
  himeji: [["おでん屋", 200, 30], ["革工房", 600, 15]],
  hikone: [["城の土産屋", 300, 25]],
  tennoji: [["串焼き屋", 150, 40], ["動物園の売店", 400, 20]],
  kix: [["免税店", 3000, 6]],
  takarazuka: [["歌劇グッズ店", 500, 20]],
  fukuchiyama: [["鉄道の宿", 300, 25]],
  maizuru: [["肉じゃが屋", 150, 40], ["港の倉庫", 800, 12]],
  yoshino: [["葛餅屋", 200, 30], ["桜の茶屋", 400, 20]],
  shirahama: [["パンダ饅頭屋", 200, 35], ["温泉宿", 1200, 12]],
  tsuruga: [["海鮮市場", 600, 18]],
};

// 遊ぶ人。お試しは Takashi(人)と家人3人(CPU)。
export const PLAYERS = [
  { name: "Takashi", mark: "た", color: "#e8743b", cpu: false },
  { name: "すま", mark: "す", color: "#3b7dd8", cpu: true },
  { name: "礼文", mark: "礼", color: "#2a8f6f", cpu: true },
  { name: "天売", mark: "天", color: "#a05ac8", cpu: true },
];

export const START = "osaka";
export const START_MONEY = 1000;
export const byId = new Map(STATIONS.map((s) => [s.id, s]));

export function adjacency() {
  const adj = new Map(STATIONS.map((s) => [s.id, []]));
  for (const [a, b] of LINES) { adj.get(a).push(b); adj.get(b).push(a); }
  return adj;
}
const ADJ = adjacency();

// ある駅から各駅までの駅数(幅優先)。
export function hops(from) {
  const d = new Map([[from, 0]]), q = [from];
  while (q.length) {
    const x = q.shift();
    for (const y of ADJ.get(x)) if (!d.has(y)) { d.set(y, d.get(x) + 1); q.push(y); }
  }
  return d;
}

// 目的地を決める。今いる人たち(とくに着いた人)から近すぎない駅。賞金は前の目的地からの駅数で決まる。
function pickDest(g, near) {
  const d = hops(near);
  const far = STATIONS.filter((s) => d.get(s.id) >= 4 && s.id !== g.dest);
  const s = far[Math.floor(g.rng() * far.length)];
  g.dest = s.id;
  g.reward = 1000 + 200 * d.get(s.id);
  g.destHops = hops(s.id);
}

export function newGame({ years = 1, rng = Math.random, players = PLAYERS } = {}) {
  const g = {
    rng, years, year: 1, month: 4, turn: 0, phase: "roll", steps: 0, dice: 0, msg: "",
    players: players.map((p) => ({ ...p, money: START_MONEY, at: START, from: null, owned: [] })),
    owner: {}, // "駅id/番号" → 人の番号
    dest: null, reward: 0, destHops: null, buyCursor: 0, log: [],
  };
  pickDest(g, START);
  g.msg = `目的地は ${byId.get(g.dest).name}(賞金 ${yen(g.reward)})`;
  return g;
}

export const yen = (n) => (n < 0 ? "-" : "") + (Math.abs(n) >= 10000
  ? `${Math.floor(Math.abs(n) / 10000)}億${Math.abs(n) % 10000 ? (Math.abs(n) % 10000) + "万" : ""}円`
  : `${Math.abs(n)}万円`);
export const current = (g) => g.players[g.turn];

export function roll(g, n = 1 + Math.floor(g.rng() * 6)) {
  if (g.phase !== "roll") return;
  g.dice = n;
  g.steps = n;
  g.phase = "move";
}

// 次に進める駅。来た道は戻らない(行き止まりなら戻る)。
export function options(g) {
  const p = current(g);
  const next = ADJ.get(p.at).filter((x) => x !== p.from);
  return next.length ? next : ADJ.get(p.at);
}

// 1駅進む。歩数がなくなったら止まった駅のことをする。途中でも目的地に着いたらそこで止まる(桃鉄と同じ)。
export function step(g, to) {
  if (g.phase !== "move" || !options(g).includes(to)) return;
  const p = current(g);
  p.from = p.at;
  p.at = to;
  g.steps--;
  if (to === g.dest || g.steps === 0) land(g);
}

export function unownedProps(g, at = current(g).at) {
  return (PROPS[at] || []).map(([name, price, rate], i) => ({ key: `${at}/${i}`, name, price, rate }))
    .filter((x) => g.owner[x.key] === undefined);
}

function land(g) {
  const p = current(g), s = byId.get(p.at);
  g.steps = 0;
  if (p.at === g.dest) {
    p.money += g.reward;
    const was = s.name, got = g.reward;
    pickDest(g, p.at);
    g.msg = `${p.name}が ${was} に一番乗り! 賞金 ${yen(got)}。次の目的地は ${byId.get(g.dest).name}(賞金 ${yen(g.reward)})`;
    g.phase = "done";
    return;
  }
  if (s.kind === "blue") {
    const n = (1 + Math.floor(g.rng() * 5)) * 100;
    p.money += n;
    g.msg = `${p.name}: ${s.name}(青)で ${yen(n)} もらった`;
    g.phase = "done";
  } else if (s.kind === "red") {
    const n = (1 + Math.floor(g.rng() * 4)) * 100;
    p.money -= n;
    g.msg = `${p.name}: ${s.name}(赤)で ${yen(n)} はらった`;
    g.phase = "done";
  } else {
    const can = unownedProps(g);
    if (can.length) { g.phase = "buy"; g.buyCursor = 0; g.msg = `${p.name}: ${s.name}。物件を買う?`; }
    else { g.phase = "done"; g.msg = `${p.name}: ${s.name}(物件は売り切れ)`; }
  }
}

// 物件を買う(key が null なら買わない)。
export function buy(g, key) {
  if (g.phase !== "buy") return;
  const p = current(g);
  const x = key && unownedProps(g).find((y) => y.key === key);
  if (x && p.money >= x.price) {
    p.money -= x.price;
    p.owned.push(x.key);
    g.owner[x.key] = g.turn;
    g.msg = `${p.name}が ${x.name} を買った(${yen(x.price)}、収益 ${x.rate}%)`;
  } else g.msg = `${p.name}は買わなかった`;
  g.phase = "done";
}

export const propValue = (key) => { const [at, i] = key.split("/"); return PROPS[at][Number(i)][1]; };
const propIncome = (key) => { const [at, i] = key.split("/"); const [, price, rate] = PROPS[at][Number(i)]; return Math.round(price * rate / 100); };
export const assets = (p) => p.money + p.owned.reduce((s, k) => s + propValue(k), 0);

// 番を終える。全員動いたら次の月。3月が終わったら決算、最後の年なら終わり。
export function endTurn(g) {
  if (g.phase !== "done") return;
  g.turn = (g.turn + 1) % g.players.length;
  g.phase = "roll";
  if (g.turn !== 0) return;
  if (g.month === 3) {
    const inc = g.players.map((p) => p.owned.reduce((s, k) => s + propIncome(k), 0));
    g.players.forEach((p, i) => { p.money += inc[i]; });
    g.msg = `${g.year}年目の決算: ` + g.players.map((p, i) => `${p.name} +${yen(inc[i])}`).join("・");
    if (g.year >= g.years) { g.phase = "over"; return; }
    g.year++;
  }
  g.month = g.month % 12 + 1;
}

export const ranking = (g) => g.players.map((p, i) => ({ i, name: p.name, assets: assets(p) })).sort((a, b) => b.assets - a.assets);

// CPU: 分かれ道では目的地に近い方(同じなら最初)。物件は買える中でいちばん高いもの。
export function cpuStep(g) {
  return options(g).reduce((best, x) => (g.destHops.get(x) < g.destHops.get(best) ? x : best));
}
export function cpuBuy(g) {
  const p = current(g);
  const can = unownedProps(g).filter((x) => x.price <= p.money).sort((a, b) => b.price - a.price);
  return can.length ? can[0].key : null;
}
