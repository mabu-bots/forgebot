#!/bin/sh
# リポジトリ全体を Prettier で整形する
set -eu
cd "$(dirname "$0")/.."
npx prettier --write .
