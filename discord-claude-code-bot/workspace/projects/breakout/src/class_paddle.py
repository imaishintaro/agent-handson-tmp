"""
ブロック崩しゲーム パドルクラス

プレイヤーが操作するパドルの描画・移動・衝突判定を管理します。
"""

import pygame
from typing import Tuple

from func_utils import (
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    PADDLE_WIDTH,
    PADDLE_HEIGHT,
    PADDLE_SPEED,
    PADDLE_BOTTOM_MARGIN,
    PADDLE_BORDER_RADIUS,
    PADDLE_COLOR,
    PADDLE_BORDER_COLOR,
    WHITE,
    clamp,
)


class Paddle:
    """
    プレイヤー操作のパドルクラス。

    左右キーまたはマウスによる操作に対応し、
    画面端を超えないように移動を制限します。

    Attributes:
        x (float): パドル左端のX座標
        y (int): パドル上端のY座標
        width (int): パドルの幅
        height (int): パドルの高さ
        speed (int): キー操作時の移動速度
    """

    def __init__(self) -> None:
        """パドルを画面中央下部に初期化する。"""
        self.width: int = PADDLE_WIDTH
        self.height: int = PADDLE_HEIGHT
        self.speed: int = PADDLE_SPEED

        # 初期位置: 画面中央水平、下端から一定距離
        self.x: float = (SCREEN_WIDTH - self.width) / 2
        self.y: int = SCREEN_HEIGHT - PADDLE_BOTTOM_MARGIN - self.height

    @property
    def rect(self) -> pygame.Rect:
        """
        衝突判定・描画用の pygame.Rect を返す。

        Returns:
            パドルの矩形領域
        """
        return pygame.Rect(int(self.x), self.y, self.width, self.height)

    @property
    def center_x(self) -> float:
        """
        パドル中心のX座標を返す。

        Returns:
            パドル中心X座標
        """
        return self.x + self.width / 2

    def reset(self) -> None:
        """パドルを初期位置（画面中央）にリセットする。"""
        self.x = (SCREEN_WIDTH - self.width) / 2

    def move_left(self) -> None:
        """
        パドルを左に移動する。

        画面左端を超えないよう制限します。
        """
        self.x = clamp(self.x - self.speed, 0.0, float(SCREEN_WIDTH - self.width))

    def move_right(self) -> None:
        """
        パドルを右に移動する。

        画面右端を超えないよう制限します。
        """
        self.x = clamp(self.x + self.speed, 0.0, float(SCREEN_WIDTH - self.width))

    def move_to_mouse(self, mouse_x: int) -> None:
        """
        マウスのX座標にパドル中心を合わせる。

        Args:
            mouse_x: マウスのX座標 (px)
        """
        new_x = mouse_x - self.width / 2
        self.x = clamp(new_x, 0.0, float(SCREEN_WIDTH - self.width))

    def handle_input(self) -> None:
        """
        キーボード入力を処理してパドルを移動する。

        pygame.key.get_pressed() を使用して押しっぱなしに対応します。
        """
        keys = pygame.key.get_pressed()
        if keys[pygame.K_LEFT] or keys[pygame.K_a]:
            self.move_left()
        if keys[pygame.K_RIGHT] or keys[pygame.K_d]:
            self.move_right()

    def get_ball_bounce_angle_factor(self, ball_center_x: float) -> float:
        """
        ボールがパドルに当たった位置から反射角係数を計算する。

        パドル中央ほど真上に、端ほど急角度になります。

        Args:
            ball_center_x: ボール中心のX座標

        Returns:
            -1.0 (左端) 〜 +1.0 (右端) の係数
        """
        relative = (ball_center_x - self.x) / self.width
        # 0.0〜1.0 を -1.0〜+1.0 に変換
        return clamp(relative * 2.0 - 1.0, -1.0, 1.0)

    def draw(self, screen: pygame.Surface) -> None:
        """
        パドルを画面に描画する。

        丸みのある矩形とハイライトで立体感を表現します。

        Args:
            screen: 描画先サーフェス
        """
        rect = self.rect

        # パドル本体（角丸矩形）
        pygame.draw.rect(screen, PADDLE_COLOR, rect, border_radius=PADDLE_BORDER_RADIUS)

        # ボーダー（輪郭線）
        pygame.draw.rect(
            screen,
            PADDLE_BORDER_COLOR,
            rect,
            width=2,
            border_radius=PADDLE_BORDER_RADIUS,
        )

        # ハイライト（上部の明るい線）
        highlight_rect = pygame.Rect(
            rect.x + 4,
            rect.y + 3,
            rect.width - 8,
            3,
        )
        if highlight_rect.width > 0:
            pygame.draw.rect(
                screen,
                WHITE,
                highlight_rect,
                border_radius=2,
            )

    def __repr__(self) -> str:
        """デバッグ用の文字列表現を返す。"""
        return (
            f"Paddle(x={self.x:.1f}, y={self.y}, "
            f"width={self.width}, height={self.height})"
        )
