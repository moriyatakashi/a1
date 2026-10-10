// ab-166 ④(2026-10-10): ログインの幕は、Google のトークンのメール(sha256)が持ち主のときだけ開く(Azure の /session をやめた)。
// e2e では持ち主を owner@example.com にし、そのメールの入った偽のトークンでログインする。
export const OWNER_EMAIL = "owner@example.com";
export const OWNER_SHA256 = "c8cd3c6427301eaf6665bccacd65ddb614527acc843a15463e3faba57124c351"; // sha256("owner@example.com")
// btoa()はASCII専用のため、日本語などマルチバイト文字を含む名前は使わない
export const credFor = (email) =>
  "header." + Buffer.from(JSON.stringify({ name: "Test User", email, email_verified: true })).toString("base64") + ".sig";
export const FAKE_GOOGLE_CREDENTIAL = credFor(OWNER_EMAIL);
// ページを開く前に呼ぶ(持ち主の sha256 をテスト用に差し替える)
export const useTestOwner = (page) => page.addInitScript((h) => { window.AA_OWNER_EMAIL_SHA256 = h; }, OWNER_SHA256);
