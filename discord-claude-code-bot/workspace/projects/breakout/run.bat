@echo off
REM ブロック崩しゲーム実行スクリプト

REM Python環境の確認
python --version >nul 2>&1
if errorlevel 1 (
    echo Pythonが見つかりません。Pythonをインストールしてください。
    pause
    exit /b 1
)

REM pygameの確認
python -c "import pygame" >nul 2>&1
if errorlevel 1 (
    echo pygameがインストールされていません。
    set /p install="インストールしますか？ (y/N): "
    if /i "%install%"=="y" (
        pip install pygame>=2.5.0
    ) else (
        echo pygameが必要です。requirements.txtを参照してください。
        pause
        exit /b 1
    )
)

echo ブロック崩しゲームを開始します...
python src/main.py