// common/daily-bonus.js — 日々記録(1日3回の記録・3点の面積)の点(b1 ah-55、ah-51 の5。2026-10-22 Takashi「まかせる、すすめて」)。
// scores.score は書き換えない。画面の表示と週の点(week-score.js の dailyScoreSum)で数えるときだけ足す(仮決め Q1)。
//  - 記録点: trips の home・station・office が1つあるごとに recordPoints 点、最大 recordMax 点(仮決め Q2)
//  - 面積点: areaKm2 ÷ areaFullKm2 × areaMax、上限 areaMax 点。小数1けたで丸める(仮決め Q3)
// 重みの既定値はここ1か所。Firestore の scoreConfig/weights があれば、ある欄だけ上書きする(置き場の Rules は ah-56)。

export const DEFAULT_BONUS_WEIGHTS = { recordPoints: 2, recordMax: 6, areaFullKm2: 2, areaMax: 3 };
const TRIP_SLOTS = ["home", "station", "office"];

const round1 = (x) => Math.round(x * 10) / 10;

export function mergeWeights(over) {
  const w = { ...DEFAULT_BONUS_WEIGHTS };
  for (const k of Object.keys(w)) {
    const v = over && Number(over[k]);
    if (Number.isFinite(v) && v >= 0 && over[k] !== null && over[k] !== "") w[k] = v;
  }
  return w;
}

// doc は scores/{日付} の中身。返すのは { record, area, total }
export function dailyBonus(doc, weights = DEFAULT_BONUS_WEIGHTS) {
  const w = mergeWeights(weights);
  const trips = (doc && doc.trips) || {};
  const n = TRIP_SLOTS.filter((s) => trips[s]).length;
  const record = Math.min(n * w.recordPoints, w.recordMax);
  const km2 = Number(doc && doc.areaKm2);
  const area = Number.isFinite(km2) && km2 > 0 && w.areaFullKm2 > 0
    ? round1(Math.min((km2 / w.areaFullKm2) * w.areaMax, w.areaMax))
    : 0;
  return { record, area, total: round1(record + area) };
}

// 「スコア 98 ＋記録 6 ＋面積 1.5」。足す分が無ければ空
export function bonusText(score, b) {
  if (!b || !b.total) return "";
  const parts = [`スコア ${score}`];
  if (b.record) parts.push(`＋記録 ${b.record}`);
  if (b.area) parts.push(`＋面積 ${b.area}`);
  return parts.join(" ");
}

// 画面の欄(m1「重みを変える」)の文字を、scoreConfig/weights に書く形にする(b1 ah-56 の4)。
// Rules と同じく 0〜100 の数だけ。空の欄は書かない。だめな欄があれば { error } を返す
export const WEIGHT_LABELS = { recordPoints: "記録1回の点", recordMax: "記録の上限", areaFullKm2: "満点の面積 km²", areaMax: "面積の上限" };
export function parseWeightInputs(inputs) {
  const out = {};
  for (const k of Object.keys(DEFAULT_BONUS_WEIGHTS)) {
    const s = String((inputs && inputs[k]) ?? "").trim();
    if (s === "") continue;
    const v = Number(s);
    if (!Number.isFinite(v) || v < 0 || v > 100) return { error: `${WEIGHT_LABELS[k]}は 0〜100 の数にしてください` };
    out[k] = v;
  }
  return { weights: out };
}

// ---- 読み込み(ブラウザ)。scoreConfig/weights が無い・読めないときは既定値 ----
let weightsPromise = null;

// 書くのは Takashi 本人のみ(Rules の isTakashi)。merge なので、空にした欄は前の値のまま
export async function saveBonusWeights(weights) {
  const [{ doc, setDoc }, { db, ensureFirebaseLogin }] = await Promise.all([
    import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js"), import("./firebase.js")]);
  await ensureFirebaseLogin();
  await setDoc(doc(db, "scoreConfig", "weights"), { ...weights, at: new Date().toISOString(), by: "takashi" }, { merge: true });
  weightsPromise = null; // 次の loadBonusWeights で読み直す
  return loadBonusWeights();
}

export function loadBonusWeights() {
  if (!weightsPromise) {
    weightsPromise = (async () => {
      try {
        const [{ doc, getDoc }, { db, ensureReadLogin, guardRead }] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js"), import("./firebase.js")]);
        await ensureReadLogin();
        const snap = await guardRead(() => getDoc(doc(db, "scoreConfig", "weights")));
        return mergeWeights(snap.exists() ? snap.data() : null);
      } catch (e) {
        return { ...DEFAULT_BONUS_WEIGHTS };
      }
    })();
  }
  return weightsPromise;
}
