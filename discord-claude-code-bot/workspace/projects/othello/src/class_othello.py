"""
オセロゲームのメインクラス
"""
from typing import List, Tuple, Optional


class Othello:
    """オセロゲームのロジックを管理するクラス"""

    def __init__(self):
        """
        ゲームの初期化
        """
        self.board_size = 8
        self.board = [[0 for _ in range(self.board_size)] for _ in range(self.board_size)]
        self.current_player = 1  # 1: 黒（先手）, -1: 白（後手）
        self.game_over = False

        # 初期配置
        mid = self.board_size // 2
        self.board[mid-1][mid-1] = -1  # 白
        self.board[mid-1][mid] = 1     # 黒
        self.board[mid][mid-1] = 1     # 黒
        self.board[mid][mid] = -1      # 白

    def display_board(self) -> None:
        """
        ボードを表示する
        """
        print("\n  ", end="")
        for i in range(self.board_size):
            print(f"{i+1} ", end="")
        print()

        for i in range(self.board_size):
            print(f"{i+1} ", end="")
            for j in range(self.board_size):
                if self.board[i][j] == 1:
                    print("● ", end="")
                elif self.board[i][j] == -1:
                    print("○ ", end="")
                else:
                    print(". ", end="")
            print()

    def is_valid_move(self, row: int, col: int) -> bool:
        """
        指定した位置に石を置けるかチェック

        Args:
            row: 行（0-7）
            col: 列（0-7）

        Returns:
            置けるならTrue、置けないならFalse
        """
        if not (0 <= row < self.board_size and 0 <= col < self.board_size):
            return False

        if self.board[row][col] != 0:
            return False

        # 8方向をチェック
        directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1),
                     (0, 1), (1, -1), (1, 0), (1, 1)]

        for dr, dc in directions:
            if self._check_direction(row, col, dr, dc):
                return True

        return False

    def _check_direction(self, row: int, col: int, dr: int, dc: int) -> bool:
        """
        指定した方向に相手の石を挟めるかチェック

        Args:
            row, col: 起点位置
            dr, dc: 方向ベクトル

        Returns:
            挟めるならTrue
        """
        r, c = row + dr, col + dc
        found_opponent = False

        while 0 <= r < self.board_size and 0 <= c < self.board_size:
            if self.board[r][c] == 0:  # 空きマス
                return False
            elif self.board[r][c] == -self.current_player:  # 相手の石
                found_opponent = True
                r, c = r + dr, c + dc
            elif self.board[r][c] == self.current_player:  # 自分の石
                return found_opponent
            else:
                return False

        return False

    def make_move(self, row: int, col: int) -> bool:
        """
        石を置く

        Args:
            row: 行（0-7）
            col: 列（0-7）

        Returns:
            成功ならTrue
        """
        if not self.is_valid_move(row, col):
            return False

        self.board[row][col] = self.current_player

        # 8方向の石を裏返す
        directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1),
                     (0, 1), (1, -1), (1, 0), (1, 1)]

        for dr, dc in directions:
            if self._check_direction(row, col, dr, dc):
                self._flip_stones(row, col, dr, dc)

        return True

    def _flip_stones(self, row: int, col: int, dr: int, dc: int) -> None:
        """
        指定した方向の石を裏返す
        """
        r, c = row + dr, col + dc

        while 0 <= r < self.board_size and 0 <= c < self.board_size:
            if self.board[r][c] == -self.current_player:
                self.board[r][c] = self.current_player
                r, c = r + dr, c + dc
            elif self.board[r][c] == self.current_player:
                break

    def get_valid_moves(self) -> List[Tuple[int, int]]:
        """
        現在のプレイヤーが置ける場所のリストを取得

        Returns:
            [(row, col), ...] のリスト
        """
        valid_moves = []
        for i in range(self.board_size):
            for j in range(self.board_size):
                if self.is_valid_move(i, j):
                    valid_moves.append((i, j))
        return valid_moves

    def switch_player(self) -> None:
        """プレイヤーを交代"""
        self.current_player = -self.current_player

    def is_game_over(self) -> bool:
        """
        ゲーム終了判定

        Returns:
            ゲーム終了ならTrue
        """
        # ボードが満杯かチェック
        for i in range(self.board_size):
            for j in range(self.board_size):
                if self.board[i][j] == 0:
                    break
            else:
                continue
            break
        else:
            return True

        # 両プレイヤーが打てる手があるかチェック
        player1_can_move = len(self.get_valid_moves()) > 0
        self.current_player = -self.current_player
        player2_can_move = len(self.get_valid_moves()) > 0
        self.current_player = -self.current_player

        return not (player1_can_move or player2_can_move)

    def get_score(self) -> Tuple[int, int]:
        """
        現在のスコアを取得

        Returns:
            (黒の石数, 白の石数)
        """
        black_count = sum(row.count(1) for row in self.board)
        white_count = sum(row.count(-1) for row in self.board)
        return black_count, white_count

    def get_winner(self) -> Optional[int]:
        """
        勝者を取得

        Returns:
            1: 黒の勝ち, -1: 白の勝ち, 0: 引き分け, None: ゲーム継続中
        """
        if not self.is_game_over():
            return None

        black_score, white_score = self.get_score()
        if black_score > white_score:
            return 1
        elif white_score > black_score:
            return -1
        else:
            return 0