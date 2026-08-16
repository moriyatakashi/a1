# a1

Takashi の個人プロジェクト（roreki）の公開メインアプリ。GitHub Pages で配信している。

- 配信: https://moriyatakashi.github.io/a1/

## 構成

- `src/` … 各アプリ
  - `m1` `m2` `m3` … 記録系（日々記録・訪問地図ほか）
  - `ba` `bb` `bc` `bd` … 内部メモ系（ba ログのビュー／レーダーチャート／card ほか）
  - `g/` … 実験・エミュレータ系
  - `common/` … 共有モジュール（auth・config・ledger スタイル ほか）
- `e2e/` … Playwright テスト
- `scripts/` … ビルド・BaLog バックアップ・エントロピースキャン
- `.github/workflows/` … Pages デプロイ／テスト／BaLog バックアップ

## 生成の流れ

トップページの掲載項目は `nav.yml` が定義し、`scripts/build-index.mjs` が index を生成する。
内部メモ系は `robots.txt` で検索除外している。
