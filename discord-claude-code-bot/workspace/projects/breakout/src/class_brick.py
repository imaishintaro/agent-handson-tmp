"""
ブロック崩しゲーム ブロッククラス / ブロックグリッドクラス

個々のブロック（Brick）とブロック全体の配置管理（BrickGrid）を担当します。
"""

import pygame
from typing import Optional, Tuple, List

from func_utils import (
    BRICK_COLS,
    BRICK_ROWS,
    BRICK_WIDTH,
    BRICK_HEIGHT,
    BRICK_PADDING,
    BRICK_BORDER_RADIUS,
    BRICK_ROW_CONFIG,
    BRICK_DAMAGED_COLOR,
    WHITE,
    BLACK,
    compute_brick_pixel_x,
    compute_brick_pixel_y,
)


class Brick:
    """
    個々のブロックを表すクラス。

    耐久度（durability）を持ち、ダメージを受けると色が変わり、
    耐久度が0になると破壊されます。

    Attributes:
        row (int): 行インデックス (0 始まり)
        col (int): 列インデックス (0 始まり)
        color (tuple): 通常状態の色 (R, G, B)
        points (int): 破壊時の獲得ポイント
        durability (int): 残り耐久度
        max_durability (int): 最大耐久度
        alive (bool): ブロックが残存しているか
        rect (pygame.Rect): 描画・衝突判定用の矩形
    """

    def __init__(
        self,
        row: int,
        col: int,
        color: Tuple[int, int, int],
        points: int,
        durability: int,
    ) -> None:
        """
        ブロックを初期化する。

        Args:
            row: 行インデックス
            col: 列インデックス
            color: ブロックの色
            points: 破壊時の獲得ポイント
            durability: 初期耐久度
        """
        self.row: int = row
        self.col: int = col
        self.color: Tuple[int, int, int] = color
        self.points: int = points
        self.durability: int = durability
        self.max_durability: int = durability
        self.alive: bool = True

        # ピクセル座標に変換して矩形を確定
        pixel_x = compute_brick_pixel_x(col)
        pixel_y = compute_brick_pixel_y(row)
        self.rect: pygame.Rect = pygame.Rect(pixel_x, pixel_y, BRICK_WIDTH, BRICK_HEIGHT)

        # アニメーション用（ヒット時の点滅）
        self._hit_flash_timer: int = 0
        self._hit_flash_duration: int = 6  # フレーム数

    def hit(self) -> int:
        """
        ブロックにダメージを与える。

        耐久度が0になるとブロックを破壊します。

        Returns:
            このブロックで得られたポイント（破壊されなければ0）
        """
        if not self.alive:
            return 0

        self.durability -= 1
        self._hit_flash_timer = self._hit_flash_duration

        if self.durability <= 0:
            self.alive = False
            return self.points
        return 0

    @property
    def current_color(self) -> Tuple[int, int, int]:
        """
        現在の表示色を返す。

        耐久度が最大より低い場合はダメージカラーを返します。

        Returns:
            現在の色 (R, G, B)
        """
        if self.durability < self.max_durability:
            return BRICK_DAMAGED_COLOR
        return self.color

    def update(self) -> None:
        """
        ブロックの状態を1フレーム更新する（アニメーション処理）。
        """
        if self._hit_flash_timer > 0:
            self._hit_flash_timer -= 1

    def draw(self, screen: pygame.Surface) -> None:
        """
        ブロックを画面に描画する。

        Args:
            screen: 描画先サーフェス
        """
        if not self.alive:
            return

        # ヒット時の点滅（フラッシュ）
        is_flashing = (
            self._hit_flash_timer > 0
            and self._hit_flash_timer % 2 == 1
        )
        draw_color = WHITE if is_flashing else self.current_color

        # ブロック本体（角丸矩形）
        pygame.draw.rect(
            screen,
            draw_color,
            self.rect,
            border_radius=BRICK_BORDER_RADIUS,
        )

        # ボーダー（輪郭線）
        border_color = _darken_color(draw_color, factor=0.6)
        pygame.draw.rect(
            screen,
            border_color,
            self.rect,
            width=2,
            border_radius=BRICK_BORDER_RADIUS,
        )

        # ハイライト（上部の光沢線）
        highlight_rect = pygame.Rect(
            self.rect.x + 4,
            self.rect.y + 3,
            self.rect.width - 8,
            3,
        )
        if highlight_rect.width > 0:
            highlight_color = _lighten_color(draw_color, factor=0.4)
            pygame.draw.rect(
                screen,
                highlight_color,
                highlight_rect,
                border_radius=1,
            )

        # 耐久度インジケーター（耐久度2以上の場合に小丸を表示）
        if self.durability >= 2:
            dot_x = self.rect.right - 8
            dot_y = self.rect.centery
            pygame.draw.circle(screen, WHITE, (dot_x, dot_y), 3)

    def __repr__(self) -> str:
        """デバッグ用の文字列表現を返す。"""
        return (
            f"Brick(row={self.row}, col={self.col}, "
            f"durability={self.durability}, alive={self.alive})"
        )


class BrickGrid:
    """
    ブロック全体の配置を管理するクラス。

    BRICK_ROW_CONFIG に基づいてブロックを自動配置し、
    衝突判定・破壊管理・描画を一括で行います。

    Attributes:
        bricks (List[List[Optional[Brick]]]): 2次元リストのブロックグリッド
        total_bricks (int): 初期ブロック総数
        destroyed_count (int): 破壊済みブロック数
    """

    def __init__(self) -> None:
        """ブロックグリッドを設定に従って初期化する。"""
        self.bricks: List[List[Optional[Brick]]] = []
        self.total_bricks: int = 0
        self.destroyed_count: int = 0
        self._build_grid()

    def _build_grid(self) -> None:
        """
        BRICK_ROW_CONFIG に基づいてブロックグリッドを構築する。
        """
        self.bricks = []
        self.total_bricks = 0
        self.destroyed_count = 0

        for row in range(BRICK_ROWS):
            row_bricks: List[Optional[Brick]] = []
            # 行インデックスが設定数を超えた場合は最後の設定を使用
            config_idx = min(row, len(BRICK_ROW_CONFIG) - 1)
            color, points, durability = BRICK_ROW_CONFIG[config_idx]

            for col in range(BRICK_COLS):
                brick = Brick(
                    row=row,
                    col=col,
                    color=color,
                    points=points,
                    durability=durability,
                )
                row_bricks.append(brick)
                self.total_bricks += 1

            self.bricks.append(row_bricks)

    def reset(self) -> None:
        """ブロックグリッドを初期状態に再構築する。"""
        self._build_grid()

    @property
    def remaining_count(self) -> int:
        """
        残存ブロック数を返す。

        Returns:
            生存しているブロックの数
        """
        return self.total_bricks - self.destroyed_count

    @property
    def is_all_destroyed(self) -> bool:
        """
        全ブロックが破壊されたかどうかを返す。

        Returns:
            全破壊なら True
        """
        return self.destroyed_count >= self.total_bricks

    def update(self) -> None:
        """
        全ブロックの状態を1フレーム更新する。
        """
        for row in self.bricks:
            for brick in row:
                if brick is not None and brick.alive:
                    brick.update()

    def check_collision(self, ball: object) -> int:
        """
        ボールと全ブロックの衝突判定を行い、スコアを返す。

        衝突したブロックにダメージを与え、反射方向を決定します。
        1フレームで複数ブロックに同時衝突した場合も処理します。

        Args:
            ball: Ball インスタンス（duck typing で使用）

        Returns:
            このフレームで得られた合計ポイント
        """
        total_score = 0
        collided_bricks: List[Brick] = []

        # 衝突したブロックを全て収集
        for row in self.bricks:
            for brick in row:
                if brick is None or not brick.alive:
                    continue
                if ball.collides_with(brick.rect):
                    collided_bricks.append(brick)

        if not collided_bricks:
            return 0

        # 最初に衝突したブロックの方向で反射を決定
        # 複数衝突時は最も近いブロックの向きを優先
        closest_brick = min(
            collided_bricks,
            key=lambda b: (
                (ball.x - b.rect.centerx) ** 2
                + (ball.y - b.rect.centery) ** 2
            ),
        )

        direction = ball.resolve_collision_direction(closest_brick.rect)
        if direction in ("top", "bottom"):
            ball.bounce_vertical()
        else:
            ball.bounce_horizontal()

        # 全衝突ブロックにダメージを与える
        for brick in collided_bricks:
            score = brick.hit()
            if score > 0:
                self.destroyed_count += 1
                total_score += score
                # ブロック破壊時にボール速度増加
                ball.increase_speed()

        return total_score

    def draw(self, screen: pygame.Surface) -> None:
        """
        全生存ブロックを画面に描画する。

        Args:
            screen: 描画先サーフェス
        """
        for row in self.bricks:
            for brick in row:
                if brick is not None and brick.alive:
                    brick.draw(screen)

    def __repr__(self) -> str:
        """デバッグ用の文字列表現を返す。"""
        return (
            f"BrickGrid(total={self.total_bricks}, "
            f"destroyed={self.destroyed_count}, "
            f"remaining={self.remaining_count})"
        )


# =========================================================
# モジュール内部ヘルパー関数
# =========================================================


def _darken_color(
    color: Tuple[int, int, int], factor: float = 0.7
) -> Tuple[int, int, int]:
    """
    色を暗くする。

    Args:
        color: 元の色 (R, G, B)
        factor: 暗くする係数 (0.0 = 黒, 1.0 = そのまま)

    Returns:
        暗くした色 (R, G, B)
    """
    r = int(color[0] * factor)
    g = int(color[1] * factor)
    b = int(color[2] * factor)
    return (
        max(0, min(255, r)),
        max(0, min(255, g)),
        max(0, min(255, b)),
    )


def _lighten_color(
    color: Tuple[int, int, int], factor: float = 0.4
) -> Tuple[int, int, int]:
    """
    色を明るくする。

    Args:
        color: 元の色 (R, G, B)
        factor: 白に近づける割合 (0.0 = そのまま, 1.0 = 白)

    Returns:
        明るくした色 (R, G, B)
    """
    r = int(color[0] + (255 - color[0]) * factor)
    g = int(color[1] + (255 - color[1]) * factor)
    b = int(color[2] + (255 - color[2]) * factor)
    return (
        max(0, min(255, r)),
        max(0, min(255, g)),
        max(0, min(255, b)),
    )
