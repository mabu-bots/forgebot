# 🤝 コントリビューション

開発の流れは **Issue → ブランチ → PR → CI → マージ** で統一する。

## 💡 Issue

- 作業は Issue から始める。目的・作業内容・完了条件を書く。
- テンプレート（`.github/ISSUE_TEMPLATE/`）を使う。

## 🌿 ブランチ

- `main` から切る。命名は `<type>/<issue番号>-<slug>`。
  例: `feat/12-share-code`、`fix/9-cooldown-check`

## ✍️ コミット

- Conventional Commits（英語）で書く。
  例: `feat: add share code export`、`fix: stop double fire on restart`

## 📬 Pull Request

- PR テンプレートに沿って書き、本文に `Closes #<issue番号>` を含める。
- CI がグリーンになってからマージする。マージ方式は
  **Rebase and merge**、マージ後にブランチは削除する。

## 🏷️ リリース

- `main` でバージョンを上げ、タグ `vX.Y.Z` を打って Release を作る。
