#!/usr/bin/env bash
# forgebot のワンコマンドビルド。
# 依存関係のインストール → 型チェック → ビルド → テスト を順に行い、
# 失敗したステップで止まって、どこで落ちたかを表示する。

set -euo pipefail
cd "$(dirname "$0")"

step() {
  echo
  echo "===== $1 ====="
}

fail() {
  echo "ERROR: ステップが失敗しました: $1" >&2
  exit 1
}

# ===== 前提チェック =====
command -v node >/dev/null 2>&1 || fail "前提チェック (Node.js が見つかりません)"
command -v npm >/dev/null 2>&1 || fail "前提チェック (npm が見つかりません)"

# ===== 1/4 依存関係のインストール =====
step "1/4 依存関係のインストール"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || fail "依存関係のインストール (npm ci)"
else
  npm install --no-audit --no-fund || fail "依存関係のインストール (npm install)"
fi

# ===== 2/4 型チェック =====
step "2/4 型チェック (npm run typecheck)"
npm run typecheck || fail "型チェック (npm run typecheck)"

# ===== 3/4 ビルド =====
step "3/4 ビルド (npm run build)"
npm run build || fail "ビルド (npm run build)"

# ===== 4/4 テスト =====
step "4/4 テスト (npm test)"
npm test || fail "テスト (npm test)"

echo
echo "BUILD OK: forgebot のビルドとテストがすべて成功しました (成果物: dist/)"
