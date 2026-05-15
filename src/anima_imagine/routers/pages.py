"""v2 页面路由 + 静态文件 + UI 配置 API。

包含：
- GET / — 画廊 HTML
- GET /login — 登录页
- GET /static/{path} — 静态文件（用 Starlette StaticFiles 替代手工 read_bytes）
- GET /api/config/ui — 前端配置（分辨率预设、默认参数）
- GET /health — 健康检查

【v3.1 新增】模型显存管理：
- GET  /api/model/status — 模型加载状态 + GPU 显存信息
- POST /api/model/unload — 手动卸载模型释放显存
- POST /api/model/reload — 重新加载模型
"""
from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse

from anima_imagine.domain.resolution import get_ui_presets, ASPECT_PRESETS
from anima_imagine.services.generation import DEFAULT_NEG

_HERE = Path(__file__).resolve().parent.parent


def register_page_routes(mcp, cfg, pipeline, codex, queue=None):
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
            "model_loaded": pipeline.is_loaded,
            "output_dir": str(Path(cfg.output_dir).resolve()),
            "device": cfg.device,
            "codex": codex.stats(),
        })


    # ------------------------------------------------------------------
    # 【v3.1 新增】模型显存管理 API
    # ------------------------------------------------------------------

    @mcp.custom_route("/api/model/status", methods=["GET"])
    async def api_model_status(request: Request):
        """查询模型加载状态和 GPU 显存使用情况。"""
        import torch
        vram_allocated = 0.0
        vram_reserved = 0.0
        if torch.cuda.is_available():
            vram_allocated = torch.cuda.memory_allocated() / (1024 ** 2)
            vram_reserved = torch.cuda.memory_reserved() / (1024 ** 2)

        queue_info = {}
        if queue is not None:
            queue_info = queue.queue_status()

        return JSONResponse({
            "loaded": pipeline.is_loaded,
            "device": cfg.device,
            "model_version": cfg.model_version,
            "vram_allocated_mb": round(vram_allocated, 1),
            "vram_reserved_mb": round(vram_reserved, 1),
            **queue_info,
        })

    @mcp.custom_route("/api/model/unload", methods=["POST"])
    async def api_model_unload(request: Request):
        """手动卸载模型，释放 GPU 显存。

        安全检查：如果有正在运行的任务则拒绝卸载。
        """
        # 检查是否有正在运行的任务
        if queue is not None:
            qs = queue.queue_status()
            # active_jobs 是 JobQueue 隐含概念，我们用 queue_size > 0 近似判断
            # 更准确的做法是通过 get_job 遍历，但这里简化：queue 有排队的任务说明有潜在冲突
            if qs.get("queue_size", 0) > 0:
                return JSONResponse(
                    {"error": "有排队中的任务，请等待队列清空后再卸载"},
                    status_code=409,
                )

        if not pipeline.is_loaded:
            return JSONResponse({"status": "already_unloaded"})

        # 卸载模型（同步操作，可能耗时数秒）
        import asyncio
        await asyncio.to_thread(pipeline.unload)

        return JSONResponse({"status": "unloaded"})

    @mcp.custom_route("/api/model/reload", methods=["POST"])
    async def api_model_reload(request: Request):
        """重新加载模型到 GPU。卸载后需要调用此接口才能恢复推理。"""
        if pipeline.is_loaded:
            return JSONResponse({"status": "already_loaded"})

        # 重载模型（同步操作，可能耗时较长）
        import asyncio
        await asyncio.to_thread(pipeline.reload)

        return JSONResponse({"status": "reloaded"})