from __future__ import annotations


def _ensure_at_prefix(artist: str) -> str:
    if not artist:
        return ""
    parts = [part.strip() for part in artist.split(",") if part.strip()]
    return ", ".join(part if part.startswith("@") else f"@{part}" for part in parts)


def build_prompt(
    quality_meta_year_safe: str = "",
    count: str = "",
    character: str = "",
    series: str = "",
    artist: str = "",
    body_type_f: str = "",
    body_type_m: str = "",
    appearance: str = "",
    outfit: str = "",
    accessories: str = "",
    body_decoration: str = "",
    expression: str = "",
    pose_f: str = "",
    pose_m: str = "",
    nsfw_pose: str = "",
    nsfw_interaction: str = "",
    composition: str = "",
    environment: str = "",
    style: str = "",
    others: str = "",
    nl_caption: str = "",
    tags: str = "",
    nltags: str = "",
    pose_expression: str = "",
) -> str:
    pose_f = pose_f or pose_expression or tags
    nl_caption = nl_caption or nltags
    artist = _ensure_at_prefix(artist)

    parts = [
        quality_meta_year_safe,
        count,
        character,
        series,
        artist,
        body_type_f,
        body_type_m,
        appearance,
        outfit,
        accessories,
        body_decoration,
        expression,
        pose_f,
        pose_m,
        nsfw_pose,
        nsfw_interaction,
        composition,
        environment,
        style,
        others,
        nl_caption,
    ]
    return ", ".join(part.strip() for part in parts if part and part.strip())
