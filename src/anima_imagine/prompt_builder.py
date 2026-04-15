"""
Anima 提示词拼接器。

将结构化字段按 Anima 标签顺序拼接成单行 prompt 字符串：
  [质量/元数据/年份/安全] [人数] [角色名] [作品名] [画师] [风格] [外表] [标签] [环境] [自然语言]

和 AnimaTool executor 的拼接逻辑对齐，确保服务端产出的 prompt 和 ComfyUI 版本一致。
"""

from __future__ import annotations


def build_prompt(
    quality_meta_year_safe: str = "",
    count: str = "",
    character: str = "",
    series: str = "",
    artist: str = "",
    style: str = "",
    appearance: str = "",
    tags: str = "",
    environment: str = "",
    nltags: str = "",
) -> str:
    """按 Anima 固定顺序拼接提示词。

    每个字段都是可选的。空字段会被跳过，不会产生多余逗号。
    返回一行逗号分隔的 prompt 字符串，可直接传给 generate_anima_image(prompt=...).
    """
    # 按固定顺序收集非空字段
    parts = [
        quality_meta_year_safe,  # 质量/元数据/年份/安全
        count,                  # 人数: 1girl, 2girls, no humans
        character,              # 角色名: hatsune miku
        series,                 # 作品名: vocaloid
        artist,                 # 画师: @fkey
        style,                  # 风格: watercolor, pixel art
        appearance,             # 外表: long twintails, aqua hair
        tags,                   # 标签: upper body, smile, dress
        environment,            # 环境: night, neon, rain
        nltags,                 # 自然语言补充
    ]

    # 过滤空值，用逗号拼接
    prompt = ", ".join(p.strip() for p in parts if p and p.strip())
    return prompt
