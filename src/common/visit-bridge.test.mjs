// ab-175(2026-10-18): 橋を渡った日の1点は1日1回。visit-round.test.mjs と同じく「足す前は無く、足したら付く」ときだけ。
import test from "node:test";
import assert from "node:assert/strict";
import { bridgePointFor } from "./visit-bridge.js";

const v = (pref, lat, lng, date, time) => ({ pref, lat, lng, date, time });

test("橋の1点: 島をまたいだ保存で付き、同じ日の2回目は付かない", () => {
  const day = "2026-10-18";
  const before = [v("香川県", 34.34, 134.05, day, "09:00")];
  const got = bridgePointFor(before, v("岡山県", 34.66, 133.92, day, "11:00"));
  assert.equal(got.key, "seto");
  const after = [...before, v("岡山県", 34.66, 133.92, day, "11:00")];
  assert.equal(bridgePointFor(after, v("香川県", 34.34, 134.05, day, "15:00")), null, "1日1点");
  assert.equal(bridgePointFor(after, v("香川県", 34.34, 134.05, "2026-10-19", "09:00")).key, "seto", "次の日はまた付く");
  assert.equal(bridgePointFor([v("大阪府", 34.69, 135.5, day, "09:00")], v("大阪府", 34.70, 135.5, day, "10:00")), null);
  assert.equal(bridgePointFor(before, { ...v("岡山県", 34.66, 133.92, "", "") }), null, "日付が無ければ付けない");
});
