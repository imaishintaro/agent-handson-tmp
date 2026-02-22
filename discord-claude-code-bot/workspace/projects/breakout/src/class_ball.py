"""
ブロック崩しゲーム ボールクラス

ボールの描画・移動・壁反射・パドル反射を管理します。
"""

import math
import pygame
from typing import Tuple

from func_utils import (
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    HUD_HEIGHT,
    BALL_RADIUS,
    BALL_INITIAL_SPEED,
    BALL_MAX_SPEED,
    BALL_SPEED_INCREMENT,
    BALL_COLOR,
    BALL_BORDER_COLOR,
    WHITE,
    clamp,
)


class Ball:
    """
    ボールクラス。

    物理的な移動・反射と描画を担当します。
    ボールがパドルに当たった位置に応じて反射角度が変わります。

    Attributes:
        x (float): ボール中心のX座標
        y (float): ボール中心のY座標
        vx (float): X方向の速度 (px/frame)
        vy (float): Y方向の速度 (px/frame)
        radius (int): ボールの半径
        speed (float): ボールの現在速度 (スカラー)
        active (bool): ボールが動いているかどうか
    """

    def __init__(self) -> None:
        """ボールをパドル上の中央位置に初期化する。"""
        self.radius: int = BALL_RADIUS
        self.speed: float = BALL_INITIAL_SPEED
        self.active: bool = False  # Falseの間はパドルに乗っている

        # 初期位置はリセット時に設定
        self.x: float = SCREEN_WIDTH / 2
        self.y: float = SCREEN_HEIGHT / 2
        self.vx: float = 0.0
        self.vy: float = 0.0

        # トレイルエフェクト用の履歴
        self._trail: list[Tuple[float, float]] = []
        self._trail_max_len: int = 6

    def reset(self, paddle_center_x: float, paddle_top_y: int) -> None:
        """
        ボールをパドルの上に配置してリセットする。

        Args:
            paddle_center_x: パドル中心のX座標
            paddle_top_y: パドル上端のY座標
        """
        self.x = paddle_center_x
        self.y = float(paddle_top_y - self.radius - 1)
        self.vx = 0.0
        self.vy = 0.0
        self.speed = BALL_INITIAL_SPEED
        self.active = False
        self._trail = []

    def launch(self) -> None:
        """
        ボールを斜め上に発射する。

        vx はわずかに右寄りに設定し、vy は上向き（負）になります。
        """
        if self.active:
            return

        # 発射角度: 垂直から15度右
        angle_rad = math.radians(75)  # 水平から75度 = 垂直から15度
        self.vx = self.speed * math.cos(angle_rad)
        self.vy = -self.speed * math.sin(angle_rad)
        self.active = True

    def increase_speed(self) -> None:
        """
        ブロック破壊時にボール速度を増加させる。

        最大速度 BALL_MAX_SPEED を超えないよう制限します。
        """
        self.speed = min(self.speed + BALL_SPEED_INCREMENT, BALL_MAX_SPEED)
        # 現在の速度方向を維持しながらスカラー速度を更新
        current_mag = math.hypot(self.vx, self.vy)
        if current_mag > 0:
            scale = self.speed / current_mag
            self.vx *= scale
            self.vy *= scale

    def update(self, paddle_center_x: float, paddle_top_y: int) -> bool:
        """
        ボールを1フレーム分進める。

        非アクティブ時はパドルに追従します。

        Args:
            paddle_center_x: パドル中心のX座標（非アクティブ時の追従用）
            paddle_top_y: パドル上端のY座標（非アクティブ時の追従用）

        Returns:
            False ならボールが画面下に落ちた（ライフ消費）、True なら継続
        """
        if not self.active:
            # パドルに乗った状態で追従
            self.x = paddle_center_x
            self.y = float(paddle_top_y - self.radius - 1)
            return True

        # トレイル履歴を更新
        self._trail.append((self.x, self.y))
        if len(self._trail) > self._trail_max_len:
            self._trail.pop(0)

        # 移動
        self.x += self.vx
        self.y += self.vy

        # 左右の壁との反射
        if self.x - self.radius <= 0:
            self.x = float(self.radius)
            self.vx = abs(self.vx)  # 右方向に反転

        elif self.x + self.radius >= SCREEN_WIDTH:
            self.x = float(SCREEN_WIDTH - self.radius)
            self.vx = -abs(self.vx)  # 左方向に反転

        # 上の壁との反射
        if self.y - self.radius <= HUD_HEIGHT:
            self.y = float(HUD_HEIGHT + self.radius)
            self.vy = abs(self.vy)  # 下方向に反転

        # 画面下への落下判定
        if self.y - self.radius > SCREEN_HEIGHT:
            return False  # ライフ消費

        return True

    def bounce_off_paddle(self, factor: float) -> None:
        """
        パドルに当たったときの反射処理。

        factor に応じて反射角度を変化させます。
        パドル端ほど急な斜め反射になります。

        Args:
            factor: パドルの当たり位置の係数 (-1.0〜+1.0)
        """
        # 最大反射角度: 60度
        max_angle_deg = 60.0
        angle_deg = factor * max_angle_deg
        angle_rad = math.radians(90.0 - angle_deg)  # 垂直からのずれ

        # vy は必ず上向き（負）
        self.vy = -self.speed * math.sin(angle_rad)
        self.vx = self.speed * math.cos(angle_rad) * (1 if factor >= 0 else -1)

        # Y座標をパドル上端の外に出してめり込みを防ぐ（呼び出し側で設定済の場合もある）
        self.vy = -abs(self.vy)  # 必ず上向き

    def bounce_horizontal(self) -> None:
        """
        X方向の速度を反転させる（左右面での反射）。
        """
        self.vx = -self.vx

    def bounce_vertical(self) -> None:
        """
        Y方向の速度を反転させる（上下面での反射）。
        """
        self.vy = -self.vy

    @property
    def rect(self) -> pygame.Rect:
        """
        衝突判定用の外接矩形を返す。

        Returns:
            ボールの外接矩形
        """
        return pygame.Rect(
            int(self.x - self.radius),
            int(self.y - self.radius),
            self.radius * 2,
            self.radius * 2,
        )

    def collides_with(self, rect: pygame.Rect) -> bool:
        """
        矩形との衝突判定（円と矩形の精密判定）。

        Args:
            rect: 判定対象の矩形

        Returns:
            衝突していれば True
        """
        # 矩形内で最もボール中心に近い点を求める
        closest_x = clamp(self.x, float(rect.left), float(rect.right))
        closest_y = clamp(self.y, float(rect.top), float(rect.bottom))
        dist_sq = (self.x - closest_x) ** 2 + (self.y - closest_y) ** 2
        return dist_sq <= self.radius ** 2

    def resolve_collision_direction(self, rect: pygame.Rect) -> str:
        """
        矩形との衝突方向を推定する。

        衝突面（上・下・左・右）のいずれかを返します。

        Args:
            rect: 衝突した矩形

        Returns:
            'top' | 'bottom' | 'left' | 'right'
        """
        # ボール中心から矩形の各辺への距離を計算
        dist_top = abs(self.y - rect.top)
        dist_bottom = abs(self.y - rect.bottom)
        dist_left = abs(self.x - rect.left)
        dist_right = abs(self.x - rect.right)

        min_dist = min(dist_top, dist_bottom, dist_left, dist_right)

        if min_dist == dist_top:
            return "top"
        elif min_dist == dist_bottom:
            return "bottom"
        elif min_dist == dist_left:
            return "left"
        else:
            return "right"

    def draw(self, screen: pygame.Surface) -> None:
        """
        ボールをトレイル付きで画面に描画する。

        Args:
            screen: 描画先サーフェス
        """
        # トレイル（残像）の描画
        trail_len = len(self._trail)
        for i, (tx, ty) in enumerate(self._trail):
            # 古いほど小さく・薄くなる
            alpha_ratio = (i + 1) / max(trail_len, 1)
            trail_radius = max(2, int(self.radius * alpha_ratio * 0.7))
            alpha = int(180 * alpha_ratio)
            # サーフェスにアルファ描画
            trail_surf = pygame.Surface(
                (trail_radius * 2, trail_radius * 2), pygame.SRCALPHA
            )
            trail_color = (*BALL_COLOR, alpha)
            pygame.draw.circle(
                trail_surf,
                trail_color,
                (trail_radius, trail_radius),
                trail_radius,
            )
            screen.blit(trail_surf, (int(tx) - trail_radius, int(ty) - trail_radius))

        # ボール本体
        cx = int(self.x)
        cy = int(self.y)
        pygame.draw.circle(screen, BALL_COLOR, (cx, cy), self.radius)

        # ボーダー
        pygame.draw.circle(screen, BALL_BORDER_COLOR, (cx, cy), self.radius, width=2)

        # ハイライト（左上の光沢）
        highlight_offset = self.radius // 3
        pygame.draw.circle(
            screen,
            WHITE,
            (cx - highlight_offset, cy - highlight_offset),
            max(2, self.radius // 4),
        )

    def __repr__(self) -> str:
        """デバッグ用の文字列表現を返す。"""
        return (
            f"Ball(x={self.x:.1f}, y={self.y:.1f}, "
            f"vx={self.vx:.2f}, vy={self.vy:.2f}, "
            f"speed={self.speed:.2f}, active={self.active})"
        )
