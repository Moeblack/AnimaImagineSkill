"""v2 CLI 入口。

替代 v1 的 server.py main()。
职责：加载配置 → 加载模型 → 导入历史数据 → 启动 queue worker → 启动 uvicorn。
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from anima_imagine.config import load_config
from anima_imagine.app import create_app


def main():
    """CLI 入口点。"""
    cfg = load_config()

    print("=" * 60)
    print("AnimaImagineSkill v2")
    print("=" * 60)

    asgi_app, components = create_app(cfg)
    pipeline = components["pipeline"]
    queue = components["queue"]
    db = components["db"]
    codex = components["codex"]
    storage = components["storage"]

    # 加载 GPU 模型（阻塞）
    pipeline.load()

    print(f"  Optimization : sage_attention={pipeline.sage_attention}, "
          f"compile={pipeline.compile_models}, "
          f"clear_cuda_cache={pipeline.clear_cuda_cache}")

    # 导入历史数据到 SQLite
    imported = db.import_all_from_output(Path(cfg.output_dir))
    if imported > 0:
        print(f"  DB Import    : {imported} new images indexed from existing files")
    total = db.count()
    print(f"  DB Total     : {total} images indexed")

    # 清理 .trash
    if cfg.trash_max_age_days > 0:
        cleaned = storage.cleanup_trash(cfg.trash_max_age_days)
        if cleaned > 0:
            print(f"  Trash Cleanup: {cleaned} old files removed")

    print(f"\n  MCP Endpoint : http://{cfg.host}:{cfg.port}/mcp/")
    print(f"  Gallery      : http://{cfg.host}:{cfg.port}/")
    print(f"  Health       : http://{cfg.host}:{cfg.port}/health")
    print(f"  Output Dir   : {Path(cfg.output_dir).resolve()}")
    print(f"  Database     : {Path(cfg.db_path).resolve()}")

    stats = codex.stats()
    if stats["fine_entries"] == 0:
        print(f"  Codex        : [WARN] 未加载任何法典条目")
    else:
        print(f"  Codex        : {stats['fine_entries']} entries, {stats['sections']} sections")

    if cfg.security_enabled:
        if not cfg.auth_token:
            print("  [WARN] security.enabled=true 但 auth_token 为空")
        print(f"  Security     : enabled | fail2ban={cfg.fail2ban_enabled}")
        if cfg.trusted_proxies:
            print(f"  Trusted Proxy: {', '.join(cfg.trusted_proxies)}")
    else:
        print("  Security     : disabled")

    print()

    # 启动：需要在事件循环中启动 queue worker
    import uvicorn

    class _Server(uvicorn.Server):
        """v2: 自定义 Server 以便在启动时初始化 queue worker。"""
        async def startup(self, sockets=None):
            await super().startup(sockets)
            # 启动 queue worker
            await queue.start()
            print("[Queue] Worker started")

        async def shutdown(self, sockets=None):
            await queue.stop()
            await super().shutdown(sockets)

    config = uvicorn.Config(
        asgi_app,
        host=cfg.host,
        port=cfg.port,
        log_level="info",
    )
    server = _Server(config)
    server.run()


if __name__ == "__main__":
    main()
