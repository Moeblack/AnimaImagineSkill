"""\u3010v3.0 \u65b0\u589e\u3011\u7528\u6237\u504f\u597d\u8def\u7531\u3002

\u5b9e\u73b0\u63d0\u793a\u8bcd\u7f13\u5b58\u3001\u5b57\u6bb5\u9884\u8bbe\u3001\u81ea\u5b9a\u4e49\u6807\u7b7e\u7b49\u7684\u5168\u5e73\u53f0\u540c\u6b65\u3002
\u6570\u636e\u5b58\u50a8\u5728 SQLite user_preferences \u8868\u4e2d\uff0c\u800c\u4e0d\u662f\u6d4f\u89c8\u5668 localStorage\u3002

API:
- GET  /api/preferences?keys=k1,k2,...  \u2192 \u6279\u91cf\u83b7\u53d6
- GET  /api/preferences?prefix=xxx      \u2192 \u6309\u524d\u7f00\u67e5\u627e
- PUT  /api/preferences                 \u2192 \u8bbe\u7f6e\u5355\u4e2a\u504f\u597d
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from anima_imagine.infra.db import ImageDB


def register_preferences_routes(mcp, db: ImageDB):
    """\u3010v3.0\u3011\u6ce8\u518c\u7528\u6237\u504f\u597d API \u8def\u7531\u3002"""

    @mcp.custom_route("/api/preferences", methods=["GET"])
    async def api_get_preferences(request: Request):
        """\u83b7\u53d6\u504f\u597d\u3002\u652f\u6301 keys=k1,k2 \u6216 prefix=xxx \u4e24\u79cd\u6a21\u5f0f\u3002"""
        keys_param = request.query_params.get("keys", "")
        prefix_param = request.query_params.get("prefix", "")

        if keys_param:
            keys = [k.strip() for k in keys_param.split(",") if k.strip()]
            result = db.get_preferences(keys)
        elif prefix_param:
            result = db.list_preferences_by_prefix(prefix_param)
        else:
            return JSONResponse({"error": "\u9700\u8981 keys \u6216 prefix \u53c2\u6570"}, status_code=400)

        return JSONResponse(result)

    @mcp.custom_route("/api/preferences", methods=["PUT"])
    async def api_set_preference(request: Request):
        """\u8bbe\u7f6e\u5355\u4e2a\u504f\u597d\u3002body: { key: '...', value: '...' }\u3002"""
        try:
            data = await request.json()
        except Exception:
            return JSONResponse({"error": "\u65e0\u6548 JSON"}, status_code=400)

        key = data.get("key", "").strip()
        value = data.get("value", "")
        if not key:
            return JSONResponse({"error": "key \u4e0d\u80fd\u4e3a\u7a7a"}, status_code=400)
        if not isinstance(value, str):
            value = str(value)

        db.set_preference(key, value)
        return JSONResponse({"status": "ok", "key": key})
