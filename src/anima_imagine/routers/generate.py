"""v2 生图路由。

包含：
- POST /api/generate — 提交生图任务
- GET /api/jobs/{job_id} — 查询任务状态
- POST /api/generate/sync — 同步生图（等待完成后返回，兼容旧前端）
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from anima_imagine.infra.queue import QueueFull
from anima_imagine.infra.security import get_client_ip, RateLimiter
from anima_imagine.schemas.schemas import GenerateRequest


def register_generate_routes(mcp, gen_service, cfg, rate_limiter: RateLimiter):
    """v2: 注册生图相关路由。"""

    @mcp.custom_route("/api/generate", methods=["POST"])
    async def api_generate(request: Request):
        """v2: 提交生图任务，立即返回 job_id。前端轮询状态。"""
        # 速率限制
        client_ip = get_client_ip(request, cfg.trusted_proxies)
        if not rate_limiter.is_allowed(client_ip):
            return JSONResponse(
                {"error": "生图请求过于频繁，请稍后再试"},
                status_code=429,
            )

        try:
            data = await request.json()
            req = GenerateRequest.parse(data)
        except (ValueError, Exception) as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        try:
            job = gen_service.submit_job(req)
        except QueueFull as e:
            return JSONResponse({"error": str(e)}, status_code=503)

        return JSONResponse({
            "status": "queued",
            "job_id": job.job_id,
            "queue_position": job.queue_position,
        })

    @mcp.custom_route("/api/generate/sync", methods=["POST"])
    async def api_generate_sync(request: Request):
        """v2: 同步生图（提交 + 等待完成）。兼容旧前端和简单调用场景。"""
        client_ip = get_client_ip(request, cfg.trusted_proxies)
        if not rate_limiter.is_allowed(client_ip):
            return JSONResponse({"error": "生图请求过于频繁"}, status_code=429)

        try:
            data = await request.json()
            req = GenerateRequest.parse(data)
        except (ValueError, Exception) as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        try:
            job = gen_service.submit_job(req)
        except QueueFull as e:
            return JSONResponse({"error": str(e)}, status_code=503)

        # 等待完成
        finished_job = await gen_service.queue.wait_for_job(job.job_id)
        if finished_job and finished_job.status.value == "succeeded":
            return JSONResponse({"status": "ok", "meta": finished_job.image_meta})
        error = finished_job.error if finished_job else "未知错误"
        return JSONResponse({"error": error}, status_code=500)

    @mcp.custom_route("/api/jobs/{job_id}", methods=["GET"])
    async def api_job_status(request: Request):
        """v2: 查询任务状态。"""
        job_id = request.path_params.get("job_id", "")
        job = gen_service.queue.get_job(job_id)
        if not job:
            return JSONResponse({"error": "任务不存在"}, status_code=404)
        return JSONResponse(job.to_dict())

    @mcp.custom_route("/api/queue", methods=["GET"])
    async def api_queue_status(request: Request):
        """v2: 队列状态。"""
        return JSONResponse(gen_service.queue.queue_status())
