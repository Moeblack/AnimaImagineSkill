# -*- coding: utf-8 -*-
"""v2 安全模块测试。

覆盖：
- Cookie 签名/验证
- Fail2Ban 封禁逻辑
- Trusted proxy IP 获取
- RateLimiter
"""
import unittest
from unittest.mock import MagicMock

from anima_imagine.config import Config
from anima_imagine.infra.security import (
    make_session_cookie, verify_session_cookie,
    Fail2Ban, RateLimiter, get_client_ip,
)


class TestCookie(unittest.TestCase):
    def test_sign_verify(self):
        token = "my_secret"
        cookie = make_session_cookie(token)
        self.assertTrue(verify_session_cookie(cookie, token))

    def test_wrong_token(self):
        cookie = make_session_cookie("correct")
        self.assertFalse(verify_session_cookie(cookie, "wrong"))


class TestFail2Ban(unittest.TestCase):
    def test_ban_after_max_attempts(self):
        cfg = Config(fail2ban_enabled=True, fail2ban_max_attempts=3, fail2ban_window_seconds=60, fail2ban_ban_seconds=60)
        f2b = Fail2Ban(cfg)
        for _ in range(3):
            f2b.record_fail("1.2.3.4")
        self.assertTrue(f2b.is_banned("1.2.3.4"))

    def test_no_ban_when_disabled(self):
        cfg = Config(fail2ban_enabled=False)
        f2b = Fail2Ban(cfg)
        for _ in range(100):
            f2b.record_fail("1.2.3.4")
        self.assertFalse(f2b.is_banned("1.2.3.4"))


class TestTrustedProxy(unittest.TestCase):
    def test_direct_ip_when_no_trusted(self):
        """v2: 没有 trusted proxy 时，忽略 X-Forwarded-For。"""
        req = MagicMock()
        req.client.host = "10.0.0.1"
        req.headers = {"x-forwarded-for": "evil.ip"}
        ip = get_client_ip(req, trusted_proxies=[])
        self.assertEqual(ip, "10.0.0.1")

    def test_forwarded_when_trusted(self):
        req = MagicMock()
        req.client.host = "127.0.0.1"
        req.headers = {"x-forwarded-for": "real.user.ip"}
        ip = get_client_ip(req, trusted_proxies=["127.0.0.1"])
        self.assertEqual(ip, "real.user.ip")


class TestRateLimiter(unittest.TestCase):
    def test_allows_within_limit(self):
        rl = RateLimiter(max_per_minute=3)
        self.assertTrue(rl.is_allowed("ip1"))
        self.assertTrue(rl.is_allowed("ip1"))
        self.assertTrue(rl.is_allowed("ip1"))
        self.assertFalse(rl.is_allowed("ip1"))

    def test_different_ips(self):
        rl = RateLimiter(max_per_minute=1)
        self.assertTrue(rl.is_allowed("ip1"))
        self.assertTrue(rl.is_allowed("ip2"))


if __name__ == "__main__":
    unittest.main()
