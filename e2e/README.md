# e2e
[`src/`](../src/README.md)各アプリのPlaywright E2Eテスト。ファイル名の`2-`は「グループ2」を表す通し番号(グループ1は[`api-tests/`](../api-tests/README.md)のpytestテスト)。

2026-09-29: g1〜g4 のテスト(2-3・2-4・2-7・2-9・2-10・2-20)は b1/g/e2e へ移した(ab-32)。

| ファイル | 対応する`src/` |
|---|---|
| `2-1-ba-void-title-display.test.js` | `ba` |
| `2-2-bb-current-view.test.js` | `bb` |
| `2-5-k2-radar-chart.test.js` | `k2` |
| `2-6-n1-n2-google-one-tap.test.js` | `m1` |
| `2-8-persistent-session.test.js` | `ba`(`common/auth.js`) |
| `2-14-ba-approval-queue.test.js` | `ba`(承認キュー) |
| `2-15-ba-react.test.js` | `ba`(反応チップ) |
| `2-16-ba-reclassify.test.js` | `ba`(分類変更) |
| `2-18-a2-paths.test.js` | `a2`(旧a2アプリのパス・深さ) |
| `2-19-nav-smoke.test.js` | nav.ymlの全ページ(開くだけ: ローカル404・スクリプトエラー無し) |

## 実行
初回のみ依存パッケージをインストール。
```
npm ci
npx playwright install --with-deps chromium
```
```
node --test
```
Node.js組み込みのテストランナーがリポジトリ全体から`*.test.js`を探すため、パス指定は不要。各テストファイルが自前で静的サーバーを起動し、Google認証・API呼び出しは`page.route()`でモックするため、`api/`や`src/`を別途起動しておく必要はない。CIでは`.github/workflows/test.yml`の`test`ジョブで実行される。
