// visit-store.js — 訪問(Firestore ab01-9f35a の visits/{id})と初訪問の加点(pointEvents/{id})の読み書き。m2 と a2/x5 で共用。
// ab-53(2026-10-03): 正本は Firestore(Azure の /api/visits・/api/points は書き込み 410、読みは Firestore を返す)。
// 読みは誰でも、書きは Takashi 本人のみ(Rules)。ログインは firebase.js の ensureFirebaseLogin。
import { collection, doc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { db, ensureFirebaseLogin } from "./firebase.js";

// ba-165②(2026-07-29確定、Takashi判断): 初めて行った県・市・町を自動で加点する。
// 粒度は県>市>町の順で粗い方を優先し(同時に複数が初登場でも二重加点しない)、県=high/市=normal/町=low
// (同じ県の別の市を後から訪れても県はもう新規でないので normal 以下に自然に下がる=「経年で易化」)。
// 既訪問かは今までの visits の pref/city/town と文字列が一致するかだけで見る。
// 元は Azure の bp_visits.py にあった判定を、ab-53 でここ(保存する側)へ移した。書くのは Takashi 本人だけなので、
// 判定をページ側に置いても困らない。配点は ScoringRules の初期配点(ba-53)と同じ値。
const GRANULARITY_DIFFICULTY = { pref: "high", city: "normal", town: "low" };
const DIFFICULTY_POINTS = { low: 2, normal: 5, high: 10 };

export async function fetchVisits() {
  const snap = await getDocs(collection(db, "visits"));
  return snap.docs.map((d) => ({ id: d.id, by: "takashi", ...d.data() }));
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
export async function saveVisit({ place, date, time, lat, lng, pref, city, town }, knownVisits = null) {
  await ensureFirebaseLogin();
  const granularity = newVisitGranularity(knownVisits || await fetchVisits(), { pref, city, town });
  const now = new Date().toISOString();
  const id = crypto.randomUUID(); // Azure の頃の RowKey と同じ uuid の形
  const visit = {
    place, date: date || "", time: time || "", memo: "",
    pref: pref || "", city: city || "", town: town || "",
    autoPointGranularity: granularity || "", createdAt: now, by: "takashi",
  };
  if (lat != null) visit.lat = Number(lat);
  if (lng != null) visit.lng = Number(lng);

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
  await batch.commit();
  return { id, ...visit };
}
