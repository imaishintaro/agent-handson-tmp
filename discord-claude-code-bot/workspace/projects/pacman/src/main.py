"""
パックマンゲーム
Pygameを使用したシンプルなパックマンクローン
"""

import pygame
import sys
from enum import Enum

# 定数定義
CELL_SIZE = 30
MAP_WIDTH = 19
MAP_HEIGHT = 21
SCREEN_WIDTH = CELL_SIZE * MAP_WIDTH
SCREEN_HEIGHT = CELL_SIZE * MAP_HEIGHT + 50  # スコア表示用
FPS = 60

# 色定義
BLACK = (0, 0, 0)
BLUE = (33, 33, 222)
YELLOW = (255, 255, 0)
WHITE = (255, 255, 255)
RED = (255, 0, 0)
PINK = (255, 184, 255)
CYAN = (0, 255, 255)
ORANGE = (255, 184, 82)


class Direction(Enum):
    """移動方向"""
    UP = (0, -1)
    DOWN = (0, 1)
    LEFT = (-1, 0)
    RIGHT = (1, 0)
    STOP = (0, 0)


# マップ定義 (0: 道, 1: 壁, 2: ドット, 3: パワードット)
MAP = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    [1, 3, 1, 1, 2, 1, 1, 1, 2, 1, 2, 1, 1, 1, 2, 1, 1, 3, 1],
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    [1, 2, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 2, 1],
    [1, 2, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 2, 1],
    [1, 1, 1, 1, 2, 1, 1, 1, 0, 1, 0, 1, 1, 1, 2, 1, 1, 1, 1],
    [0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0],
    [1, 1, 1, 1, 2, 1, 0, 1, 1, 0, 1, 1, 0, 1, 2, 1, 1, 1, 1],
    [0, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0],
    [1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2, 1, 1, 1, 1],
    [0, 0, 0, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0],
    [1, 1, 1, 1, 2, 1, 0, 1, 1, 1, 1, 1, 0, 1, 2, 1, 1, 1, 1],
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    [1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1],
    [1, 3, 2, 1, 2, 2, 2, 2, 2, 0, 2, 2, 2, 2, 2, 1, 2, 3, 1],
    [1, 1, 2, 1, 2, 1, 2, 1, 1, 1, 1, 1, 2, 1, 2, 1, 2, 1, 1],
    [1, 2, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 1, 2, 2, 2, 2, 1],
    [1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1],
    [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
]


class Pacman:
    """パックマン（プレイヤー）クラス"""

    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.direction = Direction.STOP
        self.next_direction = Direction.STOP
        self.speed = 2
        self.radius = 12
        self.mouth_angle = 0
        self.mouth_speed = 0.2

    def move(self, game_map):
        """移動処理"""
        # 次の方向に変更可能かチェック
        if self.next_direction != Direction.STOP:
            next_x = self.x + self.next_direction.value[0] * self.speed
            next_y = self.y + self.next_direction.value[1] * self.speed
            if not self._check_wall_collision(next_x, next_y, game_map):
                self.direction = self.next_direction
                self.next_direction = Direction.STOP

        # 現在の方向に移動
        if self.direction != Direction.STOP:
            next_x = self.x + self.direction.value[0] * self.speed
            next_y = self.y + self.direction.value[1] * self.speed

            if not self._check_wall_collision(next_x, next_y, game_map):
                self.x = next_x
                self.y = next_y
            else:
                # 壁に当たったら停止
                self.direction = Direction.STOP

        # 口のアニメーション
        self.mouth_angle += self.mouth_speed
        if self.mouth_angle > 0.3 or self.mouth_angle < 0:
            self.mouth_speed *= -1

    def _check_wall_collision(self, x, y, game_map):
        """壁との衝突判定"""
        # パックマンの周囲4点でチェック
        offsets = [(-self.radius, -self.radius), (self.radius, -self.radius),
                   (-self.radius, self.radius), (self.radius, self.radius)]

        for dx, dy in offsets:
            check_x = int((x + dx) / CELL_SIZE)
            check_y = int((y + dy) / CELL_SIZE)

            if 0 <= check_y < len(game_map) and 0 <= check_x < len(game_map[0]):
                if game_map[check_y][check_x] == 1:
                    return True
        return False

    def draw(self, screen):
        """描画"""
        # 口の開き具合に応じて角度を計算
        start_angle = self.mouth_angle
        end_angle = 6.28 - self.mouth_angle

        # 方向に応じて回転
        rotation = 0
        if self.direction == Direction.UP:
            rotation = 90
        elif self.direction == Direction.DOWN:
            rotation = 270
        elif self.direction == Direction.LEFT:
            rotation = 180
        elif self.direction == Direction.RIGHT:
            rotation = 0

        pygame.draw.circle(screen, YELLOW, (int(self.x), int(self.y)), self.radius)

        # 目（方向を示す）
        eye_offset_x = 4
        eye_offset_y = -4
        if self.direction == Direction.UP:
            eye_offset_x, eye_offset_y = 0, -6
        elif self.direction == Direction.DOWN:
            eye_offset_x, eye_offset_y = 0, 6
        elif self.direction == Direction.LEFT:
            eye_offset_x, eye_offset_y = -6, 0
        elif self.direction == Direction.RIGHT:
            eye_offset_x, eye_offset_y = 6, 0

        pygame.draw.circle(screen, BLACK,
                          (int(self.x + eye_offset_x), int(self.y + eye_offset_y)), 2)


class Ghost:
    """ゴースト（敵）クラス"""

    def __init__(self, x, y, color):
        self.x = x
        self.y = y
        self.color = color
        self.direction = Direction.UP
        self.speed = 1.5
        self.radius = 12
        self.move_counter = 0

    def move(self, game_map, pacman):
        """移動処理（シンプルなAI）"""
        self.move_counter += 1
        if self.move_counter < 10:  # 移動間隔
            return
        self.move_counter = 0

        # ランダムに方向を変更（壁に当たったら）
        directions = [Direction.UP, Direction.DOWN, Direction.LEFT, Direction.RIGHT]

        # 現在の方向に進めるかチェック
        next_x = self.x + self.direction.value[0] * self.speed
        next_y = self.y + self.direction.value[1] * self.speed

        if self._check_wall_collision(next_x, next_y, game_map):
            # 壁に当たったら別の方向を探す
            import random
            random.shuffle(directions)
            for new_dir in directions:
                test_x = self.x + new_dir.value[0] * self.speed
                test_y = self.y + new_dir.value[1] * self.speed
                if not self._check_wall_collision(test_x, test_y, game_map):
                    self.direction = new_dir
                    break
        else:
            # 一定確率で方向を変える
            import random
            if random.random() < 0.1:
                random.shuffle(directions)
                for new_dir in directions:
                    test_x = self.x + new_dir.value[0] * self.speed
                    test_y = self.y + new_dir.value[1] * self.speed
                    if not self._check_wall_collision(test_x, test_y, game_map):
                        self.direction = new_dir
                        break

        # 移動
        next_x = self.x + self.direction.value[0] * self.speed
        next_y = self.y + self.direction.value[1] * self.speed
        if not self._check_wall_collision(next_x, next_y, game_map):
            self.x = next_x
            self.y = next_y

    def _check_wall_collision(self, x, y, game_map):
        """壁との衝突判定"""
        offsets = [(-self.radius, -self.radius), (self.radius, -self.radius),
                   (-self.radius, self.radius), (self.radius, self.radius)]

        for dx, dy in offsets:
            check_x = int((x + dx) / CELL_SIZE)
            check_y = int((y + dy) / CELL_SIZE)

            if 0 <= check_y < len(game_map) and 0 <= check_x < len(game_map[0]):
                if game_map[check_y][check_x] == 1:
                    return True
        return False

    def draw(self, screen):
        """描画"""
        # 体（半円）
        pygame.draw.ellipse(screen, self.color,
                           (int(self.x - self.radius), int(self.y - self.radius),
                            self.radius * 2, self.radius * 2))
        # 下部の波型
        points = []
        for i in range(5):
            angle = i * 0.5
            px = self.x - self.radius + (self.radius * 2 / 4) * i
            py = self.y + self.radius * 0.5 + (3 if i % 2 == 0 else -3)
            points.append((px, py))
        points = [(self.x - self.radius, self.y),
                  (self.x - self.radius, self.y + self.radius * 0.5)] + points + \
                 [(self.x + self.radius, self.y + self.radius * 0.5),
                  (self.x + self.radius, self.y)]
        pygame.draw.polygon(screen, self.color, points)

        # 目
        eye_offset = 4
        pygame.draw.circle(screen, WHITE, (int(self.x - eye_offset), int(self.y - 4)), 4)
        pygame.draw.circle(screen, WHITE, (int(self.x + eye_offset), int(self.y - 4)), 4)
        pygame.draw.circle(screen, BLUE, (int(self.x - eye_offset), int(self.y - 4)), 2)
        pygame.draw.circle(screen, BLUE, (int(self.x + eye_offset), int(self.y - 4)), 2)


class Game:
    """ゲームメインクラス"""

    def __init__(self):
        pygame.init()
        self.screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
        pygame.display.set_caption("パックマン")
        self.clock = pygame.time.Clock()
        self.font = pygame.font.Font(None, 36)
        self.game_over_font = pygame.font.Font(None, 72)

        self.reset_game()

    def reset_game(self):
        """ゲームのリセット"""
        # マップのコピー
        self.game_map = [row[:] for row in MAP]

        # パックマンの初期位置
        self.pacman = Pacman(9 * CELL_SIZE + CELL_SIZE // 2, 15 * CELL_SIZE + CELL_SIZE // 2)

        # ゴーストの初期化
        self.ghosts = [
            Ghost(9 * CELL_SIZE + CELL_SIZE // 2, 9 * CELL_SIZE + CELL_SIZE // 2, RED),
            Ghost(8 * CELL_SIZE + CELL_SIZE // 2, 9 * CELL_SIZE + CELL_SIZE // 2, PINK),
            Ghost(10 * CELL_SIZE + CELL_SIZE // 2, 9 * CELL_SIZE + CELL_SIZE // 2, CYAN),
        ]

        self.score = 0
        self.game_over = False
        self.win = False

    def handle_events(self):
        """イベント処理"""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False

            if event.type == pygame.KEYDOWN:
                if self.game_over or self.win:
                    if event.key == pygame.K_r:
                        self.reset_game()
                    continue

                if event.key == pygame.K_UP:
                    self.pacman.next_direction = Direction.UP
                elif event.key == pygame.K_DOWN:
                    self.pacman.next_direction = Direction.DOWN
                elif event.key == pygame.K_LEFT:
                    self.pacman.next_direction = Direction.LEFT
                elif event.key == pygame.K_RIGHT:
                    self.pacman.next_direction = Direction.RIGHT

        return True

    def update(self):
        """ゲームの更新"""
        if self.game_over or self.win:
            return

        # パックマンの移動
        self.pacman.move(self.game_map)

        # ゴーストの移動
        for ghost in self.ghosts:
            ghost.move(self.game_map, self.pacman)

        # ドットを食べる
        map_x = int(self.pacman.x / CELL_SIZE)
        map_y = int(self.pacman.y / CELL_SIZE)

        if 0 <= map_y < len(self.game_map) and 0 <= map_x < len(self.game_map[0]):
            if self.game_map[map_y][map_x] == 2:  # 通常ドット
                self.game_map[map_y][map_x] = 0
                self.score += 10
            elif self.game_map[map_y][map_x] == 3:  # パワードット
                self.game_map[map_y][map_x] = 0
                self.score += 50

        # ゴーストとの衝突判定
        for ghost in self.ghosts:
            dist = ((self.pacman.x - ghost.x) ** 2 + (self.pacman.y - ghost.y) ** 2) ** 0.5
            if dist < self.pacman.radius + ghost.radius:
                self.game_over = True
                return

        # 全ドットを食べたかチェック
        dots_remaining = sum(row.count(2) + row.count(3) for row in self.game_map)
        if dots_remaining == 0:
            self.win = True

    def draw_map(self):
        """マップの描画"""
        for y, row in enumerate(self.game_map):
            for x, cell in enumerate(row):
                rect = pygame.Rect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE)

                if cell == 1:  # 壁
                    pygame.draw.rect(self.screen, BLUE, rect)
                    # 壁の枠線
                    pygame.draw.rect(self.screen, (0, 0, 100), rect, 2)
                elif cell == 2:  # ドット
                    pygame.draw.circle(self.screen, WHITE,
                                     (x * CELL_SIZE + CELL_SIZE // 2,
                                      y * CELL_SIZE + CELL_SIZE // 2), 3)
                elif cell == 3:  # パワードット
                    pygame.draw.circle(self.screen, WHITE,
                                     (x * CELL_SIZE + CELL_SIZE // 2,
                                      y * CELL_SIZE + CELL_SIZE // 2), 6)

    def draw(self):
        """描画処理"""
        self.screen.fill(BLACK)

        # マップ描画
        self.draw_map()

        # ゴースト描画
        for ghost in self.ghosts:
            ghost.draw(self.screen)

        # パックマン描画
        self.pacman.draw(self.screen)

        # スコア表示
        score_text = self.font.render(f"Score: {self.score}", True, WHITE)
        self.screen.blit(score_text, (10, SCREEN_HEIGHT - 40))

        # ゲームオーバー表示
        if self.game_over:
            text = self.game_over_font.render("GAME OVER", True, RED)
            text_rect = text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2))
            self.screen.blit(text, text_rect)

            restart_text = self.font.render("Press R to restart", True, WHITE)
            restart_rect = restart_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 50))
            self.screen.blit(restart_text, restart_rect)

        # 勝利表示
        if self.win:
            text = self.game_over_font.render("YOU WIN!", True, YELLOW)
            text_rect = text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2))
            self.screen.blit(text, text_rect)

            restart_text = self.font.render("Press R to restart", True, WHITE)
            restart_rect = restart_text.get_rect(center=(SCREEN_WIDTH // 2, SCREEN_HEIGHT // 2 + 50))
            self.screen.blit(restart_text, restart_rect)

        pygame.display.flip()

    def run(self):
        """ゲームループ"""
        running = True
        while running:
            running = self.handle_events()
            self.update()
            self.draw()
            self.clock.tick(FPS)

        pygame.quit()
        sys.exit()


if __name__ == "__main__":
    game = Game()
    game.run()
