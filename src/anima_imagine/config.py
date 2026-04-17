"""
配置加载模块。

优先级（从高到低）：
1. 环境变量（ANIMA_*）—— 方便 Docker / CI
2. config.yaml —— 本地开发
3. 内置默认值

所有相对路径以服务启动时的工作目录为基准。
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
    model_dir: str = ""       # 留空 = 从 HF 自动下载
    # Anima 版本：preview / preview2 / preview3
    # 决定加载哪个 DiT 权重文件，text_encoder 和 vae 三版本共用
    model_version: str = "preview3"
    device: str = "cuda"
    low_vram: bool = False

    # --- 性能优化 ---
    # 启用 SageAttention（仅作用于 DiT，text_encoder / VAE 不受影响）
    sage_attention: bool = True
    # 启用 torch.compile 加速 DiT（常驻服务建议开启，首次生成有预热）
    compile_models: bool = True
    # 每次生成后是否强制清空 CUDA 缓存（常驻服务建议关闭）
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

    # --- 输出 ---
    output_dir: str = "./output"


def _load_yaml(path: str) -> dict[str, Any]:
    """加载 YAML 文件。不强制依赖 PyYAML，找不到就返回空字典。"""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        import yaml  # type: ignore
        return yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    except ImportError:
        # 没装 PyYAML，用简单的行解析做兆底
        # 只支持最外层 key: value（平坦格式）
        return _parse_simple_yaml(p.read_text(encoding="utf-8"))


def _parse_simple_yaml(text: str) -> dict[str, Any]:
    """最简单的 YAML 解析器：支持嵌套一层 section。

    例如:
      server:
        host: "0.0.0.0"
        port: 8000
    解析为 {"server": {"host": "0.0.0.0", "port": 8000}}
    """
    result: dict[str, Any] = {}
    current_section: dict[str, Any] | None = None

    for line in text.splitlines():
        stripped = line.split("#")[0].rstrip()  # 去掉注释
        if not stripped:
            continue

        indent = len(line) - len(line.lstrip())

        if indent == 0 and stripped.endswith(":"):
            # 顶层 section
            section_name = stripped[:-1].strip()
            result[section_name] = {}
            current_section = result[section_name]
        elif indent > 0 and current_section is not None and ":" in stripped:
            key, _, val = stripped.partition(":")
            val = val.strip().strip('"').strip("'")
            # 尝试类型转换
            if val.lower() in ("true", "false"):
                current_section[key.strip()] = val.lower() == "true"
            else:
                try:
                    current_section[key.strip()] = int(val)
                except ValueError:
                    current_section[key.strip()] = val

    return result


def load_config(yaml_path: str = "config.yaml") -> Config:
    """加载配置：YAML → 环境变量覆盖 → Config 对象。"""
    data = _load_yaml(yaml_path)

    # 从 YAML 嵌套结构中提取值
    srv = data.get("server", {})
    mdl = data.get("model", {})
    opt = data.get("optimization", {})
    tok = data.get("tokenizer", {})
    sec = data.get("security", {})
    out = data.get("output", {})

    def _bool_env(name: str, default: bool) -> bool:
        val = os.getenv(name)
        if val is None:
            return default
        return val.lower() in ("true", "1", "yes", "on")

    cfg = Config(
        # 服务器: 环境变量 > YAML > 默认值
        host=os.getenv("ANIMA_HOST", srv.get("host", "0.0.0.0")),
        port=int(os.getenv("ANIMA_PORT", srv.get("port", 8000))),

        # 模型
        model_dir=os.getenv("ANIMA_MODEL_DIR", mdl.get("model_dir", "")),
        model_version=os.getenv("ANIMA_MODEL_VERSION", mdl.get("model_version", "preview3")),
        device=os.getenv("ANIMA_DEVICE", mdl.get("device", "cuda")),
        low_vram=os.getenv("ANIMA_LOW_VRAM", str(mdl.get("low_vram", False))).lower() in ("true", "1"),

        # 性能优化
        sage_attention=_bool_env("ANIMA_SAGE_ATTENTION", opt.get("sage_attention", True)),
        compile_models=_bool_env("ANIMA_COMPILE_MODELS", opt.get("compile_models", True)),
        clear_cuda_cache=_bool_env("ANIMA_CLEAR_CUDA_CACHE", opt.get("clear_cuda_cache", False)),

        # Tokenizer
        qwen_tokenizer_path=os.getenv("ANIMA_QWEN_TOKENIZER", tok.get("qwen_path", "")),
        t5xxl_tokenizer_path=os.getenv("ANIMA_T5XXL_TOKENIZER", tok.get("t5xxl_path", "")),

        # 安全
        security_enabled=_bool_env("ANIMA_SECURITY_ENABLED", sec.get("enabled", False)),
        auth_token=os.getenv("ANIMA_AUTH_TOKEN", sec.get("auth_token", "")),
        fail2ban_enabled=_bool_env("ANIMA_FAIL2BAN_ENABLED", sec.get("fail2ban_enabled", False)),
        fail2ban_max_attempts=int(os.getenv("ANIMA_FAIL2BAN_MAX_ATTEMPTS", sec.get("fail2ban_max_attempts", 5))),
        fail2ban_window_seconds=int(os.getenv("ANIMA_FAIL2BAN_WINDOW_SECONDS", sec.get("fail2ban_window_seconds", 300))),
        fail2ban_ban_seconds=int(os.getenv("ANIMA_FAIL2BAN_BAN_SECONDS", sec.get("fail2ban_ban_seconds", 3600))),

        # 输出
        output_dir=os.getenv("ANIMA_OUTPUT_DIR", out.get("dir", "./output")),
    )

    return cfg
