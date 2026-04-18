"""v2 页面路由 + 静态文件 + UI 配置 API。

包含：
- GET / — 画廊 HTML
- GET /login — 登录页
- GET /static/{path} — 静态文件（用 Starlette StaticFiles 替代手工 read_bytes）
- GET /api/config/ui — 前端配置（分辨率预设、默认参数）
- GET /health — 健康检查
"""
from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from anima_imagine.domain.resolution import get_ui_presets, ASPECT_PRESETS
from anima_imagine.services.generation import DEFAULT_NEG

_HERE = Path(__file__).resolve().parent.parent


def register_page_routes(mcp, cfg, pipeline, codex):
    """v2: 注册页面和工具 API 路由。"""

    @mcp.custom_route("/", methods=["GET"])
    async def gallery_page(request: Request):
        html = (_HERE / "gallery.html").read_text(encoding="utf-8")
        return HTMLResponse(html)

    @mcp.custom_route("/login", methods=["GET"])
    async def login_page(request: Request):
        html = (_HERE / "login.html").read_text(encoding="utf-8")
        return HTMLResponse(html)

    @mcp.custom_route("/api/config/ui", methods=["GET"])
    async def api_ui_config(request: Request):
        """v2: 前端从这里获取分辨率预设 + 默认参数，不再自行计算。"""
        return JSONResponse({
            "presets": get_ui_presets(),
            "default_negative_prompt": DEFAULT_NEG,
            "default_steps": 20,
            "default_cfg_scale": 4.5,
            "default_aspect_ratio": "3:4",
        })

    @mcp.custom_route("/health", methods=["GET"])
    async def health(request: Request):
        return JSONResponse({
            "status": "ok",
            "model_loaded": pipeline.pipe is not None,
            "output_dir": str(Path(cfg.output_dir).resolve()),
            "device": cfg.device,
            "codex": codex.stats(),
        })
