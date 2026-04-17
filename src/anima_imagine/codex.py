# -*- coding: utf-8 -*-
"""CodexIndex：将法典 md + 细目录 json 加载进内存，供 MCP 工具一次性查询。

设计目标：
  - 文件摄入「法典正文 md」和「细 / 粗目录 json」即可工作，不依赖 GPU 管道
  - 一次 lookup 直接返回「条目名 + 对应正文 tag 片段」，避免 AI 先 search 后 read 的两步流程
  - R18 默认不参与检索，除非显式 scope="r18" / "both"
  - 法典目录不存在或格式异常时模块沉默失败，使查询返回空列表，不阻止服务启动。

数据约定：
  * 粗目录 json: 每条章节 {line, end_line, title, anchor}
  * 细目录 json: 每条条目 {line, title, section, section_line}
  * 正文 md:       第 N 行对应 line=N，法典一般为「标题行 + 空行 + tag 行」

匹配策略：对 title 和 tag_raw 两者都做子串匹配（大小写不敏感），
任一命中即返回该条目。本轮不引入向量化 / 模糊分词，保持语义透明、可解释。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

# 两本法典的文件名词干（已由 build_index.py 约定）
STEM_NORMAL = "法典-常规"
STEM_R18 = "法典-R18"

# 判定「目录是否装着法典」时用的标志文件。常规法典一定存在，R18 可选。
_MARKER_FILE = f"{STEM_NORMAL}.md"


def resolve_codex_dir(candidates: list[str | Path | None]) -> Path | None:
    """按顺序在候选路径里找第一个「真的装着法典」的目录。

    为什么要这么做：旧版把路径写死为 ``_HERE.parents[2]``，
    MCP 服务被 pip 装到 site-packages 或从别处启动时，算出来的目录完全不对，
    却不会报错——只会安静地加载 0 条，客户端查询全返空。

    判定规则：候选目录存在、且里面有 ``法典-常规.md`` 才算数。空字符串 / None 跳过。
    """
    for raw in candidates:
        if not raw:
            continue
        p = Path(str(raw))
        if not p.exists() or not p.is_dir():
            continue
        if (p / _MARKER_FILE).exists():
            return p.resolve()
    return None



@dataclass
class _FineEntry:
    """内部条目结构，相当于细目录的一行 + 预算 body 范围。"""
    source: str            # 如 "法典-常规.md"
    scope: str             # "normal" / "r18"
    section: str           # 粗章节标题
    section_line: int      # 粗章节在正文的行号
    line: int              # 条目标题所在行
    title: str             # 条目名（中文居多）
    body_end: int          # 本条 tag 区的止于行（不包含下一条目或章节尾以外的行）
    title_lower: str       # 预处理的小写 title，加速匹配
    body_raw_lower: str    # 预处理的小写 body 全文，用于在 tag 中命中关键词


@dataclass
class _CoarseSection:
    source: str
    scope: str
    line: int
    end_line: int
    title: str
    title_lower: str = ""      # 预计算小写标题，加速 section 子串过滤
    entry_count: int = 0       # 该章节下收录的细条目数，方便 AI 判断是否值得展开


class CodexIndex:
    """法典检索器。工厂实例在 server.py 里实例化一次后多次复用。

    构造入参 ``references_dir`` 应指向存放 法典-*.md / *-目录.json 的目录，
    通常为 ``<repo>/AnimaImagineSkill/references``。即使目录或文件不存在，
    构造器也不报错，只是索引为空。这样保证 MCP 服务主功能（生图）不受影响。
    """

    def __init__(self, references_dir: Path | str) -> None:
        self.root = Path(references_dir)
        self._entries: list[_FineEntry] = []
        self._sections: list[_CoarseSection] = []
        # 正文按文件名缓存，元素为「行列表」，访问 lines[i-1] = 第 i 行。
        self._body_lines: dict[str, list[str]] = {}

        self._load(STEM_NORMAL, "normal")
        self._load(STEM_R18, "r18")

    # ---------- 加载 ----------

    def _load(self, stem: str, scope: str) -> None:
        """加载一本法典：正文 + 粗/细目录。缺少任一则该作用域直接放弃。"""
        md_path = self.root / f"{stem}.md"
        fine_path = self.root / f"{stem}-细目录.json"
        coarse_path = self.root / f"{stem}-目录.json"
        if not md_path.exists() or not fine_path.exists() or not coarse_path.exists():
            return

        try:
            body_lines = md_path.read_text(encoding="utf-8").splitlines()
            fine_data = json.loads(fine_path.read_text(encoding="utf-8"))
            coarse_data = json.loads(coarse_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            # 格式坏得就放弃此作用域，不在这里抛错，避免影响服务启动
            return

        source = f"{stem}.md"
        self._body_lines[source] = body_lines

        # 粗目录直接迁入
        for sec in coarse_data.get("entries", []):
            self._sections.append(
                _CoarseSection(
                    source=source,
                    scope=scope,
                    line=int(sec["line"]),
                    end_line=int(sec.get("end_line", sec["line"])),
                    title=str(sec.get("title", "")),
                    title_lower=str(sec.get("title", "")).lower(),
                )
            )

        # 细目录需要为每条推算 body_end：
        # = min(下一条目的 line - 1, 所属粗章节的 end_line)
        # 这样 body_raw 即使没显式指定也不会跨到下一条目。
        # 先建「章节行 → 章节 end_line」映射，避免线性搜。
        section_end_by_line: dict[int, int] = {
            int(sec["line"]): int(sec.get("end_line", sec["line"]))
            for sec in coarse_data.get("entries", [])
        }

        fine_entries = fine_data.get("entries", [])
        for i, ent in enumerate(fine_entries):
            start = int(ent["line"])
            sec_line = int(ent.get("section_line", 0))
            # 下一条目行
            if i + 1 < len(fine_entries):
                next_line = int(fine_entries[i + 1]["line"]) - 1
            else:
                next_line = len(body_lines)
            # 章节结束行
            sec_end = section_end_by_line.get(sec_line, len(body_lines))
            body_end = min(next_line, sec_end)
            if body_end < start:
                body_end = start

            raw = "\n".join(body_lines[start - 1: body_end])
            title = str(ent.get("title", ""))
            self._entries.append(
                _FineEntry(
                    source=source,
                    scope=scope,
                    section=str(ent.get("section", "")),
                    section_line=sec_line,
                    line=start,
                    title=title,
                    body_end=body_end,
                    title_lower=title.lower(),
                    body_raw_lower=raw.lower(),
                )
            )

        # 汇总该 scope 下每个 section 的条目数，便于 list_sections 输出 entry_count。
        # 做法：按 (source, section_line) 分组统计，再回填到刚才新增的 _CoarseSection 上。
        count_by_key: dict[tuple[str, int], int] = {}
        for ent in self._entries:
            if ent.source != source:
                continue
            key = (ent.source, ent.section_line)
            count_by_key[key] = count_by_key.get(key, 0) + 1
        for sec in self._sections:
            if sec.source != source:
                continue
            sec.entry_count = count_by_key.get((sec.source, sec.line), 0)

    # ---------- 查询 ----------

    @staticmethod
    def _normalize_scope(scope: str) -> set[str]:
        """把用户传的 scope 字符串化为「函入作用域」集合。"""
        s = (scope or "").strip().lower()
        if s in ("both", "all", ""):
            return {"normal", "r18"}
        if s in ("r18", "nsfw", "explicit"):
            return {"r18"}
        return {"normal"}

    def lookup(
        self,
        query: str,
        section: str = "",
        scope: str = "normal",
        limit: int = 20,
        context_lines: int = 3,
    ) -> list[dict]:
        """查询条目。返回结构化列表：

        [{"source", "scope", "section", "line", "title", "tag_block", "body_end"}]

        匹配规则：
        - ``query``：小写子串，同时在 title 和 body 里搜；命中任一视为命中。
          传空字符串表示「不按关键词过滤」——此时必须指定 ``section``，否则返回空。
        - ``section``：按「所属粗章节名」过滤，子串匹配，大小写不敏感；
          支持逗号（``,``、``，``、``|``）分隔多个条件，任一匹配即算命中
          （例如 ``"内衣,睡衣,诱惑"`` 表示这三章的条目都要）。

        输出的 ``tag_block`` 是从条目行到 ``min(line + context_lines, body_end)`` 的原文，
        保证不跨到下一条目，也不跨出章节。
        """
        q = (query or "").strip().lower()
        section_parts = self._split_section(section)
        # 避免「什么都不给」时做一次完整扫描，这在法典全量（1.3w 条）下依然会返回过多结果。
        if not q and not section_parts:
            return []
        scopes = self._normalize_scope(scope)
        ctx = max(0, int(context_lines))
        lim = max(1, int(limit))

        results: list[dict] = []
        for ent in self._entries:
            if ent.scope not in scopes:
                continue
            if section_parts and not self._section_hit(ent.section, section_parts):
                continue
            if q and q not in ent.title_lower and q not in ent.body_raw_lower:
                continue
            # 按 context_lines 裁切返回文本，不超出 body_end
            lines = self._body_lines.get(ent.source, [])
            end_line = min(ent.line + ctx, ent.body_end)
            tag_block = "\n".join(lines[ent.line - 1: end_line])
            results.append(
                {
                    "source": ent.source,
                    "scope": ent.scope,
                    "section": ent.section,
                    "line": ent.line,
                    "body_end": ent.body_end,
                    "title": ent.title,
                    "tag_block": tag_block,
                }
            )
            if len(results) >= lim:
                break
        return results

    def list_entries(
        self,
        section: str = "",
        scope: str = "normal",
        limit: int = 200,
    ) -> list[dict]:
        """列章节「菜单」：只返回条目标题，不带 tag 正文，省 token。

        典型用法：AI 想看某个章节下都有什么条目，先用这个工具浏览，再按名字精确
        ``lookup_codex`` 拿对应的 tag 块。

        - ``section`` 留空时返回该 scope 下所有条目（受 ``limit`` 截断）。
        - 支持多章节逗号分隔，与 ``lookup`` 一致。
        """
        section_parts = self._split_section(section)
        scopes = self._normalize_scope(scope)
        lim = max(1, int(limit))

        results: list[dict] = []
        for ent in self._entries:
            if ent.scope not in scopes:
                continue
            if section_parts and not self._section_hit(ent.section, section_parts):
                continue
            results.append(
                {
                    "source": ent.source,
                    "scope": ent.scope,
                    "section": ent.section,
                    "line": ent.line,
                    "title": ent.title,
                }
            )
            if len(results) >= lim:
                break
        return results

    @staticmethod
    def _split_section(section: str) -> list[str]:
        """把 section 参数切成小写子串列表，去空。

        允许用户用中英文逗号或 ``|`` 分隔多个章节，例如 ``"内衣,睡衣|泳装"``。
        """
        if not section:
            return []
        raw = section.replace("|", ",").replace("，", ",")
        return [p.strip().lower() for p in raw.split(",") if p.strip()]

    @staticmethod
    def _section_hit(section_title: str, needles: list[str]) -> bool:
        """按子串规则判断条目的 section 是否匹配任一 needle。"""
        s = section_title.lower()
        return any(n in s for n in needles)

    def list_sections(self, scope: str = "normal") -> list[dict]:
        """返回粗章节列表（每本法典去重后并到一起）。附带 ``entry_count`` 便于选章。"""
        scopes = self._normalize_scope(scope)
        return [
            {
                "source": s.source,
                "scope": s.scope,
                "line": s.line,
                "end_line": s.end_line,
                "title": s.title,
                "entry_count": s.entry_count,
            }
            for s in self._sections
            if s.scope in scopes
        ]

    # ---------- 调试小工具 ----------

    def stats(self) -> dict:
        """返回加载统计，方便 /health 或日志检查。"""
        by_scope: dict[str, int] = {}
        for ent in self._entries:
            by_scope[ent.scope] = by_scope.get(ent.scope, 0) + 1
        return {
            "fine_entries": len(self._entries),
            "sections": len(self._sections),
            "by_scope": by_scope,
            "sources": sorted(self._body_lines.keys()),
        }


def _iter_valid_scopes() -> Iterable[str]:
    """仅为文档用：列出支持的 scope 值。"""
    return ("normal", "r18", "both")
