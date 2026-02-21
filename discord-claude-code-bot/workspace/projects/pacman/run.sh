#!/bin/bash
# パックマンゲーム実行スクリプト (Mac/Linux)

# 仮想環境があればアクティベート
if [ -d "venv" ]; then
    source venv/bin/activate
fi

# Pygameがインストールされているか確認
python3 -c "import pygame" 2>/dev/null || pip3 install -r requirements.txt

# ゲーム実行
cd src
python3 main.py
