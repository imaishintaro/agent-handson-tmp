#!/bin/bash
# Brainf*ck Hello World 実行スクリプト

echo "🐾 Brainf*ck Hello World を実行するよ！"
echo ""

echo "📁 コメント付きバージョン:"
python3 src/bf_interpreter.py src/hello.bf

echo ""
echo "📁 コンパクト版:"
python3 src/bf_interpreter.py src/hello_compact.bf

echo ""
echo "✨ 実行完了！次はテトリスに向けて頑張ろう 🎮"