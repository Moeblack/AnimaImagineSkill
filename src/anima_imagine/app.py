"""v2 App Factory。

将所有组件组装成一个 ASGI app：
- 创建基础设施实例（DB、Storage、Pipeline、Queue、Security）
- 创建服务层实例
- 注册所有路由和 MCP 工具
- 挂载中间件
- 返回 ASGI app

替代 v1 的全局变量 + server.py 单文件架构。
"""
from __future__ import annotations

from pathlib import Path

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.staticfiles import StaticFiles

from anima_imagine.config import Config
from anima_imagine.infra.db import ImageDB
from anima_imagine.infra.pipeline import AnimaPipeline
from anima_imagine.infra.queue import JobQueue
from anima_imagine.infra.security import Fail2Ban, RateLimiter, SecurityMiddleware
from anima_imagine.infra.storage import FileStorage
from anima_imagine.services.auth import AuthService
from anima_imagine.services.codex import create_codex_index
from anima_imagine.services.gallery import GalleryService
from anima_imagine.services.generation import GenerationService
from anima_imagine.routers.auth import register_auth_routes
from anima_imagine.routers.gallery import register_gallery_routes
from anima_imagine.routers.generate import register_generate_routes
from anima_imagine.routers.mcp import register_mcp_tools
from anima_imagine.routers.pages import register_page_routes
from anima_imagine.routers.preferences import register_preferences_routes


_HERE = Path(__file__).resolve().parent


def create_app(cfg: Config) -> tuple:
    """v2 App Factory。

    返回 (asgi_app, components_dict)，后者含 pipeline/queue 等，供 main() 调用。
    """
    # --- 基础设施 ---
    db = ImageDB(cfg.db_path)
    storage = FileStorage(cfg.output_dir)
    pipeline = AnimaPipeline(cfg)
    fail2ban = Fail2Ban(cfg)
    rate_limiter = RateLimiter(cfg.rate_limit_generate_per_minute)

    # --- 服务 ---
    auth_service = AuthService(cfg, fail2ban)
    gallery_service = GalleryService(db, storage)
    gen_service = GenerationService(pipeline, storage, db, queue=None)  # queue 稍后设置

    # --- 任务队列（需要 gen_service.execute_job 作为 executor）---
    job_queue = JobQueue(
        executor=gen_service.execute_job,
        timeout_seconds=cfg.job_timeout_seconds,
    )
    gen_service.queue = job_queue  # 回填

    # --- 法典 ---
    codex = create_codex_index()

    # --- MCP 实例 ---
    mcp = FastMCP("AnimaImagine")

    # --- 注册路由 ---
    register_auth_routes(mcp, auth_service, cfg)
    register_gallery_routes(mcp, gallery_service, cfg)
    register_generate_routes(mcp, gen_service, cfg, rate_limiter)
    register_page_routes(mcp, cfg, pipeline, codex)
    register_mcp_tools(mcp, gen_service, codex, cfg)
    # 【v3.0 新增】用户偏好 API（提示词缓存/预设/自定义标签全平台同步）
    register_preferences_routes(mcp, db)

    # --- 中间件 ---
    user_middleware = []
    if cfg.security_enabled:
        user_middleware.append(
            Middleware(SecurityMiddleware, cfg=cfg, fail2ban=fail2ban)
        )

    # --- ASGI App ---
    # v2: 使用 StaticFiles 替代手工 read_bytes，支持缓存头和流式传输
    # 注意：StaticFiles 需要通过 Starlette mount，而 FastMCP 的 http_app 可能不支持。
    # 因此保留手动路由作为 fallback，同时尝试用 StaticFiles mount。
    import mimetypes
    from starlette.requests import Request
    from starlette.responses import Response, JSONResponse

    @mcp.custom_route("/static/{path:path}", methods=["GET"])
    async def serve_static(request: Request):
        """v2: 静态文件服务。使用 FileResponse 替代 read_bytes。"""
        from starlette.responses import FileResponse
        rel_path = request.path_params.get("path", "")
        full_path = _HERE / "static" / rel_path
        try:
            full_path.resolve().relative_to((_HERE / "static").resolve())
        except ValueError:
            return JSONResponse({"error": "forbidden"}, status_code=403)
        if not full_path.exists() or not full_path.is_file():
            return JSONResponse({"error": "not found"}, status_code=404)
        return FileResponse(full_path)

    asgi_app = mcp.http_app(
        transport="streamable-http",
        middleware=user_middleware,
    )

    return asgi_app, {
        "mcp": mcp,
        "pipeline": pipeline,
        "queue": job_queue,
        "db": db,
        "storage": storage,
        "codex": codex,
        "cfg": cfg,
        "fail2ban": fail2ban,
    }
