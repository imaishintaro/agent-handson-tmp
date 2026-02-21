#!/usr/bin/env python3
"""
Brainf*ck インタープリター
簡単にBrainf*ckプログラムを実行するためのツール
"""

import sys
from typing import List

def run_brainfuck(code: str, input_data: str = "") -> str:
    """
    Brainf*ckコードを実行する

    Args:
        code: Brainf*ckのソースコード
        input_data: 入力データ

    Returns:
        プログラムの出力
    """
    # メモリ（30000セル）
    memory: List[int] = [0] * 30000
    pointer = 0  # メモリポインタ
    code_pointer = 0  # コードポインタ
    input_pointer = 0  # 入力ポインタ
    output = []  # 出力

    # コメントを除去（改行とBrainf*ckコマンド以外を削除）
    clean_code = ''.join(c for c in code if c in '><+-.,[]')

    while code_pointer < len(clean_code):
        cmd = clean_code[code_pointer]

        if cmd == '>':
            pointer = min(pointer + 1, 29999)
        elif cmd == '<':
            pointer = max(pointer - 1, 0)
        elif cmd == '+':
            memory[pointer] = (memory[pointer] + 1) % 256
        elif cmd == '-':
            memory[pointer] = (memory[pointer] - 1) % 256
        elif cmd == '.':
            output.append(chr(memory[pointer]))
        elif cmd == ',':
            if input_pointer < len(input_data):
                memory[pointer] = ord(input_data[input_pointer])
                input_pointer += 1
            else:
                memory[pointer] = 0
        elif cmd == '[':
            if memory[pointer] == 0:
                # 対応する]を見つける
                bracket_count = 1
                temp_pointer = code_pointer + 1
                while temp_pointer < len(clean_code) and bracket_count > 0:
                    if clean_code[temp_pointer] == '[':
                        bracket_count += 1
                    elif clean_code[temp_pointer] == ']':
                        bracket_count -= 1
                    temp_pointer += 1
                code_pointer = temp_pointer - 1
        elif cmd == ']':
            if memory[pointer] != 0:
                # 対応する[を見つける
                bracket_count = 1
                temp_pointer = code_pointer - 1
                while temp_pointer >= 0 and bracket_count > 0:
                    if clean_code[temp_pointer] == ']':
                        bracket_count += 1
                    elif clean_code[temp_pointer] == '[':
                        bracket_count -= 1
                    temp_pointer -= 1
                code_pointer = temp_pointer + 1

        code_pointer += 1

    return ''.join(output)

def main():
    """メイン関数"""
    if len(sys.argv) != 2:
        print("使用方法: python bf_interpreter.py <brainfuckファイル>")
        sys.exit(1)

    filename = sys.argv[1]

    try:
        with open(filename, 'r', encoding='utf-8') as f:
            code = f.read()

        print(f"実行中: {filename}")
        print("=" * 40)
        output = run_brainfuck(code)
        print(output)
        print("=" * 40)
        print("実行完了")

    except FileNotFoundError:
        print(f"エラー: ファイル '{filename}' が見つかりません")
    except Exception as e:
        print(f"エラー: {e}")

if __name__ == "__main__":
    main()