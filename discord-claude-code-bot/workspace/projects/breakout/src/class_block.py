"""
ブロック崩しゲーム ブロッククラス（後方互換エイリアス）

このモジュールは class_brick.py の Brick / BrickGrid を
Block / BlockGrid という名前でエクスポートする互換モジュールです。
実装の詳細は class_brick.py を参照してください。

使い方:
    from class_block import Block, BlockGrid
"""

# class_brick モジュールから Brick/BrickGrid を Block/BlockGrid としてエクスポート
from class_brick import Brick as Block
from class_brick import BrickGrid as BlockGrid

__all__ = ["Block", "BlockGrid"]
