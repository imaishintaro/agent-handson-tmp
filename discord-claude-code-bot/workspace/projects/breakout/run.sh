#!/bin/bash
# ブロック崩しゲーム実行スクリプト

# 仮想環境の確認とアクティベーション
if [ -f "venv/bin/activate" ]; then
    echo "仮想環境をアクティベートします..."
    source venv/bin/activate
elif command -v conda &> /dev/null; then
    echo "condaが見つかりました。breakout環境を使用します..."
    conda activate breakout 2>/dev/null || echo "condaのbreakout環境が見つかりません。現在の環境で実行します..."
fi

# 依存関係のチェック
python3 -c "import pygame" 2>/dev/null || {
    echo "pygameがインストールされていません。インストールしますか？ (y/N)"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
        pip install pygame>=2.5.0
    else
        echo "pygameが必要です。requirements.txtを参照してください。"
        exit 1
    fi
}

echo "ブロック崩しゲームを開始します..."
python3 src/main.py