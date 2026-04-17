# -*- coding: utf-8 -*-
"""CodexIndex 单元测试。

设计模式规定：先写测试、后写实现。
这里覆盖 CodexIndex 的关键不变量：
  - 加载细目录 JSON + 正文 md 后，lookup 能按中文子串命中标题
  - tag_block 是项目行起的若干正文行，且不跨到下一条目
  - scope="normal" 时不返回 R18 结果；scope="r18" / "both" 行为正确
  - limit 生效
  - list_sections 返回粗目录数据
  - 失败模式：找不到法典目录时 CodexIndex 可以从空构造并返回空结果
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from anima_imagine.codex import CodexIndex


def _write_pair(tmp: Path, stem: str, body_lines: list[str], fine_entries: list[dict], coarse_entries: list[dict]) -> None:
    """写入一对 mini 语料：{stem}.md 正文 + {stem}-细目录.json + {stem}-目录.json。"""
    (tmp / f"{stem}.md").write_text("\n".join(body_lines) + "\n", encoding="utf-8")
    (tmp / f"{stem}-细目录.json").write_text(
        json.dumps({"source": f"{stem}.md", "total_lines": len(body_lines), "entries": fine_entries}, ensure_ascii=False),
        encoding="utf-8",
    )
    (tmp / f"{stem}-目录.json").write_text(
        json.dumps({"source": f"{stem}.md", "total_lines": len(body_lines), "entries": coarse_entries}, ensure_ascii=False),
        encoding="utf-8",
    )


class CodexIndexTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="codex_test_"))

        # 简化正文：每条目 = title + 空行 + tag + 空行
        # 行号规划：章节头占 1 行，条目从其后开始
        # 常规法典（stem="法典-常规"）
        normal_body = [
            "# 各种oc",           # L1  粗章节头
            "玻德琲",               # L2  条目名
            "",
            "1girl,down jacket,blue jacket,long hair,ahoge,",  # L4  tag
            "",
            "幽灵姬",               # L6
            "",
            "princess king boo,boo (mario),ghost,close-up,",
            "",
            "# 服饰穿搭",           # L10 另一个粗章节
            "踩脚袜",               # L11
            "",
            "pantyhose,strapped,cameltoe,under leotard,",      # L13
            "",
        ]
        normal_fine = [
            {"line": 2, "section": "各种oc", "section_line": 1, "title": "玻德琲"},
            {"line": 6, "section": "各种oc", "section_line": 1, "title": "幽灵姬"},
            {"line": 11, "section": "服饰穿搭", "section_line": 10, "title": "踩脚袜"},
        ]
        normal_coarse = [
            {"line": 1, "end_line": 9, "title": "各种oc", "anchor": "_Toc1"},
            {"line": 10, "end_line": 14, "title": "服饰穿搭", "anchor": "_Toc2"},
        ]
        _write_pair(self.tmp, "法典-常规", normal_body, normal_fine, normal_coarse)

        # R18 法典（stem="法典-R18"）
        r18_body = [
            "# 正身体",
            "骑乘体位示例",
            "",
            "cowgirl position,sex,1boy,1girl,",
            "",
        ]
        r18_fine = [
            {"line": 2, "section": "正身体", "section_line": 1, "title": "骑乘体位示例"},
        ]
        r18_coarse = [
            {"line": 1, "end_line": 5, "title": "正身体", "anchor": "_Toc1"},
        ]
        _write_pair(self.tmp, "法典-R18", r18_body, r18_fine, r18_coarse)

        self.index = CodexIndex(self.tmp)

    # ---------- lookup ----------

    def test_lookup_hits_normal_codex(self) -> None:
        """中文子串能命中标题。"""
        hits = self.index.lookup("踩脚袜")
        self.assertEqual(len(hits), 1)
        h = hits[0]
        self.assertEqual(h["title"], "踩脚袜")
        self.assertEqual(h["section"], "服饰穿搭")
        self.assertEqual(h["source"], "法典-常规.md")
        self.assertEqual(h["line"], 11)
        self.assertIn("pantyhose", h["tag_block"])

    def test_lookup_case_insensitive_english(self) -> None:
        """英文子串也能在 tag_block 或标题中命中（不区分大小写）。"""
        hits = self.index.lookup("PANTYHOSE")
        self.assertTrue(any("踩脚袜" == h["title"] for h in hits))

    def test_lookup_normal_scope_excludes_r18(self) -> None:
        """默认 normal 不返回 R18 法典内容。"""
        hits = self.index.lookup("骑乘", scope="normal")
        self.assertEqual(hits, [])

    def test_lookup_r18_scope(self) -> None:
        hits = self.index.lookup("骑乘", scope="r18")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["source"], "法典-R18.md")

    def test_lookup_both_scope_merges(self) -> None:
        # both 时同一查询跨两本法典都会被返回
        hits = self.index.lookup("示例", scope="both")
        # mini 数据中：只有 R18 里的 "骑乘体位示例" 命中
        sources = {h["source"] for h in hits}
        self.assertIn("法典-R18.md", sources)

    def test_lookup_limit(self) -> None:
        """limit=1 只返一条。"""
        hits = self.index.lookup("幽灵姬", limit=1)
        self.assertEqual(len(hits), 1)

    def test_tag_block_does_not_cross_next_entry(self) -> None:
        """玻德琲 (L2) 的 tag_block 不应包含幽灵姬 (L6) 的内容。"""
        hits = self.index.lookup("玻德琲")
        self.assertEqual(len(hits), 1)
        self.assertNotIn("幽灵姬", hits[0]["tag_block"])
        self.assertIn("down jacket", hits[0]["tag_block"])

    # ---------- list_sections ----------

    def test_list_sections_normal(self) -> None:
        secs = self.index.list_sections("normal")
        titles = [s["title"] for s in secs]
        self.assertEqual(titles, ["各种oc", "服饰穿搭"])
        # 每个 section 应有 line / end_line / source
        self.assertEqual(secs[0]["line"], 1)
        self.assertEqual(secs[0]["end_line"], 9)
        self.assertEqual(secs[0]["source"], "法典-常规.md")

    def test_list_sections_both(self) -> None:
        secs = self.index.list_sections("both")
        # 两本法典的粗章节汇总
        self.assertEqual(len(secs), 3)

    # ---------- 容错 ----------
    # ---------- section 过滤 & 空 query ----------

    def test_lookup_section_filter_single(self) -> None:
        """给定 section 后，不属于该章节的条目不会出现。"""
        hits = self.index.lookup(query="", section="服饰穿搭", scope="normal", limit=50)
        titles = {h["title"] for h in hits}
        self.assertEqual(titles, {"踩脚袜"})

    def test_lookup_section_filter_multi_csv(self) -> None:
        """section 支持逗号分隔多个子串。"""
        hits = self.index.lookup(
            query="", section="各种oc,服饰穿搭", scope="normal", limit=50
        )
        titles = {h["title"] for h in hits}
        # 应该同时命中「各种oc」和「服饰穿搭」下的全部
        self.assertEqual(titles, {"玻德琲", "幽灵姬", "踩脚袜"})

    def test_lookup_section_is_substring_not_equal(self) -> None:
        """section 过滤是子串匹配，方便用户写短名。"""
        hits = self.index.lookup(query="", section="oc", scope="normal", limit=50)
        titles = {h["title"] for h in hits}
        self.assertEqual(titles, {"玻德琲", "幽灵姬"})

    def test_lookup_query_and_section_both(self) -> None:
        """同时指定 query 和 section 时，要同时满足。"""
        hits = self.index.lookup(
            query="幽", section="各种oc", scope="normal", limit=50
        )
        titles = {h["title"] for h in hits}
        self.assertEqual(titles, {"幽灵姬"})

        # query 不匹配 × section 匹配 → 仍然空结果
        hits2 = self.index.lookup(
            query="xyz_not_exist", section="各种oc", scope="normal"
        )
        self.assertEqual(hits2, [])

    def test_empty_query_without_section_returns_empty(self) -> None:
        """query 空 + section 也空时返回空，避免意外全表扫描。"""
        self.assertEqual(self.index.lookup(query="", scope="both"), [])

    # ---------- list_entries ----------

    def test_list_entries_by_section(self) -> None:
        titles = self.index.list_entries(section="服饰穿搭", scope="normal", limit=50)
        # 返回结构化列表，每项至少带 title/section/source/line
        self.assertEqual(len(titles), 1)
        self.assertEqual(titles[0]["title"], "踩脚袜")
        self.assertEqual(titles[0]["section"], "服饰穿搭")
        self.assertEqual(titles[0]["source"], "法典-常规.md")

    def test_list_entries_without_section_returns_all_in_scope(self) -> None:
        """不给 section 时默认列出该 scope 下所有条目（但受 limit 约束）。"""
        all_r18 = self.index.list_entries(section="", scope="r18", limit=100)
        self.assertEqual(len(all_r18), 1)
        self.assertEqual(all_r18[0]["title"], "骑乘体位示例")

    def test_list_entries_limit(self) -> None:
        """limit 生效。"""
        got = self.index.list_entries(section="", scope="normal", limit=2)
        self.assertEqual(len(got), 2)

    def test_list_sections_has_entry_count(self) -> None:
        """粗目录需带上 entry_count，方便 AI 判断该章不会没内容。"""
        secs = self.index.list_sections("normal")
        counts = {s["title"]: s["entry_count"] for s in secs}
        self.assertEqual(counts["各种oc"], 2)
        self.assertEqual(counts["服饰穿搭"], 1)


    def test_missing_dir_returns_empty(self) -> None:
        idx = CodexIndex(self.tmp / "does-not-exist")
        self.assertEqual(idx.lookup("anything", scope="both"), [])
        self.assertEqual(idx.list_sections("both"), [])


if __name__ == "__main__":
    unittest.main()
