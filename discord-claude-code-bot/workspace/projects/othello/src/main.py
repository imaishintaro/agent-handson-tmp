#!/usr/bin/env python3
"""
オセロゲーム メインファイル
"""
import sys
import os

# モジュールのパスを追加
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from class_othello import Othello
from func_utils import (
    get_player_input,
    get_ai_move,
    get_smart_ai_move,
    display_game_status,
    display_game_result,
    show_help
)


def choose_game_mode() -> str:
    """
    ゲームモードを選択

    Returns:
        'easy', 'hard', または 'quit'
    """
    print("\n" + "="*40)
    print("オセロゲームへようこそ！")
    print("="*40)
    print("1. かんたん（AI: ランダム）")
    print("2. ふつう（AI: 戦略あり）")
    print("3. ヘルプ")
    print("4. 終了")

    while True:
        choice = input("\n選択してください (1-4): ").strip()
        if choice == '1':
            return 'easy'
        elif choice == '2':
            return 'hard'
        elif choice == '3':
            show_help()
            continue
        elif choice == '4':
            return 'quit'
        else:
            print("1から4の数字を入力してください")


def play_game(difficulty: str) -> None:
    """
    ゲームをプレイする

    Args:
        difficulty: 'easy' または 'hard'
    """
    game = Othello()
    ai_function = get_ai_move if difficulty == 'easy' else get_smart_ai_move

    print(f"\nゲーム開始！（難易度: {'かんたん' if difficulty == 'easy' else 'ふつう'}）")
    print("あなたは黒（●）です。AIは白（○）です。")

    while not game.is_game_over():
        # ボード表示
        game.display_board()
        display_game_status(game)

        valid_moves = game.get_valid_moves()

        if game.current_player == 1:  # プレイヤーのターン
            if not valid_moves:
                print("あなたはパスです")
                input("Enterキーを押して続行...")
                game.switch_player()
                continue

            row, col = get_player_input()

            # 終了チェック
            if row == -1 and col == -1:
                print("ゲームを終了します")
                return

            # 手の有効性チェック
            if not game.is_valid_move(row, col):
                print("そこには置けません。もう一度入力してください。")
                continue

            game.make_move(row, col)
            print(f"あなたの手: ({row+1}, {col+1})")

        else:  # AIのターン
            if not valid_moves:
                print("AIはパスです")
                input("Enterキーを押して続行...")
                game.switch_player()
                continue

            print("AIが考え中...")
            ai_move = ai_function(game)
            if ai_move:
                game.make_move(ai_move[0], ai_move[1])
                print(f"AIの手: ({ai_move[0]+1}, {ai_move[1]+1})")

        game.switch_player()

    # ゲーム終了
    game.display_board()
    display_game_result(game)


def main():
    """メイン関数"""
    try:
        while True:
            mode = choose_game_mode()

            if mode == 'quit':
                print("ゲームを終了します。ありがとうございました！")
                break

            play_game(mode)

            # もう一度プレイするかの確認
            while True:
                again = input("\nもう一度プレイしますか？ (y/n): ").strip().lower()
                if again in ['y', 'yes', 'はい']:
                    break
                elif again in ['n', 'no', 'いいえ']:
                    print("ゲームを終了します。ありがとうございました！")
                    return
                else:
                    print("y または n で答えてください")

    except KeyboardInterrupt:
        print("\n\nゲームを終了します。ありがとうございました！")
    except Exception as e:
        print(f"エラーが発生しました: {e}")
        print("ゲームを終了します")


if __name__ == "__main__":
    main()