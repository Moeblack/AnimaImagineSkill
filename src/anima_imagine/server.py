"""
AnimaImagineSkill MCP Server.

单进程启动，同时提供：
1. Streamable HTTP MCP 端点（/mcp/）—— AI 客户端调用 generate_anima_image 工具
2. 图片画廊网页（/）—— 瀑布流浏览 + 标签展示
3. 图片服务 API（/api/images、/api/image）

启动：
  python -m anima_imagine          # 或
  anima-imagine                    # 如果 pip install 了本包
配置：config.yaml（见 config.example.yaml），环境变量可覆盖。
"""

from __future__ import annotations

import base64
import io
import os
import json
from pathlib import Path

from fastmcp import FastMCP
from mcp.types import TextContent, ImageContent
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response

from anima_imagine.pipeline import AnimaPipeline
from anima_imagine.storage import ImageStorage
from anima_imagine.resolution import resolve_size
from anima_imagine.config import load_config, Config

# ============================================================
# 配置：config.yaml > 环境变量 > 默认值
# ============================================================
cfg: Config = load_config()

# ============================================================
# 全局实例
# ============================================================
mcp = FastMCP("AnimaImagine")
storage = ImageStorage(cfg.output_dir)
pipeline = AnimaPipeline(cfg=cfg)

# gallery.html 所在目录（和本文件同级）
_HERE = Path(__file__).resolve().parent


# ============================================================
# 内部：公共生图逻辑（供多个工具复用）
# ============================================================

from anima_imagine.prompt_builder import build_prompt

# 默认负面提示词（和 Skill 里推荐的一致）
_DEFAULT_NEG = (
    "worst quality, low quality, score_1, score_2, score_3, "
    "blurry, jpeg artifacts, sepia, bad hands, bad anatomy, "
    "extra fingers, missing fingers, anatomical nonsense"
)


async def _do_generate(
    prompt: str, negative_prompt: str, aspect_ratio: str,
    width: int, height: int, steps: int, seed: int, cfg_scale: float,
) -> list:
    """公共生图逻辑：推理 → 保存 → 返回 MCP 内容。供多个工具复用。"""
    w, h = resolve_size(aspect_ratio, width, height)

    image, actual_seed, gen_time = await pipeline.generate(
        prompt=prompt, negative_prompt=negative_prompt,
        width=w, height=h, steps=steps, seed=seed, cfg_scale=cfg_scale,
    )

    saved = storage.save(image, {
        "prompt": prompt, "negative_prompt": negative_prompt,
        "seed": actual_seed, "steps": steps,
        "width": w, "height": h,
        "cfg_scale": cfg_scale, "aspect_ratio": aspect_ratio,
        "generation_time": round(gen_time, 2),
    })

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    return [
        ImageContent(type="image", data=b64, mimeType="image/png"),
        TextContent(type="text", text=(
            f"Seed: {actual_seed} | {w}×{h} | {steps} steps | {gen_time:.1f}s\n"
            f"Saved: {saved['relative_path']}\n"
            f"Gallery: http://{cfg.host}:{cfg.port}/"
        )),
    ]


# ============================================================
# MCP 工具 1：结构化生图（推荐，服务端自动拼接 prompt）
# ============================================================
@mcp.tool()
async def generate_anima_image(
    quality_meta_year_safe: str = "masterpiece, best quality, newest, year 2025, safe",
    count: str = "1girl",
    character: str = "",
    series: str = "",
    appearance: str = "",
    artist: str = "",
    style: str = "",
    tags: str = "",
    nltags: str = "",
    environment: str = "",
    neg: str = _DEFAULT_NEG,
    seed: int = -1,
    steps: int = 20,
    aspect_ratio: str = "3:4",
    cfg_scale: float = 4.5,
) -> list:
    """Generate an Anima anime/illustration image with structured fields.

    服务端会按 Anima 固定标签顺序自动拼接 prompt，无需手动拼接。
    字段严格分离：character 只放角色名，series 只放作品名，tags 不含角色名/作品名。

    示例:
    generate_anima_image(
      count="1girl", character="hatsune miku", series="vocaloid",
      artist="@fkey", appearance="long twintails, aqua hair, aqua eyes",
      tags="upper body, smile, singing, microphone",
      environment="stage, spotlight, neon, night"
    )
    """
    # 服务端按固定顺序拼接，保证标签顺序正确
    prompt = build_prompt(
        quality_meta_year_safe=quality_meta_year_safe,
        count=count, character=character, series=series,
        appearance=appearance, artist=artist, style=style,
        tags=tags, nltags=nltags, environment=environment,
    )
    return await _do_generate(
        prompt=prompt, negative_prompt=neg, aspect_ratio=aspect_ratio,
        width=0, height=0, steps=steps, seed=seed, cfg_scale=cfg_scale,
    )


# ============================================================
# MCP 工具 2：Reroll（基于历史记录重新生成，可覆盖部分参数）
# ============================================================
@mcp.tool()
async def reroll_anima_image(
    filename: str,
    seed: int = -1,
    artist: str = "",
    tags: str = "",
    steps: int = 0,
    aspect_ratio: str = "",
    cfg_scale: float = 0,
) -> list:
    """Reroll: 基于一张已生成图片的参数重新生成，可覆盖部分参数。

    filename 来自上一次生成的返回值（如 "2026-04-15/140703_636473557.png"）。
    不传的参数保持原值，传了的参数覆盖原值。seed=-1 表示换随机种子。

    典型用法：
    - 换种子重抽：reroll_anima_image(filename="...", seed=-1)
    - 换画师：reroll_anima_image(filename="...", artist="@toridamono")
    - 换比例：reroll_anima_image(filename="...", aspect_ratio="16:9")
    """
    # 读取原始元数据
    meta = storage.get_meta_by_path(filename)
    if meta is None:
        return [TextContent(type="text", text=f"找不到记录: {filename}")]

    # 用原始参数，覆盖用户指定的字段
    orig_prompt = meta.get("prompt", "")
    orig_neg = meta.get("negative_prompt", _DEFAULT_NEG)

    # 如果用户指定了新 artist 或 tags，需要替换 prompt 中的对应部分
    # 简单策略：如果传了 artist/tags，用它们替换原 prompt 中的对应片段
    final_prompt = orig_prompt
    if artist:
        # 替换 prompt 中的画师标签（@开头的部分）
        import re
        final_prompt = re.sub(r'@[\w\s]+(?:\\[()][\w\s]*\\[()])?', artist, final_prompt, count=1)
        if artist not in final_prompt:
            # 原 prompt 中没有画师，追加到前面（角色名后面）
            final_prompt = final_prompt + ", " + artist
    if tags:
        final_prompt = final_prompt + ", " + tags

    return await _do_generate(
        prompt=final_prompt,
        negative_prompt=orig_neg,
        aspect_ratio=aspect_ratio or meta.get("aspect_ratio", "3:4"),
        width=0, height=0,
        steps=steps if steps > 0 else meta.get("steps", 20),
        seed=seed,
        cfg_scale=cfg_scale if cfg_scale > 0 else meta.get("cfg_scale", 4.5),
    )


# ============================================================
# 画廊路由：网页 + API
# ============================================================

@mcp.custom_route("/", methods=["GET"])
async def gallery_page(request: Request):
    """返回画廊 HTML 页面。"""
    html_path = _HERE / "gallery.html"
    html = html_path.read_text(encoding="utf-8")
    return HTMLResponse(html)


@mcp.custom_route("/api/images", methods=["GET"])
async def api_images(request: Request):
    """返回图片列表 JSON。

    参数:
      ?date=2026-07-15  指定日期
      ?limit=100        最大返回数
    """
    date = request.query_params.get("date")
    limit = int(request.query_params.get("limit", "200"))
    images = storage.list_images(date=date, limit=limit)
    dates = storage.list_dates()
    return JSONResponse({"dates": dates, "images": images})


@mcp.custom_route("/api/image", methods=["GET"])
async def serve_image(request: Request):
    """提供图片文件服务。

    参数:
      ?path=2026-07-15/143025_42.png     原图
      ?path=2026-07-15/143025_42.png&thumb=1  缩略图
    """
    rel_path = request.query_params.get("path", "")
    is_thumb = request.query_params.get("thumb", "0") in ("1", "true")

    if is_thumb:
        # 缩略图路径：插入 thumbs/ 并换后缀
        parts = rel_path.rsplit("/", 1)
        if len(parts) == 2:
            rel_path = f"{parts[0]}/thumbs/{parts[1].replace('.png', '.jpg')}"

    full_path = Path(cfg.output_dir) / rel_path

    # 安全检查：禁止路径穿越
    try:
        full_path.resolve().relative_to(Path(cfg.output_dir).resolve())
    except ValueError:
        return JSONResponse({"error": "forbidden"}, status_code=403)

    if not full_path.exists() or not full_path.is_file():
        return JSONResponse({"error": "not found"}, status_code=404)

    suffix = full_path.suffix.lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
    media_type = mime.get(suffix.lstrip("."), "application/octet-stream")

    return Response(content=full_path.read_bytes(), media_type=media_type)


@mcp.custom_route("/health", methods=["GET"])
async def health(request: Request):
    """健康检查。"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": pipeline.pipe is not None,
        "output_dir": str(Path(cfg.output_dir).resolve()),
        "device": cfg.device,
    })


# ============================================================
# 入口
# ============================================================
def main():
    """CLI 入口点。"""
    print("=" * 60)
    print("AnimaImagineSkill")
    print("=" * 60)

    # 加载模型（阻塞直到完成）
    pipeline.load()

    print(f"\n  MCP Endpoint : http://{cfg.host}:{cfg.port}/mcp/")
    print(f"  Gallery      : http://{cfg.host}:{cfg.port}/")
    print(f"  Health       : http://{cfg.host}:{cfg.port}/health")
    print(f"  Output Dir   : {Path(cfg.output_dir).resolve()}")
    print()

    # 启动 Streamable HTTP MCP 服务
    # fastmcp 会自动用 uvicorn 跑 Starlette 应用
    mcp.run(transport="streamable-http", host=cfg.host, port=cfg.port)


if __name__ == "__main__":
    main()
