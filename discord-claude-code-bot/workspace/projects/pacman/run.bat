@echo off
REM パックマンゲーム実行スクリプト (Windows)

REM 仮想環境があればアクティベート
if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

REM Pygameがインストールされているか確認
python -c "import pygame" 2>nul || pip install -r requirements.txt

REM ゲーム実行
cd src
python main.py
