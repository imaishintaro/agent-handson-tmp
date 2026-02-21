#!/bin/bash

# Discord Claude Code Bot 起動スクリプト

cd "$(dirname "$0")"

echo "======================================"
echo "  Discord Claude Code Bot"
echo "======================================"

# .envの存在チェック
if [ ! -f .env ]; then
  echo "エラー: .env ファイルが見つかりません"
  echo "  cp .env.example .env でファイルを作成し、DISCORD_TOKENを設定してください"
  exit 1
fi

# node_modulesのチェック
if [ ! -d node_modules ]; then
  echo "依存パッケージをインストールしています..."
  npm install
fi

# ビルド
echo "ビルド中..."
npm run build
if [ $? -ne 0 ]; then
  echo "エラー: ビルドに失敗しました"
  exit 1
fi

echo "ボットを起動します..."
echo "======================================"
npm start
