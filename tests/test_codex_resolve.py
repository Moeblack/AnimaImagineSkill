# -*- coding: utf-8 -*-
"""codex 路径探测的单元测试。

背景：旧版路径写死为 _HERE.parents[2] ，因而 MCP 服务被 pip 安装 / 换目录启动时就
默声加载到 0 条。新的 resolve_codex_dir 接受一串候选路径，按顺序返回第一个有效的。
“有效” 定义：目录存在且包含标志文件 法典-常规.md。
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from anima_imagine.codex import resolve_codex_dir


class ResolveCodexDirTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="codex_resolve_"))
        # 候选 A：空目录
        self.empty = self.tmp / "empty"
        self.empty.mkdir()
        # 候选 B：含标志文件
        self.good = self.tmp / "good"
        self.good.mkdir()
        (self.good / "法典-常规.md").write_text("", encoding="utf-8")
        # 候选 C：另一个含标志文件的，用来验证优先级
        self.good2 = self.tmp / "good2"
        self.good2.mkdir()
        (self.good2 / "法典-常规.md").write_text("", encoding="utf-8")

    def test_returns_first_valid(self) -> None:
        """按顺序返回第一个有效候选，既使前面有空目录也忽略。"""
        got = resolve_codex_dir([
            "",                      # 空字符串跳过
            str(self.tmp / "nope"),  # 不存在跳过
            str(self.empty),         # 存在但缺标志跳过
            str(self.good),          # 命中
            str(self.good2),         # 应该在上一个命中后不再进
        ])
        self.assertEqual(Path(got), self.good.resolve())

    def test_returns_none_when_all_invalid(self) -> None:
        """全部候选都无效时返回 None，不抛异常。"""
        got = resolve_codex_dir([
            str(self.tmp / "nope"),
            str(self.empty),
        ])
        self.assertIsNone(got)

    def test_ignores_empty_and_none(self) -> None:
        """空串 / None 应该被跳过而不报错。"""
        got = resolve_codex_dir([None, "", str(self.good)])
        self.assertEqual(Path(got), self.good.resolve())


if __name__ == "__main__":
    unittest.main()
