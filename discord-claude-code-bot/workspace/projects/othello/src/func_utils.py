"""
オセロゲーム用のユーティリティ関数
"""
import random
from typing import Tuple, List, Optional
from class_othello import Othello


def get_player_input() -> Tuple[int, int]:
    """
    プレイヤーからの入力を受け取る

    Returns:
        (row, col) のタプル（0-7の範囲）
    """
    while True:
        try:
            user_input = input("石を置く位置を入力してください (行 列, 1-8): ").strip()
            if user_input.lower() in ['quit', 'exit', 'q']:
                return (-1, -1)  # 終了シグナル

            parts = user_input.split()
            if len(parts) != 2:
                print("行と列を空白で区切って入力してください（例: 3 4）")
                continue

            row = int(parts[0]) - 1  # 1-8 から 0-7 に変換
            col = int(parts[1]) - 1

            if not (0 <= row <= 7 and 0 <= col <= 7):
                print("1から8の範囲で入力してください")
                continue

            return (row, col)

        except ValueError:
            print("数字で入力してください（例: 3 4）")
        except KeyboardInterrupt:
            return (-1, -1)


def get_ai_move(game: Othello) -> Optional[Tuple[int, int]]:
    """
    AIの手を決定する（現在はランダム選択）

    Args:
        game: オセロゲームインスタンス

    Returns:
        (row, col) のタプル、または None（打てる手がない場合）
    """
    valid_moves = game.get_valid_moves()
    if not valid_moves:
        return None

    # 現在はランダム選択（将来的に改良予定）
    return random.choice(valid_moves)


def get_smart_ai_move(game: Othello) -> Optional[Tuple[int, int]]:
    """
    より賢いAIの手を決定する（簡単な戦略付き）

    Args:
        game: オセロゲームインスタンス

    Returns:
        (row, col) のタプル、または None（打てる手がない場合）
    """
    valid_moves = game.get_valid_moves()
    if not valid_moves:
        return None

    # 戦略的優先度
    corner_positions = [(0, 0), (0, 7), (7, 0), (7, 7)]
    edge_positions = []

    # エッジ位置を生成
    for i in range(8):
        if (0, i) not in corner_positions:
            edge_positions.append((0, i))
        if (7, i) not in corner_positions:
            edge_positions.append((7, i))
        if (i, 0) not in corner_positions:
            edge_positions.append((i, 0))
        if (i, 7) not in corner_positions:
            edge_positions.append((i, 7))

    # 優先度1: 角を取る
    for move in valid_moves:
        if move in corner_positions:
            return move

    # 優先度2: より多くの石を取る
    best_move = None
    max_flips = -1

    for move in valid_moves:
        # 仮想的に手を打って、ひっくり返る石の数を計算
        temp_game = Othello()
        temp_game.board = [row[:] for row in game.board]  # ボードをコピー
        temp_game.current_player = game.current_player

        original_score = sum(row.count(game.current_player) for row in temp_game.board)
        temp_game.make_move(move[0], move[1])
        new_score = sum(row.count(game.current_player) for row in temp_game.board)

        flips = new_score - original_score - 1  # -1は今置いた石

        if flips > max_flips:
            max_flips = flips
            best_move = move

    return best_move if best_move else random.choice(valid_moves)


def display_game_status(game: Othello) -> None:
    """
    ゲームの状態を表示する

    Args:
        game: オセロゲームインスタンス
    """
    black_score, white_score = game.get_score()
    current_player_str = "黒（●）" if game.current_player == 1 else "白（○）"

    print(f"\n現在のスコア - 黒: {black_score}, 白: {white_score}")
    print(f"現在のプレイヤー: {current_player_str}")

    valid_moves = game.get_valid_moves()
    if valid_moves:
        print(f"置ける場所の数: {len(valid_moves)}")
        print("置ける場所:", end=" ")
        for i, (row, col) in enumerate(valid_moves):
            if i < 5:  # 最初の5個だけ表示
                print(f"({row+1},{col+1})", end=" ")
        if len(valid_moves) > 5:
            print("...")
        else:
            print()
    else:
        print("置ける場所がありません（パス）")


def display_game_result(game: Othello) -> None:
    """
    ゲーム結果を表示する

    Args:
        game: オセロゲームインスタンス
    """
    black_score, white_score = game.get_score()
    winner = game.get_winner()

    print("\n" + "="*40)
    print("ゲーム終了！")
    print(f"最終スコア - 黒: {black_score}, 白: {white_score}")

    if winner == 1:
        print("黒（●）の勝ち！")
    elif winner == -1:
        print("白（○）の勝ち！")
    else:
        print("引き分け！")
    print("="*40)


def show_help() -> None:
    """ヘルプ情報を表示"""
    print("\n" + "="*40)
    print("オセロゲーム - 遊び方")
    print("="*40)
    print("1. 石を置く位置を「行 列」形式で入力（例: 3 4）")
    print("2. 相手の石を挟むように置いてください")
    print("3. 置ける場所がない場合は自動的にパスします")
    print("4. 'quit' または 'q' で終了")
    print("5. ボードの見方:")
    print("   ● : 黒石（あなた）")
    print("   ○ : 白石（AI）")
    print("   . : 空きマス")
    print("="*40 + "\n")