"""v2 法典服务。薄包装，保留 CodexIndex 原有逻辑。"""
from __future__ import annotations

import os
from pathlib import Path

from anima_imagine.codex import CodexIndex, resolve_codex_dir


def create_codex_index() -> CodexIndex:
    """v2: 创建法典索引，多路径候选。"""
    cwd = Path.cwd()
    here = Path(__file__).resolve().parent.parent
    codex_dir = resolve_codex_dir([
        os.getenv("ANIMA_CODEX_DIR"),
        cwd / "AnimaImagineSkill" / "references",
        cwd / "references",
        here.parent / "AnimaImagineSkill" / "references",
    ])
    return CodexIndex(codex_dir if codex_dir else cwd)
