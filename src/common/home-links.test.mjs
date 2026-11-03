// トップの家のリンク(b1 ah-149)。保存する形・開いてよいアドレス・並びを確かめる。
// 本物のアドレスは書かない(例は example の名前だけ)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { isLinkUrl, makeLink, sortLinks, MAX_NAME } from "./home-links.js";

test("開いてよいのは http(s) だけ", () => {
  assert.equal(isLinkUrl("http://example.invalid:8080/"), true);
  assert.equal(isLinkUrl("https://example.invalid/redmine"), true);
  assert.equal(isLinkUrl("javascript:alert(1)"), false);
  assert.equal(isLinkUrl("ftp://example.invalid/"), false);
  assert.equal(isLinkUrl("http://"), false);
  assert.equal(isLinkUrl('http://example.invalid/"x'), false);
  assert.equal(isLinkUrl(undefined), false);
  assert.equal(isLinkUrl("http://example.invalid/" + "a".repeat(300)), false);
});

test("保存する形", () => {
  const now = new Date("2026-11-03T01:00:00Z");
  assert.deepEqual(makeLink({ name: " 山行記 ", url: " http://example.invalid/ " }, now), {
    name: "山行記", url: "http://example.invalid/", createdAt: "2026-11-03T01:00:00.000Z", by: "takashi",
  });
  assert.equal(makeLink({ name: "", url: "http://example.invalid/" }), null);
  assert.equal(makeLink({ name: "a".repeat(MAX_NAME + 1), url: "http://example.invalid/" }), null);
  assert.equal(makeLink({ name: "x", url: "javascript:void(0)" }), null);
});

test("並びは足した順、形の合わないものは出さない", () => {
  const rows = [
    { id: "b", name: "B", url: "http://example.invalid/b", createdAt: "2026-11-03T02:00:00Z" },
    { id: "a", name: "A", url: "http://example.invalid/a", createdAt: "2026-11-03T01:00:00Z" },
    { id: "x", name: "X", url: "javascript:alert(1)", createdAt: "2026-11-03T00:00:00Z" },
    { id: "y", name: "", url: "http://example.invalid/y" },
  ];
  assert.deepEqual(sortLinks(rows).map((r) => r.id), ["a", "b"]);
});
