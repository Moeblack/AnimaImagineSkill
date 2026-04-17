# -*- coding: utf-8 -*-
"""
生成法典 md 的「行号版目录」。

输出两种粒度：
1. 「粗目录」`*-目录.md` / `.json`
   来源：pandoc 留下的 `<span id="_Toc.." class="anchor">` 锚点
   形状：每一章一行，附「起始行–止于」

2. 「细目录」`*-细目录.md` / `.json`
   来源：启发式扰动，在每个粗章节内部抓「子条目标题行」
   规则：该行 strip 掉 HTML 后：
     - 非空、长度≤ 40
     - 不含英文逗号 `,` 也不含中文逗号 `，`（tag 块满是逗号）
     - 不以 `- * # [ | > !` 开头（排除 markdown 控制元素）
     - 至少含一个CJK字符（OC 名基本都有中文）
     - 下一行为空行，再下一行看起来就是 tag 块（含逗号 / `::` / 1girl 等）
   目的：将几百万字的法典细化到条目粒度，AI 先查细目录定位中文名，再按行号读 tag。
这一次的修改：在原有粗目录基础上新增 `build_fine` / `process_fine`，粗目录逻辑保持不变。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent

ANCHOR_RE = re.compile(r'<span id="(_Toc\d+)" class="anchor"></span>(.*)')
HTML_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")
# 判定 tag 块时使用：四种典型特征任一即可
TAG_HINT_RE = re.compile(r"\b(1girl|1boy|2girls|2boys|multiple_views|artist:|solo|looking at viewer)\b", re.I)
CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def strip_html(s: str) -> str:
    """去掉 html 标签和 markdown 强调标记，留可视文字。"""
    s = HTML_TAG_RE.sub("", s)
    return s.strip().strip("*_").strip()


def clean_title(raw: str) -> str:
    return strip_html(raw)


# ---------- 粗目录 ----------

def build_coarse(md_path: Path) -> list[dict]:
    entries: list[dict] = []
    with md_path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            m = ANCHOR_RE.search(line)
            if not m:
                continue
            title = clean_title(m.group(2))
            if not title:
                continue
            entries.append({"line": i, "anchor": m.group(1), "title": title})
    return entries


def compute_ranges(entries: list[dict], total_lines: int) -> list[dict]:
    out = []
    for idx, e in enumerate(entries):
        end = entries[idx + 1]["line"] - 1 if idx + 1 < len(entries) else total_lines
        out.append({**e, "end_line": end})
    return out


def render_coarse_md(title: str, md_file: str, entries: list[dict]) -> str:
    lines = [f"# {title} - 行号目录", "", f"源文件：`{md_file}`", ""]
    lines += ["| 起始行 | 止于 | 章节 |", "|---:|---:|---|"]
    for e in entries:
        safe = e["title"].replace("|", "\\|")
        lines.append(f"| {e['line']} | {e['end_line']} | {safe} |")
    lines.append("")
    return "\n".join(lines)


# ---------- 细目录 ----------

def looks_like_tag_block(raw: str) -> bool:
    """这一行看起来是 tag 块吗？用来验证上一个候选行是否为标题。"""
    s = strip_html(raw)
    if not s:
        return False
    if "," in s or "，" in s:
        return True
    if "::" in s or s.endswith(","):
        return True
    if TAG_HINT_RE.search(s):
        return True
    return False


def looks_like_subtitle(cur: str, nxt: str, nxt2: str) -> bool:
    """启发式判定：当前行是一个条目小标题。"""
    s = strip_html(cur)
    if not s:
        return False
    # 排除 markdown 控制或列表
    if s.startswith(("-", "*", "#", "[", "|", ">", "!", "<", "`")):
        return False
    # 标题本身不含逗号
    if "," in s or "，" in s:
        return False
    # 长度约束
    if len(s) > 40:
        return False
    # 至少一个 CJK
    if not CJK_RE.search(s):
        return False
    # 下一行必须为空、再下一行看起来是 tag
    if nxt.strip() != "":
        return False
    if not looks_like_tag_block(nxt2):
        return False
    return True


def build_fine(md_path: Path, coarse: list[dict]) -> list[dict]:
    """在每个粗章节范围内寻找子条目标题行。"""
    # 一次性加载全文（1-based 索引）
    with md_path.open("r", encoding="utf-8") as f:
        text_lines = f.readlines()
    n = len(text_lines)

    # 把粗目录转为「行→章节标题」映射，方便子条目归属
    results: list[dict] = []
    for sec in coarse:
        sec_start, sec_end, sec_title = sec["line"], sec["end_line"], sec["title"]
        # 在 [sec_start+1, sec_end] 内扫描；章节头行本身不是子条目
        i = sec_start  # index 从 1 开始指向 text_lines[i-1]
        while i <= sec_end:
            cur = text_lines[i - 1] if 1 <= i <= n else ""
            nxt = text_lines[i] if 1 <= i + 1 <= n else ""
            nxt2 = text_lines[i + 1] if 1 <= i + 2 <= n else ""
            # 跳过章节锁锚行本身
            if ANCHOR_RE.search(cur):
                i += 1
                continue
            if looks_like_subtitle(cur, nxt, nxt2):
                results.append(
                    {
                        "line": i,
                        "section": sec_title,
                        "section_line": sec_start,
                        "title": strip_html(cur),
                    }
                )
                # 跳到 tag 行之后，避免重复命中
                i += 3
                continue
            i += 1
    return results


def render_fine_md(title: str, md_file: str, fine: list[dict], coarse: list[dict]) -> str:
    lines = [f"# {title} - 细目录（条目粒度）", ""]
    lines.append(f"源文件：`{md_file}`")
    lines.append("")
    lines.append("按粗目录章节分组，每行为 「行号 条目名」。用 `read_file(path, startLine=X, endLine=X+3)` 读条目名+tag。")
    lines.append("")

    # 按章节分组
    by_section: dict[int, list[dict]] = {}
    for f in fine:
        by_section.setdefault(f["section_line"], []).append(f)

    for sec in coarse:
        items = by_section.get(sec["line"], [])
        if not items:
            continue
        lines.append(f"## {sec['title']}  (L{sec['line']}–L{sec['end_line']}, 共 {len(items)} 条)")
        lines.append("")
        for it in items:
            lines.append(f"- {it['line']}\t{it['title']}")
        lines.append("")
    return "\n".join(lines)


# ---------- 入口 ----------

def process(md_name: str, label: str) -> None:
    md_path = ROOT / md_name
    if not md_path.exists():
        print(f"[skip] {md_path} not found")
        return
    total = sum(1 for _ in md_path.open("r", encoding="utf-8"))

    coarse = compute_ranges(build_coarse(md_path), total)
    fine = build_fine(md_path, coarse)

    stem = md_path.stem  # e.g. 法典-常规
    (ROOT / f"{stem}-目录.md").write_text(
        render_coarse_md(label, md_name, coarse), encoding="utf-8"
    )
    (ROOT / f"{stem}-目录.json").write_text(
        json.dumps({"source": md_name, "total_lines": total, "entries": coarse}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (ROOT / f"{stem}-细目录.md").write_text(
        render_fine_md(label, md_name, fine, coarse), encoding="utf-8"
    )
    (ROOT / f"{stem}-细目录.json").write_text(
        json.dumps({"source": md_name, "total_lines": total, "entries": fine}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[ok] {md_name}: {len(coarse)} sections / {len(fine)} fine entries / {total} lines")


if __name__ == "__main__":
    process("法典-常规.md", "所长常规NovelAI个人法典 2026.3.21")
    process("法典-R18.md", "所长色色NovelAI个人法典 2026.3.21")
