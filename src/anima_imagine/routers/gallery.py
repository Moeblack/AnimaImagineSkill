"""v2 图库路由。

包含：
- GET /api/images — 图片列表
- GET /api/image — 提供图片文件
- POST /api/image/favorite — 收藏
- POST /api/image/delete — 删除
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse, FileResponse

from anima_imagine.schemas.schemas import FavoriteRequest, DeleteRequest, ImagesQuery


def register_gallery_routes(mcp, gallery_service, cfg):
    """v2: 注册图库路由。"""

    @mcp.custom_route("/api/images", methods=["GET"])
    async def api_images(request: Request):
        """v2: 从 SQLite 查询图片列表。支持分页和收藏筛选。"""
        try:
            query = ImagesQuery.parse(dict(request.query_params))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        result = gallery_service.list_images(
            date=query.date,
            limit=query.limit,
            offset=query.offset,
            favorited_only=query.favorited_only,
        )
        return JSONResponse(result)

    @mcp.custom_route("/api/image", methods=["GET"])
    async def serve_image(request: Request):
        """v2: 使用 FileResponse 替代 read_bytes()，避免阻塞事件循环。"""
        rel_path = request.query_params.get("path", "")
        is_thumb = request.query_params.get("thumb", "0") in ("1", "true")

        if is_thumb:
            full = gallery_service.get_thumb_path(rel_path)
        else:
            full = gallery_service.get_image_path(rel_path)

        if not full:
            return JSONResponse({"error": "not found"}, status_code=404)

        # v2: 使用 FileResponse，支持流式传输和缓存头
        return FileResponse(full)

    @mcp.custom_route("/api/image/favorite", methods=["POST"])
    async def api_favorite(request: Request):
        """v2: 收藏状态通过 SQLite 保证一致性。"""
        try:
            data = await request.json()
            req = FavoriteRequest.parse(data)
        except (ValueError, Exception) as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        # req.path 格式: "YYYY-MM-DD/HHMMSS_seed.png"
        image_id = req.path.replace(".png", "")
        ok = gallery_service.set_favorite(image_id, req.favorited)
        if not ok:
            return JSONResponse({"error": "not found"}, status_code=404)
        return JSONResponse({"status": "ok", "favorited": req.favorited})

    @mcp.custom_route("/api/image/delete", methods=["POST"])
    async def api_delete(request: Request):
        """v2: 软删除 + .trash。通过 SQLite + 文件系统双写保证一致性。"""
        try:
            data = await request.json()
            req = DeleteRequest.parse(data)
        except (ValueError, Exception) as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        # 解析 image_id：去掉 .png 后缀
        image_ids = [p.replace(".png", "") for p in req.paths]
        deleted = gallery_service.delete_images(image_ids)
        return JSONResponse({"status": "ok", "deleted": deleted, "count": len(deleted)})
