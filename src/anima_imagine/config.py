"""v2 配置加载模块。

优先级（从高到低）：
1. 环境变量（ANIMA_*）—— 方便 Docker / CI
2. config.yaml —— 本地开发
3. 内置默认值

相对于 v1 的变更：
- 新增 db_path、trusted_proxies、rate_limit_*、job_timeout_seconds、
  trash_max_age_days 字段，支撑 v2 架构的安全 / 数据 / 任务调度需求。
- 移除了 _parse_simple_yaml 中的 float 解析缺失，现在会尝试 float 转换。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Config:
    """AnimaImagineSkill 全局配置。"""

    # --- 服务器 ---
    host: str = "0.0.0.0"
    port: int = 8000

    # --- 模型 ---
    model_dir: str = ""
    model_version: str = "preview3"
    device: str = "cuda"
    low_vram: bool = False

    # --- 性能优化 ---
    sage_attention: bool = True
    compile_models: bool = True
    clear_cuda_cache: bool = False

    # --- Tokenizer ---
    qwen_tokenizer_path: str = ""
    t5xxl_tokenizer_path: str = ""

    # --- 安全 ---
    security_enabled: bool = False
    auth_token: str = ""
    fail2ban_enabled: bool = False
    fail2ban_max_attempts: int = 5
    fail2ban_window_seconds: int = 300
    fail2ban_ban_seconds: int = 3600
    # v2: trusted proxy 列表，只有来自这些 IP 的请求才信任 X-Forwarded-For
    trusted_proxies: list[str] = field(default_factory=list)
    # v2: 速率限制（每个 IP 每分钟最多多少次生图请求）
    rate_limit_generate_per_minute: int = 10

    # --- 数据 ---
    output_dir: str = "./output"
    # v2: SQLite 索引数据库路径，默认放在 output_dir 同级
    db_path: str = "./output/anima.db"

    # --- 任务调度 ---
    # v2: 单个生图任务超时（秒），超过则标记失败
    job_timeout_seconds: int = 300

    # --- 清理 ---
    # v2: .trash 保留天数，超过则自动清理。0 = 不自动清理
    trash_max_age_days: int = 30


def _load_yaml(path: str) -> dict[str, Any]:
    """加载 YAML 文件。不强制依赖 PyYAML，找不到就返回空字典。"""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        import yaml  # type: ignore
        return yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except ImportError:
        return _parse_simple_yaml(p.read_text(encoding="utf-8"))


def _parse_simple_yaml(text: str) -> dict[str, Any]:
    """最简单的 YAML 解析器：支持嵌套一层 section。

    相对 v1 修复：增加了 float 解析，解决 cfg_scale 等小数配置丢失的问题。
    """
    result: dict[str, Any] = {}
    current_section: dict[str, Any] | None = None

    for line in text.splitlines():
        stripped = line.split("#")[0].rstrip()
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip())
        if indent == 0 and stripped.endswith(":"):
            section_name = stripped[:-1].strip()
            result[section_name] = {}
            current_section = result[section_name]
        elif indent > 0 and current_section is not None and ":" in stripped:
            key, _, val = stripped.partition(":")
            val = val.strip().strip('"').strip("'")
            if val.lower() in ("true", "false"):
                current_section[key.strip()] = val.lower() == "true"
            else:
                try:
                    current_section[key.strip()] = int(val)
                except ValueError:
                    try:
                        current_section[key.strip()] = float(val)
                    except ValueError:
                        current_section[key.strip()] = val
    return result


def load_config(yaml_path: str = "config.yaml") -> Config:
    """加载配置：YAML → 环境变量覆盖 → Config 对象。"""
    data = _load_yaml(yaml_path)

    srv = data.get("server", {})
    mdl = data.get("model", {})
    opt = data.get("optimization", {})
    tok = data.get("tokenizer", {})
    sec = data.get("security", {})
    out = data.get("output", {})
    sched = data.get("scheduler", {})
    clean = data.get("cleanup", {})

    def _bool_env(name: str, default: bool) -> bool:
        val = os.getenv(name)
        if val is None:
            return default
        return val.lower() in ("true", "1", "yes", "on")

    # trusted_proxies 可以是逗号分隔的环境变量或 YAML 列表
    tp_env = os.getenv("ANIMA_TRUSTED_PROXIES", "")
    tp_yaml = sec.get("trusted_proxies", [])
    if isinstance(tp_yaml, str):
        tp_yaml = [s.strip() for s in tp_yaml.split(",") if s.strip()]
    trusted = [s.strip() for s in tp_env.split(",") if s.strip()] if tp_env else tp_yaml

    output_dir = os.getenv("ANIMA_OUTPUT_DIR", out.get("dir", "./output"))

    return Config(
        host=os.getenv("ANIMA_HOST", srv.get("host", "0.0.0.0")),
        port=int(os.getenv("ANIMA_PORT", srv.get("port", 8000))),
        model_dir=os.getenv("ANIMA_MODEL_DIR", mdl.get("model_dir", "")),
        model_version=os.getenv("ANIMA_MODEL_VERSION", mdl.get("model_version", "preview3")),
        device=os.getenv("ANIMA_DEVICE", mdl.get("device", "cuda")),
        low_vram=_bool_env("ANIMA_LOW_VRAM", mdl.get("low_vram", False)),
        sage_attention=_bool_env("ANIMA_SAGE_ATTENTION", opt.get("sage_attention", True)),
        compile_models=_bool_env("ANIMA_COMPILE_MODELS", opt.get("compile_models", True)),
        clear_cuda_cache=_bool_env("ANIMA_CLEAR_CUDA_CACHE", opt.get("clear_cuda_cache", False)),
        qwen_tokenizer_path=os.getenv("ANIMA_QWEN_TOKENIZER", tok.get("qwen_path", "")),
        t5xxl_tokenizer_path=os.getenv("ANIMA_T5XXL_TOKENIZER", tok.get("t5xxl_path", "")),
        security_enabled=_bool_env("ANIMA_SECURITY_ENABLED", sec.get("enabled", False)),
        auth_token=os.getenv("ANIMA_AUTH_TOKEN", sec.get("auth_token", "")),
        fail2ban_enabled=_bool_env("ANIMA_FAIL2BAN_ENABLED", sec.get("fail2ban_enabled", False)),
        fail2ban_max_attempts=int(os.getenv("ANIMA_FAIL2BAN_MAX_ATTEMPTS", sec.get("fail2ban_max_attempts", 5))),
        fail2ban_window_seconds=int(os.getenv("ANIMA_FAIL2BAN_WINDOW_SECONDS", sec.get("fail2ban_window_seconds", 300))),
        fail2ban_ban_seconds=int(os.getenv("ANIMA_FAIL2BAN_BAN_SECONDS", sec.get("fail2ban_ban_seconds", 3600))),
        trusted_proxies=trusted,
        rate_limit_generate_per_minute=int(os.getenv(
            "ANIMA_RATE_LIMIT_GENERATE",
            sec.get("rate_limit_generate_per_minute", 10),
        )),
        output_dir=output_dir,
        db_path=os.getenv("ANIMA_DB_PATH", out.get("db_path", str(Path(output_dir) / "anima.db"))),
        job_timeout_seconds=int(os.getenv("ANIMA_JOB_TIMEOUT", sched.get("job_timeout_seconds", 300))),
        trash_max_age_days=int(os.getenv("ANIMA_TRASH_MAX_AGE_DAYS", clean.get("trash_max_age_days", 30))),
    )
