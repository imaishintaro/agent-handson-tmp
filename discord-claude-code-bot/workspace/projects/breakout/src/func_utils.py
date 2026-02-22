"""
ブロック崩しゲーム用のユーティリティ定数・関数

このモジュールはゲーム全体で使用される定数、色、列挙型を定義します。
"""

from enum import Enum, auto
from typing import Tuple


# =========================================================
# 画面・フレーム設定
# =========================================================

# 画面サイズ
SCREEN_WIDTH: int = 800
SCREEN_HEIGHT: int = 600

# フレームレート
FPS: int = 60

# ゲームタイトル
WINDOW_TITLE: str = "ブロック崩し"


# =========================================================
# 色定義 (R, G, B)
# =========================================================

BLACK: Tuple[int, int, int] = (0, 0, 0)
WHITE: Tuple[int, int, int] = (255, 255, 255)
GRAY: Tuple[int, int, int] = (128, 128, 128)
DARK_GRAY: Tuple[int, int, int] = (50, 50, 50)
LIGHT_GRAY: Tuple[int, int, int] = (200, 200, 200)

RED: Tuple[int, int, int] = (220, 50, 50)
ORANGE: Tuple[int, int, int] = (230, 120, 30)
YELLOW: Tuple[int, int, int] = (230, 210, 50)
GREEN: Tuple[int, int, int] = (50, 200, 80)
CYAN: Tuple[int, int, int] = (50, 200, 220)
BLUE: Tuple[int, int, int] = (50, 100, 220)
PURPLE: Tuple[int, int, int] = (160, 60, 220)
PINK: Tuple[int, int, int] = (220, 100, 160)

# パドルの色
PADDLE_COLOR: Tuple[int, int, int] = (100, 180, 255)
PADDLE_BORDER_COLOR: Tuple[int, int, int] = (50, 120, 200)

# ボールの色
BALL_COLOR: Tuple[int, int, int] = (255, 230, 80)
BALL_BORDER_COLOR: Tuple[int, int, int] = (200, 170, 30)

# 背景色
BG_COLOR: Tuple[int, int, int] = (15, 15, 30)
BG_GRID_COLOR: Tuple[int, int, int] = (25, 25, 45)

# UI文字色
TEXT_COLOR: Tuple[int, int, int] = WHITE
TEXT_HIGHLIGHT_COLOR: Tuple[int, int, int] = YELLOW


# =========================================================
# パドル設定
# =========================================================

PADDLE_WIDTH: int = 100          # パドルの幅 (px)
PADDLE_HEIGHT: int = 14          # パドルの高さ (px)
PADDLE_SPEED: int = 7            # パドルの移動速度 (px/frame)
PADDLE_BOTTOM_MARGIN: int = 40   # 画面下からの距離 (px)
PADDLE_BORDER_RADIUS: int = 7    # パドル角の丸み


# =========================================================
# ボール設定
# =========================================================

BALL_RADIUS: int = 9             # ボールの半径 (px)
BALL_INITIAL_SPEED: float = 5.0  # ボールの初期速度 (px/frame)
BALL_MAX_SPEED: float = 12.0     # ボールの最大速度 (px/frame)
BALL_SPEED_INCREMENT: float = 0.3  # ブロック破壊ごとの速度増加量


# =========================================================
# ブロック設定
# =========================================================

BRICK_COLS: int = 10             # ブロックの列数
BRICK_ROWS: int = 6              # ブロックの行数
BRICK_WIDTH: int = 70            # ブロックの幅 (px)
BRICK_HEIGHT: int = 25           # ブロックの高さ (px)
BRICK_PADDING: int = 5           # ブロック間の隙間 (px)
BRICK_TOP_OFFSET: int = 60       # ブロックグリッドの上端オフセット (px)
BRICK_LEFT_OFFSET: int = 25      # ブロックグリッドの左端オフセット (px)
BRICK_BORDER_RADIUS: int = 4     # ブロック角の丸み

# ブロックの行ごとのスコアと耐久度設定
# (color, points, durability) のタプルリスト（上から順）
BRICK_ROW_CONFIG: list = [
    (RED,    70, 2),   # 行0: 赤、最高得点、耐久2
    (ORANGE, 60, 2),   # 行1: オレンジ、耐久2
    (YELLOW, 50, 1),   # 行2: 黄色、耐久1
    (GREEN,  40, 1),   # 行3: 緑、耐久1
    (CYAN,   30, 1),   # 行4: シアン、耐久1
    (BLUE,   20, 1),   # 行5: 青、耐久1
]

# 耐久度2のブロックがダメージを受けたときの色
BRICK_DAMAGED_COLOR: Tuple[int, int, int] = GRAY


# =========================================================
# スコア・ライフ設定
# =========================================================

INITIAL_LIVES: int = 3           # 初期ライフ数
MAX_LIVES: int = 5               # 最大ライフ数（アイテム取得上限）


# =========================================================
# UI設定
# =========================================================

HUD_HEIGHT: int = 50             # HUD（スコア表示エリア）の高さ (px)
HUD_FONT_SIZE: int = 28          # HUDフォントサイズ
TITLE_FONT_SIZE: int = 64        # タイトルフォントサイズ
SUBTITLE_FONT_SIZE: int = 32     # サブタイトルフォントサイズ
INFO_FONT_SIZE: int = 24         # 情報テキストフォントサイズ


# =========================================================
# ゲーム状態列挙型
# =========================================================


class GameState(Enum):
    """ゲームの状態を表す列挙型"""

    TITLE = auto()       # タイトル画面
    PLAYING = auto()     # プレイ中
    PAUSED = auto()      # 一時停止中
    BALL_LOST = auto()   # ボール消失（次のボール待ち）
    GAME_OVER = auto()   # ゲームオーバー
    CLEAR = auto()       # ゲームクリア


# =========================================================
# ユーティリティ関数
# =========================================================


def clamp(value: float, min_val: float, max_val: float) -> float:
    """
    値を指定範囲内に収める。

    Args:
        value: クランプする値
        min_val: 最小値
        max_val: 最大値

    Returns:
        min_val と max_val の間に収められた値
    """
    return max(min_val, min(max_val, value))


def get_brick_grid_total_width() -> int:
    """
    ブロックグリッド全体の幅を計算して返す。

    Returns:
        ブロックグリッドの合計幅 (px)
    """
    return BRICK_COLS * (BRICK_WIDTH + BRICK_PADDING) - BRICK_PADDING


def get_brick_grid_total_height() -> int:
    """
    ブロックグリッド全体の高さを計算して返す。

    Returns:
        ブロックグリッドの合計高さ (px)
    """
    return BRICK_ROWS * (BRICK_HEIGHT + BRICK_PADDING) - BRICK_PADDING


def compute_brick_pixel_x(col: int) -> int:
    """
    列インデックスからブロックの左端X座標を計算する。

    Args:
        col: 列インデックス (0 始まり)

    Returns:
        ブロック左端のX座標 (px)
    """
    return BRICK_LEFT_OFFSET + col * (BRICK_WIDTH + BRICK_PADDING)


def compute_brick_pixel_y(row: int) -> int:
    """
    行インデックスからブロックの上端Y座標を計算する。

    Args:
        row: 行インデックス (0 始まり)

    Returns:
        ブロック上端のY座標 (px)
    """
    return HUD_HEIGHT + BRICK_TOP_OFFSET + row * (BRICK_HEIGHT + BRICK_PADDING)
