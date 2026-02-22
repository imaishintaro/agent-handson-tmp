"""
ブロック崩しゲーム エントリーポイント

ゲームを起動するためのメインモジュールです。
Gameクラスの実装は class_game.py に、各ゲームオブジェクトは
class_paddle.py / class_ball.py / class_brick.py にあります。

操作方法:
    <= => / A D キー または マウス: パドル移動
    SPACE: ボール発射
    P: 一時停止 / 再開
    ESC: 終了

使い方:
    python src/main.py
"""

import logging
import sys

import pygame

from class_game import Game

# ロギング設定
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


if __name__ == "__main__":
    try:
        game = Game()
        game.run()
    except KeyboardInterrupt:
        logger.info("ユーザーによる中断")
        pygame.quit()
        sys.exit(0)
    except Exception as exc:
        logger.critical("予期しないエラーが発生しました: %s", exc, exc_info=True)
        pygame.quit()
        sys.exit(1)
