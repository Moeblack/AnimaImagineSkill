"""v2 认证服务。"""
from __future__ import annotations

from anima_imagine.config import Config
from anima_imagine.infra.security import (
    Fail2Ban,
    make_session_cookie,
    COOKIE_NAME,
)


class AuthService:
    """v2 认证服务。"""

    def __init__(self, cfg: Config, fail2ban: Fail2Ban):
        self.cfg = cfg
        self.fail2ban = fail2ban

    def verify_token(self, token: str, client_ip: str) -> dict | None:
        """验证登录 token。

        成功返回 {cookie_name, cookie_value}，失败返回 None。
        """
        if self.fail2ban.is_banned(client_ip):
            return None

        if token == self.cfg.auth_token and self.cfg.auth_token:
            return {
                "cookie_name": COOKIE_NAME,
                "cookie_value": make_session_cookie(self.cfg.auth_token),
            }

        self.fail2ban.record_fail(client_ip)
        return None
