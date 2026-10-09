// visit-store.js — 訪問(Firestore ab01-9f35a の visits/{id})と初訪問・1日に回った分の加点(pointEvents/{id})の読み書き。m2 と a2/x5 で共用。
// ab-53(2026-10-03): 正本は Firestore(Azure の /api/visits・/api/points は書き込み 410、読みは Firestore を返す)。
// 読みは誰でも、書きは Takashi 本人のみ(Rules)。ログインは firebase.js の ensureFirebaseLogin。
import { collection, doc, getDoc, getDocs, getCountFromServer, setDoc, writeBatch, arrayUnion, increment }
  from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { db, ensureFirebaseLogin, ensureReadLogin } from "./firebase.js";
import { roundPointFor, ROUND_RULE } from "./visit-round.js";

// ba-165②(2026-07-29確定、Takashi判断): 初めて行った県・市・町を自動で加点する。
// 粒度は県>市>町の順で粗い方を優先し(同時に複数が初登場でも二重加点しない)、県=high/市=normal/町=low
// (同じ県の別の市を後から訪れても県はもう新規でないので normal 以下に自然に下がる=「経年で易化」)。
// 既訪問かは今までの visits の pref/city/town と文字列が一致するかだけで見る。
// 元は Azure の bp_visits.py にあった判定を、ab-53 でここ(保存する側)へ移した。書くのは Takashi 本人だけなので、
// 判定をページ側に置いても困らない。配点は ScoringRules の初期配点(ba-53)と同じ値。
const GRANULARITY_DIFFICULTY = { pref: "high", city: "normal", town: "low" };
const DIFFICULTY_POINTS = { low: 2, normal: 5, high: 10 };

// ab-97(2026-10-07): visits を開くたびに全件読まない。まとめ文書 digests/visits = {items, count, at} を1件読み、
// visits の件数(COUNT 集計、1,000件ごとに読み取り1回分)と合っていればそれを使う(読み取り2回分で済む)。
// 合わない・無い・読めないときは今までどおり全件読み、Takashi がログイン中ならまとめを作り直す。
// まとめは保存のたびに saveVisit が1件足す。visits は作るだけで直さない・消さないので、件数が合えば中身も合う。
const digestRef = () => doc(db, "digests", "visits");

async function fetchAllVisitDocs() {
  const snap = await getDocs(collection(db, "visits"));
  return snap.docs.map((d) => ({ id: d.id, by: "takashi", ...d.data() }));
}

export async function fetchVisits() {
  await ensureReadLogin(); // ab-162: いずれ読みも本人だけにするので、先にログインしておく(ポップアップは出さない)
  try {
    const [snap, counted] = await Promise.all([getDoc(digestRef()), getCountFromServer(collection(db, "visits"))]);
    const d = snap.exists() ? snap.data() : null;
    const n = counted.data().count;
    if (d && Array.isArray(d.items) && d.items.length === n && d.count === n) {
      return d.items.map((v) => ({ by: "takashi", ...v }));
    }
  } catch (e) {
    console.warn("訪問のまとめを読めなかったので全件読む", e);
  }
  const visits = await fetchAllVisitDocs();
  rebuildDigest(visits);
  return visits;
}

// 全件読んだついでに、ログイン済み(書けるのは Takashi だけ)ならまとめを作り直す。失敗しても読みは止めない。
function rebuildDigest(visits) {
  if (!getAuth().currentUser) return; // ポップアップは出さない。ログイン済みのときだけ(firebase.js が初期化した既定のアプリ)
  // 写しを渡す(呼び出し側が並べ替えたり保存した分を足したりするため)
  setDoc(digestRef(), { items: visits.slice(), count: visits.length, at: new Date().toISOString() })
    .catch((e) => console.warn("訪問のまとめを作り直せなかった", e));
}

// 今までの訪問(visits)に照らして、この訪問で初めて出てきた一番粗い粒度("pref"/"city"/"town")。無ければ null。
export function newVisitGranularity(visits, { pref, city, town }) {
  const isNew = (field, value) => !!value && visits.every((v) => v[field] !== value);
  if (isNew("pref", pref)) return "pref";
  if (isNew("city", city)) return "city";
  if (isNew("town", town)) return "town";
  return null;
}

// 訪問を1件保存する。初訪問なら加点イベントも同じ batch で書く(片方だけ入ることがない)。保存した訪問を返す。
// knownVisits: ページが開いたときに読んだ visits。渡せば初訪問の判定に使い回し、visits を読み直さない(ab-97)。
// 読めていない(null)ときだけここで読む。空配列を「読めなかった」の代わりに渡すと全部が初訪問になるので渡さない。
// 1日に何か所か回ったときの1点(ab-153、visit-round.js)も同じ batch で書く。付いたかどうかは返す値の roundPoint で知らせる
// (画面の一言用。visits には書かない)。
export async function saveVisit({ place, date, time, lat, lng, pref, city, town }, knownVisits = null) {
  await ensureFirebaseLogin();
  const visits = knownVisits || await fetchVisits();
  const granularity = newVisitGranularity(visits, { pref, city, town });
  const now = new Date().toISOString();
  const id = crypto.randomUUID(); // Azure の頃の RowKey と同じ uuid の形
  const visit = {
    place, date: date || "", time: time || "", memo: "",
    pref: pref || "", city: city || "", town: town || "",
    autoPointGranularity: granularity || "", createdAt: now, by: "takashi",
  };
  if (lat != null) visit.lat = Number(lat);
  if (lng != null) visit.lng = Number(lng);
  const round = roundPointFor(visits, { ...visit, createdAt: now });

  const batch = writeBatch(db);
  batch.set(doc(db, "visits", id), visit);
  if (granularity) {
    const label = { pref, city, town }[granularity];
    batch.set(doc(db, "pointEvents", crypto.randomUUID()), {
      axis: "初訪問", points: DIFFICULTY_POINTS[GRANULARITY_DIFFICULTY[granularity]],
      note: `${label}(${granularity})`, period: "week", catalogId: "visit_new",
      createdAt: now, by: "takashi", visitId: id,
    });
  }
  if (round) {
    batch.set(doc(db, "pointEvents", crypto.randomUUID()), {
      axis: "訪問", points: ROUND_RULE.points,
      note: `${visit.date} ${round.count}か所・約${Math.round(round.km)}km・約${Math.round(round.km2)}km²`, period: "week", catalogId: "visit_round",
      createdAt: now, by: "takashi", visitId: id,
    });
  }
  await batch.commit();
  // まとめにも1件足す。訪問とは別に書き、失敗しても保存は止めない(ずれたら読む側が件数で気づいて作り直す)。
  // 待たない(ab-159、2026-10-10): 保存の待ち時間に入れない。大きな1文書の書き換えなので待つと遅く感じる
  setDoc(digestRef(), { items: arrayUnion({ id, ...visit }), count: increment(1), at: now }, { merge: true })
    .catch((e) => console.warn("訪問のまとめに足せなかった", e));
  return round ? { id, ...visit, roundPoint: true } : { id, ...visit };
}
