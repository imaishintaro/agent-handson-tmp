#!/usr/bin/env python3
"""
オセロゲームのテストコード
"""
import sys
import os

# モジュールのパスを追加
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))

from class_othello import Othello
from func_utils import get_ai_move, get_smart_ai_move


def test_initial_setup():
    """初期設定のテスト"""
    game = Othello()

    # ボードサイズのチェック
    assert game.board_size == 8

    # 初期配置のチェック
    assert game.board[3][3] == -1  # 白
    assert game.board[3][4] == 1   # 黒
    assert game.board[4][3] == 1   # 黒
    assert game.board[4][4] == -1  # 白

    # 先手は黒
    assert game.current_player == 1

    print("✓ 初期設定テスト: 成功")


def test_valid_moves():
    """合法手のテスト"""
    game = Othello()

    # 初期状態での合法手をチェック
    valid_moves = game.get_valid_moves()
    expected_moves = [(2, 3), (3, 2), (4, 5), (5, 4)]

    assert len(valid_moves) == 4
    for move in expected_moves:
        assert move in valid_moves

    print("✓ 合法手テスト: 成功")


def test_make_move():
    """手を打つテスト"""
    game = Othello()

    # 合法手を打つ
    assert game.make_move(2, 3) == True
    assert game.board[2][3] == 1  # 黒石が置かれる
    assert game.board[3][3] == 1  # 白石が黒に変わる

    # 不正な手を打つ
    assert game.make_move(0, 0) == False  # 置けない場所
    assert game.make_move(2, 3) == False  # 既に石がある場所

    print("✓ 石を置くテスト: 成功")


def test_score_calculation():
    """スコア計算のテスト"""
    game = Othello()

    # 初期状態のスコア
    black_score, white_score = game.get_score()
    assert black_score == 2
    assert white_score == 2

    # 1手打った後のスコア
    game.make_move(2, 3)
    black_score, white_score = game.get_score()
    assert black_score == 4  # 3個の黒石 + 1個裏返した
    assert white_score == 1  # 1個の白石（1個裏返された）

    print("✓ スコア計算テスト: 成功")


def test_game_flow():
    """ゲームフローのテスト"""
    game = Othello()

    # いくつかの手を打ってみる
    moves = [(2, 3), (2, 2), (2, 4), (2, 5)]

    for move in moves:
        valid_moves = game.get_valid_moves()
        if move in valid_moves:
            assert game.make_move(move[0], move[1]) == True
            game.switch_player()
        else:
            game.switch_player()  # パス

    # ゲームが継続中であることを確認
    assert not game.is_game_over()

    print("✓ ゲームフローテスト: 成功")


def test_ai_functions():
    """AI関数のテスト"""
    game = Othello()

    # ランダムAIのテスト
    ai_move = get_ai_move(game)
    assert ai_move is not None
    assert ai_move in game.get_valid_moves()

    # 戦略AIのテスト
    smart_move = get_smart_ai_move(game)
    assert smart_move is not None
    assert smart_move in game.get_valid_moves()

    print("✓ AI関数テスト: 成功")


def run_all_tests():
    """全てのテストを実行"""
    print("オセロゲーム テスト開始")
    print("="*30)

    try:
        test_initial_setup()
        test_valid_moves()
        test_make_move()
        test_score_calculation()
        test_game_flow()
        test_ai_functions()

        print("="*30)
        print("✅ 全てのテストが成功しました！")

    except AssertionError as e:
        print(f"❌ テストエラー: {e}")
        return False
    except Exception as e:
        print(f"❌ 予期しないエラー: {e}")
        return False

    return True


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)