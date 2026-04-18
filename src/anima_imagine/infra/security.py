"""v2 安全基础设施。

从 server.py 抽出并增强：
- Fail2Ban 独立类（不变）
- Cookie 签名工具函数（不变）
- 新增 trusted proxy 逻辑：只有来自可信代理的请求才信任 X-Forwarded-For
- 新增简单速率限制器（内存级，基于滑动窗口）
- SecurityMiddleware 重构为使用上述组件
"""
from __future__ import annotations

import hmac
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse

from anima_imagine.config import Config

# ============================================================
# Cookie 签名
# ============================================================

COOKIE_NAME = "_anima_session"
_HMAC_MESSAGE = b"anima_session"


def make_session_cookie(auth_token: str) -> str:
    """HMAC-SHA256 无状态 session cookie。"""
    return hmac.new(auth_token.encode(), _HMAC_MESSAGE, "sha256").hexdigest()


def verify_session_cookie(cookie_value: str, auth_token: str) -> bool:
    """常量时间比对，防 timing attack。"""
    expected = make_session_cookie(auth_token)
    return hmac.compare_digest(cookie_value, expected)


# ============================================================
# Trusted Proxy — 只有可信 IP 的 X-Forwarded-For 才被采纳
# ============================================================

def get_client_ip(request: Request, trusted_proxies: list[str]) -> str:
    """v2: 安全地获取客户端真实 IP。

    只在直连 IP 属于 trusted_proxies 时才信任 X-Forwarded-For 头。
    否则用直连 IP，防止客户端伪造。
    """
    direct_ip = request.client.host if request.client else "unknown"
    if not trusted_proxies or direct_ip not in trusted_proxies:
        return direct_ip
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return direct_ip


# ============================================================
# Fail2Ban
# ============================================================

class Fail2Ban:
    """内存级 IP 封禁。线程安全靠 asyncio 单线程模型保证。"""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._banned_ips: dict[str, float] = {}
        self._failed_attempts: dict[str, list[float]] = {}

    def is_banned(self, client_ip: str) -> bool:
        if not self.cfg.fail2ban_enabled:
            return False
        now = time.time()
        ban_until = self._banned_ips.get(client_ip)
        if ban_until is None:
            return False
        if now < ban_until:
            return True
        del self._banned_ips[client_ip]
        return False

    def record_fail(self, client_ip: str):
        if not self.cfg.fail2ban_enabled:
            return
        now = time.time()
        attempts = self._failed_attempts.get(client_ip, [])
        window = self.cfg.fail2ban_window_seconds
        attempts = [t for t in attempts if now - t < window]
        attempts.append(now)
        self._failed_attempts[client_ip] = attempts
        if len(attempts) >= self.cfg.fail2ban_max_attempts:
            self._banned_ips[client_ip] = now + self.cfg.fail2ban_ban_seconds
            del self._failed_attempts[client_ip]


# ============================================================
# 简单速率限制器（内存级，滑动窗口）
# ============================================================

class RateLimiter:
    """v2: 每个 IP 每分钟最多 N 次生图请求。"""

    def __init__(self, max_per_minute: int = 10):
        self.max_per_minute = max_per_minute
        self._windows: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, client_ip: str) -> bool:
        if self.max_per_minute <= 0:
            return True
        now = time.time()
        window = self._windows[client_ip]
        # 清理 60s 前的记录
        window[:] = [t for t in window if now - t < 60]
        if len(window) >= self.max_per_minute:
            return False
        window.append(now)
        return True


# ============================================================
# 统一安全中间件
# ============================================================

_PUBLIC_PATHS = frozenset({"/login", "/api/login"})


class SecurityMiddleware(BaseHTTPMiddleware):
    """v2 统一认证中间件。

    相对 v1 的改进：
    - 使用 trusted proxy 逻辑获取 IP，不再无条件信任 X-Forwarded-For
    - 将 fail2ban 实例从外部注入，避免全局状态
    """

    def __init__(self, app, cfg: Config, fail2ban: Fail2Ban):
        super().__init__(app)
        self.cfg = cfg
        self._f2b = fail2ban

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if path in _PUBLIC_PATHS:
            return await call_next(request)

        client_ip = get_client_ip(request, self.cfg.trusted_proxies)

        if self._f2b.is_banned(client_ip):
            return JSONResponse({"error": "IP banned"}, status_code=403)

        # MCP 端点：Bearer Token
        if path.startswith("/mcp"):
            expected = f"Bearer {self.cfg.auth_token}"
            auth_header = request.headers.get("authorization", "")
            if auth_header != expected:
                self._f2b.record_fail(client_ip)
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            return await call_next(request)

        # 其他路径：Cookie
        cookie_val = request.cookies.get(COOKIE_NAME, "")
        if cookie_val and verify_session_cookie(cookie_val, self.cfg.auth_token):
            return await call_next(request)

        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            return RedirectResponse(url="/login", status_code=302)
        return JSONResponse({"error": "Unauthorized", "login": "/login"}, status_code=401)
