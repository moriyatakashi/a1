# a1

Takashi の個人プロジェクト（roreki）の公開メインアプリ。GitHub Pages で配信している。

- 配信: https://moriyatakashi.github.io/a1/

## 構成

- `src/` … 各アプリ
  - `m1` `m2` `m3` … 記録系（日々記録・訪問地図ほか）
  - `m4` … レーダーチャート(旧 bc、2026-10-18 に m4 へ)。ba・bb・bd と x1・x2 は2026-10-12に礼文のローカル Web(b1/g/c1、家の中だけ)へ移した(ab-165)
  - (旧 `g/`)ゲーム・エミュレータ(g1〜g7・g9)は2026-09-29に b1/g へ移し、公開をやめた(ab-32)。残っていた g8(aa の設計記録)と bd/be/t26(aa の現況)は2026-10-03に外した(写しは ab-85)
  - `common/` … 共有モジュール（auth・config・ledger スタイル ほか）
- `e2e/` … Playwright テスト
- `scripts/` … ビルド・BaLog バックアップ・エントロピースキャン
- `.github/workflows/` … Pages デプロイ／テスト／BaLog バックアップ

## 生成の流れ

トップページの掲載項目は `nav.yml` が定義し、`scripts/build-index.mjs` が index を生成する。
検索よけはページごとの `<meta name="robots" content="noindex">` で行う(`src/common/noindex.test.mjs`)。
