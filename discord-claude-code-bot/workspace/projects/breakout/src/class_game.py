"""
ブロック崩しゲーム ゲームクラス

ゲームループ・状態管理・HUD描画・各オブジェクトの統合を担当します。
"""

import sys
import pygame
from typing import Optional

from func_utils import (
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
    FPS,
    HUD_HEIGHT,
    WINDOW_TITLE,
    INITIAL_LIVES,
    BG_COLOR,
    BG_GRID_COLOR,
    BLACK,
    WHITE,
    YELLOW,
    RED,
    GREEN,
    GRAY,
    TEXT_COLOR,
    TEXT_HIGHLIGHT_COLOR,
    PADDLE_COLOR,
    BALL_COLOR,
    HUD_FONT_SIZE,
    TITLE_FONT_SIZE,
    SUBTITLE_FONT_SIZE,
    INFO_FONT_SIZE,
    GameState,
)
from class_paddle import Paddle
from class_ball import Ball
from class_brick import BrickGrid


class Game:
    """
    ブロック崩しゲームのメインクラス。

    pygame の初期化からゲームループ・終了までの全処理を管理します。
    状態機械（GameState）で画面遷移を制御します。

    Attributes:
        screen (pygame.Surface): 描画先サーフェス
        clock (pygame.time.Clock): フレームレート制御
        state (GameState): 現在のゲーム状態
        score (int): 現在のスコア
        high_score (int): ハイスコア（セッション内）
        lives (int): 残りライフ数
        level (int): 現在のレベル
        paddle (Paddle): パドルオブジェクト
        ball (Ball): ボールオブジェクト
        brick_grid (BrickGrid): ブロックグリッドオブジェクト
    """

    def __init__(self) -> None:
        """pygame を初期化し、ゲームを開始状態に設定する。"""
        pygame.init()
        pygame.display.set_caption(WINDOW_TITLE)

        # ディスプレイ設定
        self.screen: pygame.Surface = pygame.display.set_mode(
            (SCREEN_WIDTH, SCREEN_HEIGHT)
        )
        self.clock: pygame.time.Clock = pygame.time.Clock()

        # フォントの準備（日本語フォントを優先、なければデフォルト）
        self._init_fonts()

        # ゲームオブジェクトの生成
        self.paddle: Paddle = Paddle()
        self.ball: Ball = Ball()
        self.brick_grid: BrickGrid = BrickGrid()

        # ゲーム変数
        self.state: GameState = GameState.TITLE
        self.score: int = 0
        self.high_score: int = 0
        self.lives: int = INITIAL_LIVES
        self.level: int = 1

        # アニメーション用タイマー
        self._ball_lost_timer: int = 0
        self._ball_lost_delay: int = 90   # ボール消失後の待機フレーム数
        self._title_blink_timer: int = 0  # タイトルのブリンクタイマー

    def _init_fonts(self) -> None:
        """
        フォントを初期化する。

        日本語フォントが利用可能な場合はそれを使用します。
        """
        # システム日本語フォントを探す
        jp_fonts = [
            "hiraginosans-w3",
            "hiragino sans",
            "meiryoui",
            "meiryo",
            "yugothicui",
            "notosanscjkjp",
        ]
        jp_font_path: Optional[str] = None
        for font_name in jp_fonts:
            jp_font_path = pygame.font.match_font(font_name)
            if jp_font_path:
                break

        def make_font(size: int) -> pygame.font.Font:
            if jp_font_path:
                try:
                    return pygame.font.Font(jp_font_path, size)
                except (FileNotFoundError, OSError):
                    # フォントファイルが存在しない場合はデフォルトフォントを使用
                    pass
            return pygame.font.Font(None, size)

        self._font_hud: pygame.font.Font = make_font(HUD_FONT_SIZE)
        self._font_title: pygame.font.Font = make_font(TITLE_FONT_SIZE)
        self._font_subtitle: pygame.font.Font = make_font(SUBTITLE_FONT_SIZE)
        self._font_info: pygame.font.Font = make_font(INFO_FONT_SIZE)

    # =========================================================
    # ゲームセットアップ
    # =========================================================

    def _new_game(self) -> None:
        """
        新しいゲームを開始する（スコア・ライフをリセット）。
        """
        self.score = 0
        self.lives = INITIAL_LIVES
        self.level = 1
        self._start_level()

    def _start_level(self) -> None:
        """
        現在のレベルをセットアップする（ブロック・パドル・ボールをリセット）。
        """
        self.brick_grid.reset()
        self.paddle.reset()
        self.ball.reset(self.paddle.center_x, self.paddle.rect.top)
        self.state = GameState.PLAYING

    def _next_level(self) -> None:
        """
        次のレベルに進む。

        現在は無限ループ（レベルが上がるたびにブロックを再配置）。
        """
        self.level += 1
        self._start_level()

    # =========================================================
    # イベント処理
    # =========================================================

    def _handle_events(self) -> bool:
        """
        pygame イベントを処理する。

        Returns:
            False ならアプリ終了、True なら継続
        """
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                return False

            if event.type == pygame.KEYDOWN:
                if not self._handle_keydown(event.key):
                    return False

            if event.type == pygame.MOUSEMOTION:
                self._handle_mouse_motion(event.pos[0])

        return True

    def _handle_keydown(self, key: int) -> bool:
        """
        キーダウンイベントを処理する。

        Args:
            key: 押されたキーのコード

        Returns:
            False ならアプリ終了
        """
        if key == pygame.K_ESCAPE:
            return False

        # タイトル画面
        if self.state == GameState.TITLE:
            if key in (pygame.K_SPACE, pygame.K_RETURN):
                self._new_game()

        # プレイ中
        elif self.state == GameState.PLAYING:
            if key == pygame.K_SPACE:
                if not self.ball.active:
                    self.ball.launch()
            elif key == pygame.K_p:
                self.state = GameState.PAUSED

        # 一時停止中
        elif self.state == GameState.PAUSED:
            if key in (pygame.K_p, pygame.K_SPACE):
                self.state = GameState.PLAYING

        # ボール消失待ち
        elif self.state == GameState.BALL_LOST:
            if key == pygame.K_SPACE and self._ball_lost_timer <= 0:
                self._respawn_ball()

        # ゲームオーバー
        elif self.state == GameState.GAME_OVER:
            if key in (pygame.K_SPACE, pygame.K_RETURN):
                self.state = GameState.TITLE

        # クリア
        elif self.state == GameState.CLEAR:
            if key in (pygame.K_SPACE, pygame.K_RETURN):
                self._next_level()

        return True

    def _handle_mouse_motion(self, mouse_x: int) -> None:
        """
        マウス移動でパドルを操作する。

        Args:
            mouse_x: マウスのX座標
        """
        if self.state == GameState.PLAYING:
            self.paddle.move_to_mouse(mouse_x)

    # =========================================================
    # ゲーム更新
    # =========================================================

    def _update(self) -> None:
        """
        ゲーム状態を1フレーム更新する。
        """
        if self.state == GameState.PLAYING:
            self._update_playing()
        elif self.state == GameState.BALL_LOST:
            self._update_ball_lost()
        elif self.state == GameState.TITLE:
            self._title_blink_timer += 1

    def _update_playing(self) -> None:
        """
        プレイ中の更新処理。
        """
        # キーボード入力によるパドル移動
        self.paddle.handle_input()

        # ボールの更新
        ball_alive = self.ball.update(
            self.paddle.center_x,
            self.paddle.rect.top,
        )

        if not ball_alive:
            # ボールが落下 -> ライフ減少
            self._on_ball_lost()
            return

        # パドルとの衝突判定（ボールがアクティブな場合のみ）
        if self.ball.active:
            self._check_paddle_collision()

        # ブロックとの衝突判定
        score_gained = self.brick_grid.check_collision(self.ball)
        self.score += score_gained

        # ハイスコア更新
        if self.score > self.high_score:
            self.high_score = self.score

        # ブロックの状態更新（アニメーション）
        self.brick_grid.update()

        # 全ブロック破壊チェック
        if self.brick_grid.is_all_destroyed:
            self.state = GameState.CLEAR

    def _check_paddle_collision(self) -> None:
        """
        ボールとパドルの衝突判定・反射処理。
        """
        if not self.ball.collides_with(self.paddle.rect):
            return

        # ボールがパドルより上に来るように位置補正
        self.ball.y = float(self.paddle.rect.top - self.ball.radius - 1)

        # 当たった位置に応じた反射
        factor = self.paddle.get_ball_bounce_angle_factor(self.ball.x)
        self.ball.bounce_off_paddle(factor)

    def _on_ball_lost(self) -> None:
        """
        ボール消失時の処理。ライフを減らし状態を遷移する。
        """
        self.lives -= 1

        if self.lives <= 0:
            self.state = GameState.GAME_OVER
        else:
            self.state = GameState.BALL_LOST
            self._ball_lost_timer = self._ball_lost_delay
            # パドルをリセットしてボールを乗せる
            self.paddle.reset()
            self.ball.reset(self.paddle.center_x, self.paddle.rect.top)

    def _update_ball_lost(self) -> None:
        """
        ボール消失状態のタイマー更新。
        """
        if self._ball_lost_timer > 0:
            self._ball_lost_timer -= 1

    def _respawn_ball(self) -> None:
        """
        ボール消失後に再スポーンしてプレイを再開する。
        """
        self.ball.reset(self.paddle.center_x, self.paddle.rect.top)
        self.state = GameState.PLAYING

    # =========================================================
    # 描画
    # =========================================================

    def _draw(self) -> None:
        """
        現在の状態に応じた描画処理を行う。
        """
        # 背景
        self._draw_background()

        if self.state == GameState.TITLE:
            self._draw_title_screen()
        elif self.state in (GameState.PLAYING, GameState.PAUSED, GameState.BALL_LOST):
            self._draw_game()
            if self.state == GameState.PAUSED:
                self._draw_pause_overlay()
            elif self.state == GameState.BALL_LOST:
                self._draw_ball_lost_overlay()
        elif self.state == GameState.GAME_OVER:
            self._draw_game()
            self._draw_game_over_overlay()
        elif self.state == GameState.CLEAR:
            self._draw_game()
            self._draw_clear_overlay()

        pygame.display.flip()

    def _draw_background(self) -> None:
        """
        背景とグリッドパターンを描画する。
        """
        self.screen.fill(BG_COLOR)

        # 薄いグリッドラインを描画（装飾）
        grid_spacing = 50
        for x in range(0, SCREEN_WIDTH, grid_spacing):
            pygame.draw.line(self.screen, BG_GRID_COLOR, (x, 0), (x, SCREEN_HEIGHT))
        for y in range(HUD_HEIGHT, SCREEN_HEIGHT, grid_spacing):
            pygame.draw.line(self.screen, BG_GRID_COLOR, (0, y), (SCREEN_WIDTH, y))

    def _draw_hud(self) -> None:
        """
        HUD（スコア・ライフ・レベル表示）を描画する。
        """
        # HUDの区切り線
        pygame.draw.line(
            self.screen,
            GRAY,
            (0, HUD_HEIGHT - 1),
            (SCREEN_WIDTH, HUD_HEIGHT - 1),
            1,
        )

        # スコア表示
        score_text = self._font_hud.render(
            f"SCORE: {self.score:06d}", True, TEXT_COLOR
        )
        self.screen.blit(score_text, (10, (HUD_HEIGHT - score_text.get_height()) // 2))

        # ハイスコア表示
        hi_text = self._font_hud.render(
            f"BEST: {self.high_score:06d}", True, YELLOW
        )
        hi_x = (SCREEN_WIDTH - hi_text.get_width()) // 2
        self.screen.blit(hi_text, (hi_x, (HUD_HEIGHT - hi_text.get_height()) // 2))

        # ライフ表示（ボールアイコン）
        life_x_start = SCREEN_WIDTH - 30
        for i in range(self.lives):
            cx = life_x_start - i * 22
            cy = HUD_HEIGHT // 2
            pygame.draw.circle(self.screen, BALL_COLOR, (cx, cy), 7)
            pygame.draw.circle(self.screen, YELLOW, (cx, cy), 7, 2)

        # レベル表示
        level_text = self._font_info.render(f"LV.{self.level}", True, GREEN)
        level_x = SCREEN_WIDTH - 30 - (self.lives * 22) - level_text.get_width() - 10
        self.screen.blit(
            level_text, (level_x, (HUD_HEIGHT - level_text.get_height()) // 2)
        )

    def _draw_game(self) -> None:
        """
        ゲームオブジェクト（HUD・ブロック・パドル・ボール）を描画する。
        """
        self._draw_hud()
        self.brick_grid.draw(self.screen)
        self.paddle.draw(self.screen)
        self.ball.draw(self.screen)

    def _draw_title_screen(self) -> None:
        """
        タイトル画面を描画する。
        """
        # タイトルロゴ
        title_surf = self._font_title.render("BREAKOUT", True, TEXT_HIGHLIGHT_COLOR)
        title_x = (SCREEN_WIDTH - title_surf.get_width()) // 2
        title_y = SCREEN_HEIGHT // 3 - title_surf.get_height() // 2
        self.screen.blit(title_surf, (title_x, title_y))

        # サブタイトル
        sub_surf = self._font_subtitle.render(
            "ブロック崩し", True, TEXT_COLOR
        )
        sub_x = (SCREEN_WIDTH - sub_surf.get_width()) // 2
        sub_y = title_y + title_surf.get_height() + 10
        self.screen.blit(sub_surf, (sub_x, sub_y))

        # 点滅する「スタート」テキスト
        blink_visible = (self._title_blink_timer // 30) % 2 == 0
        if blink_visible:
            start_surf = self._font_info.render(
                "SPACE / ENTER でスタート", True, GREEN
            )
            start_x = (SCREEN_WIDTH - start_surf.get_width()) // 2
            start_y = SCREEN_HEIGHT * 2 // 3
            self.screen.blit(start_surf, (start_x, start_y))

        # 操作説明
        controls = [
            "← → / A D キー または マウス: パドル移動",
            "SPACE: ボール発射 / P: 一時停止",
            "ESC: 終了",
        ]
        for i, ctrl in enumerate(controls):
            ctrl_surf = self._font_info.render(ctrl, True, GRAY)
            ctrl_x = (SCREEN_WIDTH - ctrl_surf.get_width()) // 2
            ctrl_y = SCREEN_HEIGHT * 2 // 3 + 50 + i * 32
            self.screen.blit(ctrl_surf, (ctrl_x, ctrl_y))

    def _draw_pause_overlay(self) -> None:
        """
        一時停止オーバーレイを描画する。
        """
        overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 140))
        self.screen.blit(overlay, (0, 0))

        pause_surf = self._font_subtitle.render("PAUSED", True, WHITE)
        cx = (SCREEN_WIDTH - pause_surf.get_width()) // 2
        cy = (SCREEN_HEIGHT - pause_surf.get_height()) // 2
        self.screen.blit(pause_surf, (cx, cy))

        info_surf = self._font_info.render(
            "P / SPACE で再開", True, GRAY
        )
        info_x = (SCREEN_WIDTH - info_surf.get_width()) // 2
        self.screen.blit(info_surf, (info_x, cy + pause_surf.get_height() + 16))

    def _draw_ball_lost_overlay(self) -> None:
        """
        ボール消失後のオーバーレイ（次のボール待ち）を描画する。
        """
        # 待機中は「MISS」テキスト表示
        if self._ball_lost_timer > 0:
            miss_surf = self._font_subtitle.render("MISS!", True, RED)
            cx = (SCREEN_WIDTH - miss_surf.get_width()) // 2
            cy = SCREEN_HEIGHT // 2 - miss_surf.get_height()
            self.screen.blit(miss_surf, (cx, cy))

            lives_surf = self._font_info.render(
                f"残りライフ: {self.lives}", True, WHITE
            )
            lx = (SCREEN_WIDTH - lives_surf.get_width()) // 2
            self.screen.blit(lives_surf, (lx, cy + miss_surf.get_height() + 10))
        else:
            # 待機完了 -> 発射案内
            ready_surf = self._font_info.render(
                "SPACE でボール発射", True, GREEN
            )
            rx = (SCREEN_WIDTH - ready_surf.get_width()) // 2
            ry = SCREEN_HEIGHT // 2 + 20
            self.screen.blit(ready_surf, (rx, ry))

    def _draw_game_over_overlay(self) -> None:
        """
        ゲームオーバーオーバーレイを描画する。
        """
        overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 160))
        self.screen.blit(overlay, (0, 0))

        go_surf = self._font_title.render("GAME OVER", True, RED)
        cx = (SCREEN_WIDTH - go_surf.get_width()) // 2
        cy = SCREEN_HEIGHT // 2 - go_surf.get_height() - 20
        self.screen.blit(go_surf, (cx, cy))

        score_surf = self._font_subtitle.render(
            f"SCORE: {self.score:06d}", True, WHITE
        )
        sx = (SCREEN_WIDTH - score_surf.get_width()) // 2
        self.screen.blit(score_surf, (sx, cy + go_surf.get_height() + 10))

        if self.score >= self.high_score and self.score > 0:
            hi_surf = self._font_info.render("NEW HIGH SCORE!", True, YELLOW)
            hx = (SCREEN_WIDTH - hi_surf.get_width()) // 2
            self.screen.blit(hi_surf, (hx, cy + go_surf.get_height() + 60))

        retry_surf = self._font_info.render(
            "SPACE / ENTER でタイトルに戻る", True, GRAY
        )
        rx = (SCREEN_WIDTH - retry_surf.get_width()) // 2
        self.screen.blit(retry_surf, (rx, SCREEN_HEIGHT * 3 // 4))

    def _draw_clear_overlay(self) -> None:
        """
        ステージクリアオーバーレイを描画する。
        """
        overlay = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT), pygame.SRCALPHA)
        overlay.fill((0, 0, 0, 140))
        self.screen.blit(overlay, (0, 0))

        clear_surf = self._font_title.render("STAGE CLEAR!", True, YELLOW)
        cx = (SCREEN_WIDTH - clear_surf.get_width()) // 2
        cy = SCREEN_HEIGHT // 2 - clear_surf.get_height() - 20
        self.screen.blit(clear_surf, (cx, cy))

        score_surf = self._font_subtitle.render(
            f"SCORE: {self.score:06d}", True, WHITE
        )
        sx = (SCREEN_WIDTH - score_surf.get_width()) // 2
        self.screen.blit(score_surf, (sx, cy + clear_surf.get_height() + 10))

        next_surf = self._font_info.render(
            "SPACE / ENTER で次のレベルへ", True, GREEN
        )
        nx = (SCREEN_WIDTH - next_surf.get_width()) // 2
        self.screen.blit(next_surf, (nx, SCREEN_HEIGHT * 3 // 4))

    # =========================================================
    # ゲームループ
    # =========================================================

    def run(self) -> None:
        """
        ゲームのメインループを実行する。

        pygame の終了処理まで含めます。
        """
        running = True

        while running:
            # イベント処理
            running = self._handle_events()

            # 状態更新
            self._update()

            # 描画
            self._draw()

            # フレームレート制御
            self.clock.tick(FPS)

        pygame.quit()
        sys.exit()
