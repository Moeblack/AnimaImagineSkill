"""
v2.2: Anima 提示词拼接器。

设计依据（Anima 官方 README）：
  [quality/meta/year/safety] [count] [character] [series] [artist] [general tags]

v2.2 在官方“general tags”这一段内部，面向用户拆分为可独立编辑的子槽：
  appearance / outfit / pose_expression / composition / environment / style / nl_caption
最终拼接时这些子槽按固定顺序合并进同一段。这样依然符合 Anima 训练预期
（section 内部顺序任意），但用户可以“只换外表”或“只换环境”。
后向兼容：旧字段 tags / nltags 作为 alias 仍可传入。
"""

from __future__ import annotations

# v2.2: 画师标签必须加 @ 前缀（Anima 要求）。
# 如果用户传进来的画师名未加 @，这里逐个补上，避免“效果很弱”。
def _ensure_at_prefix(artist: str) -> str:
    if not artist:
        return ""
    parts = [p.strip() for p in artist.split(",") if p.strip()]
    fixed = []
    for p in parts:
        if p.startswith("@"):
            fixed.append(p)
        else:
            fixed.append("@" + p)
    return ", ".join(fixed)


def build_prompt(
    quality_meta_year_safe: str = "",
    count: str = "",
    character: str = "",
    series: str = "",
    artist: str = "",
    # v2.2 细分后的 general tags 子槽：
    appearance: str = "",
    outfit: str = "",
    pose_expression: str = "",
    composition: str = "",
    environment: str = "",
    style: str = "",
    nl_caption: str = "",
    # 后向兼容：旧字段名。tags 被当作 pose_expression 的 alias，nltags 被当作 nl_caption 的 alias。
    tags: str = "",
    nltags: str = "",
) -> str:
    """按 Anima 官方顺序拼接提示词。

    返回一行逗号分隔的 prompt。空字段全部跳过。
    """
    # 后向兼容：旧名 → 新名
    pose_expression = pose_expression or tags
    nl_caption = nl_caption or nltags

    # 画师自动加 @
    artist = _ensure_at_prefix(artist)

    # v2.2 拼接顺序：Anima 官方 6 段 + general 内部依“从主体到环境”的阅读习惯
    parts = [
        quality_meta_year_safe,    # 质量/元/年份/安全
        count,                     # 1girl / 1boy / no humans
        character,                 # 角色名
        series,                    # 作品名
        artist,                    # @画师
        # 下面全部在 Anima 眼里属于 general tags，顺序任意，
        # 这里按“角色本体 → 衣着 → 动作 → 镜头 → 场景 → 画风 → 自然语”的顺序
        appearance,
        outfit,
        pose_expression,
        composition,
        environment,
        style,
        nl_caption,
    ]
    return ", ".join(p.strip() for p in parts if p and p.strip())
