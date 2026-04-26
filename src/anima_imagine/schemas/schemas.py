"""v2 API 输入校验 schema。

不使用 pydantic（避免新依赖），用 dataclass + 手动校验。
所有 parse 方法接受原始 dict，校验失败抛 ValueError。
router 层捕获 ValueError 统一返回 400。
"""
from __future__ import annotations

from dataclasses import dataclass


# ============================================================
# 认证
# ============================================================

@dataclass
class LoginRequest:
    token: str

    @classmethod
    def parse(cls, data: dict) -> "LoginRequest":
        token = data.get("token", "")
        if not isinstance(token, str) or not token.strip():
            raise ValueError("密码不能为空")
        return cls(token=token.strip())


# ============================================================
# 生图
# ============================================================

@dataclass
class GenerateRequest:
    """生图请求参数，涵盖基础模式和高级模式。"""
    mode: str = "basic"         # "basic" | "advanced"
    prompt: str = ""
    negative_prompt: str = ""
    seed: int = -1
    steps: int = 20
    cfg_scale: float = 4.5
    aspect_ratio: str = "3:4"
    width: int = 0
    height: int = 0
    # 高级模式字段（v2.2 重构：拆分 general tags）
    quality_meta_year_safe: str = ""
    count: str = ""
    character: str = ""
    series: str = ""
    artist: str = ""
    # 【v3.0 新增】体型子槽：男女体型分开描述
    body_type_f: str = ""
    body_type_m: str = ""
    # general tags 子槽（v2.2 新增，v3.0 扩展）
    appearance: str = ""
    outfit: str = ""
    accessories: str = ""              # 【v3.0 新增】饰品（从 outfit 拆分）
    body_decoration: str = ""          # 【v3.0 新增】身体装饰（纹身、彩绘等）
    expression: str = ""               # 【v3.0 新增】表情（从 pose_expression 拆分）
    pose_f: str = ""                   # 【v3.0 新增】女性姿势（从 pose_expression 拆分）
    pose_m: str = ""                   # 【v3.0 新增】男性姿势
    nsfw_pose: str = ""                # 【v3.0 新增】涩情姿势
    nsfw_interaction: str = ""         # 【v3.0 新增】涩情交互
    composition: str = ""
    environment: str = ""
    style: str = ""
    others: str = ""                   # 【v3.0 新增】其他标签（无法归类但仍属于 tag）
    nl_caption: str = ""
    # 后向兼容：旧字段名（v2.x 兼容）
    tags: str = ""
    nltags: str = ""
    pose_expression: str = ""          # 【v3.0 兼容】旧字段，映射到 pose_f

    @classmethod
    def parse(cls, data: dict) -> "GenerateRequest":
        """parse + validate。字段不合法抛 ValueError。"""
        req = cls(
            mode=str(data.get("mode", "basic")),
            prompt=str(data.get("prompt", "")),
            negative_prompt=str(data.get("negative_prompt", "")),
            seed=_int(data, "seed", -1),
            steps=_int(data, "steps", 20),
            cfg_scale=_float(data, "cfg_scale", 4.5),
            aspect_ratio=str(data.get("aspect_ratio", "3:4")),
            width=_int(data, "width", 0),
            height=_int(data, "height", 0),
            quality_meta_year_safe=str(data.get("quality_meta_year_safe", "")),
            count=str(data.get("count", "")),
            character=str(data.get("character", "")),
            series=str(data.get("series", "")),
            artist=str(data.get("artist", "")),
            # 【v3.0 新增】体型、饰品、身体装饰、表情、姿势(男女分开)、NSFW
            body_type_f=str(data.get("body_type_f", "")),
            body_type_m=str(data.get("body_type_m", "")),
            appearance=str(data.get("appearance", "")),
            outfit=str(data.get("outfit", "")),
            accessories=str(data.get("accessories", "")),
            body_decoration=str(data.get("body_decoration", "")),
            expression=str(data.get("expression", "")),
            pose_f=str(data.get("pose_f", "")),
            pose_m=str(data.get("pose_m", "")),
            nsfw_pose=str(data.get("nsfw_pose", "")),
            nsfw_interaction=str(data.get("nsfw_interaction", "")),
            composition=str(data.get("composition", "")),
            environment=str(data.get("environment", "")),
            style=str(data.get("style", "")),
            others=str(data.get("others", "")),
            nl_caption=str(data.get("nl_caption", "")),
            # 后向兼容（v2.x 旧字段）
            tags=str(data.get("tags", "")),
            nltags=str(data.get("nltags", "")),
            pose_expression=str(data.get("pose_expression", "")),
        )
        # 范围校验
        if not 1 <= req.steps <= 100:
            raise ValueError(f"steps 必须在 1–100 之间，当前: {req.steps}")
        if not 0.1 <= req.cfg_scale <= 30.0:
            raise ValueError(f"cfg_scale 必须在 0.1–30 之间，当前: {req.cfg_scale}")
        if req.width < 0 or req.height < 0:
            raise ValueError("width/height 不能为负数")
        if req.width > 4096 or req.height > 4096:
            raise ValueError("width/height 不能超过 4096")
        if req.mode not in ("basic", "advanced"):
            raise ValueError(f"无效 mode: {req.mode}")
        if req.mode == "basic" and not req.prompt.strip():
            raise ValueError("基础模式下 prompt 不能为空")
        return req


# ============================================================
# 图库
# ============================================================

@dataclass
class FavoriteRequest:
    path: str
    favorited: bool

    @classmethod
    def parse(cls, data: dict) -> "FavoriteRequest":
        path = str(data.get("path", ""))
        if not path:
            raise ValueError("path 不能为空")
        favorited = bool(data.get("favorited", False))
        return cls(path=path, favorited=favorited)


@dataclass
class DeleteRequest:
    paths: list[str]

    @classmethod
    def parse(cls, data: dict) -> "DeleteRequest":
        paths = data.get("paths", [])
        if not paths and data.get("path"):
            paths = [str(data["path"])]
        if not isinstance(paths, list):
            raise ValueError("paths 必须是数组")
        paths = [str(p) for p in paths if p]
        if not paths:
            raise ValueError("至少指定一个 path")
        if len(paths) > 200:
            raise ValueError("单次最多删除 200 张")
        return cls(paths=paths)


@dataclass
class ImagesQuery:
    """/api/images 查询参数。"""
    date: str | None = None
    limit: int = 200
    offset: int = 0
    tag: str | None = None
    favorited_only: bool = False

    @classmethod
    def parse(cls, params: dict) -> "ImagesQuery":
        limit = _int(params, "limit", 200)
        if not 1 <= limit <= 2000:
            raise ValueError(f"limit 必须在 1–2000 之间，当前: {limit}")
        offset = _int(params, "offset", 0)
        if offset < 0:
            raise ValueError("offset 不能为负数")
        return cls(
            date=params.get("date") or None,
            limit=limit,
            offset=offset,
            # 前端性能优化：把标签关键字作为通用查询条件传给后端，目的在于分页前先过滤。
            # 这里直接 trim 成 None/字符串，后续数据库查询与日期、收藏条件共享同一套组合逻辑。
            tag=(str(params.get("tag") or "").strip() or None),
            favorited_only=params.get("favorited") in ("1", "true"),
        )


# ============================================================
# 工具
# ============================================================

def _int(data: dict, key: str, default: int) -> int:
    try:
        return int(data.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"{key} 必须是整数")


def _float(data: dict, key: str, default: float) -> float:
    try:
        return float(data.get(key, default))
    except (TypeError, ValueError):
        raise ValueError(f"{key} 必须是数字")
