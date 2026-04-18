"""v2 认证路由。

职责：只做请求解析 → 调用 AuthService → 返回响应。
"""
from __future__ import annotations

from starlette.requests import Request
from starlette.responses import JSONResponse

from anima_imagine.infra.security import get_client_ip
from anima_imagine.schemas.schemas import LoginRequest


def register_auth_routes(mcp, auth_service, cfg):
    """v2: 注册认证相关路由。"""

    @mcp.custom_route("/api/login", methods=["POST"])
    async def api_login(request: Request):
        """v2: 登录 API。统一输入校验 + 错误响应。"""
        try:
            data = await request.json()
            req = LoginRequest.parse(data)
        except (ValueError, Exception) as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        client_ip = get_client_ip(request, cfg.trusted_proxies)

        result = auth_service.verify_token(req.token, client_ip)
        if result:
            resp = JSONResponse({"status": "ok"})
            resp.set_cookie(
                key=result["cookie_name"],
                value=result["cookie_value"],
                httponly=True,
                samesite="lax",
                max_age=86400 * 30,
            )
            return resp

        # 认证失败：检查是否被封禁
        if auth_service.fail2ban.is_banned(client_ip):
            return JSONResponse({"error": "IP banned"}, status_code=403)
        return JSONResponse({"error": "密码错误"}, status_code=401)
