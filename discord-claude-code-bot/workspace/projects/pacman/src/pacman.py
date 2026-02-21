import pygame
import sys
from enum import Enum

# 定数
CELL_SIZE = 20
MAZE_WIDTH = 28
MAZE_HEIGHT = 31
SCREEN_WIDTH = CELL_SIZE * MAZE_WIDTH
SCREEN_HEIGHT = CELL_SIZE * MAZE_HEIGHT
FPS = 60

# 色
BLACK = (0, 0, 0)
YELLOW = (255, 255, 0)
BLUE = (0, 0, 255)
WHITE = (255, 255, 255)
RED = (255, 0, 0)
PINK = (255, 192, 203)
CYAN = (0, 255, 255)
ORANGE = (255, 165, 0)

class Direction(Enum):
    """移動方向"""
    UP = (0, -1)
    DOWN = (0, 1)
    LEFT = (-1, 0)
    RIGHT = (1, 0)
    STOP = (0, 0)

class Pacman:
    """パックマンクラス"""
    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.direction = Direction.STOP
        self.speed = 2
        self.radius = CELL_SIZE // 2 - 2
        self.angle = 0

    def move(self, maze):
        """移動処理"""
        if self.direction == Direction.STOP:
            return

        dx, dy = self.direction.value
        new_x = self.x + dx * self.speed
        new_y = self.y + dy * self.speed

        # 壁との衝突判定
        if not self.check_collision(new_x, new_y, maze):
            self.x = new_x
            self.y = new_y

        # 画面端のワープ
        if self.x < 0:
            self.x = SCREEN_WIDTH - CELL_SIZE
        elif self.x > SCREEN_WIDTH - CELL_SIZE:
            self.x = 0

    def check_collision(self, x, y, maze):
        """壁との衝突チェック"""
        # パックマンの周囲のセルをチェック
        left = int(x) // CELL_SIZE
        top = int(y) // CELL_SIZE
        right = int(x + CELL_SIZE - 1) // CELL_SIZE
        bottom = int(y + CELL_SIZE - 1) // CELL_SIZE

        for row in [top, bottom]:
            for col in [left, right]:
                if 0 <= row < MAZE_HEIGHT and 0 <= col < MAZE_WIDTH:
                    if maze[row][col] == 1:
                        return True
        return False

    def draw(self, screen):
        """描画処理"""
        center_x = int(self.x + CELL_SIZE // 2)
        center_y = int(self.y + CELL_SIZE // 2)

        # 口の角度を方向に応じて変更
        if self.direction == Direction.RIGHT:
            start_angle = self.angle
            end_angle = 360 - self.angle
        elif self.direction == Direction.LEFT:
            start_angle = 180 + self.angle
            end_angle = 180 - self.angle
        elif self.direction == Direction.UP:
            start_angle = 270 + self.angle
            end_angle = 270 - self.angle
        elif self.direction == Direction.DOWN:
            start_angle = 90 + self.angle
            end_angle = 90 - self.angle
        else:
            start_angle = self.angle
            end_angle = 360 - self.angle

        pygame.draw.circle(screen, YELLOW, (center_x, center_y), self.radius)

        # 口を描く（黒で塗りつぶし）
        if self.direction != Direction.STOP:
            points = [
                (center_x, center_y),
                (
                    center_x + self.radius * 2 * 0.6 * pygame.math.Vector2(1, 0).rotate(start_angle).x,
                    center_y + self.radius * 2 * 0.6 * pygame.math.Vector2(1, 0).rotate(start_angle).y
                ),
                (
                    center_x + self.radius * 2 * 0.6 * pygame.math.Vector2(1, 0).rotate(end_angle).x,
                    center_y + self.radius * 2 * 0.6 * pygame.math.Vector2(1, 0).rotate(end_angle).y
                )
            ]
            pygame.draw.polygon(screen, BLACK, points)

    def set_direction(self, direction):
        """方向を設定"""
        self.direction = direction
