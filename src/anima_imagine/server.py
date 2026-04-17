"""
AnimaImagineSkill MCP Server.

单进程启动，同时提供：
1. Streamable HTTP MCP 端点（/mcp/）—— AI 客户端调用 generate_anima_image 工具
2. 图片画廊网页（/）—— 瀑布流浏览 + 标签展示
3. 图片服务 API（/api/images、/api/image）

启动：
  python -m anima_imagine          # 或
  anima-imagine                    # 如果 pip install 了本包
配置：config.yaml（见 config.example.yaml），环境变量可覆盖。
"""

from __future__ import annotations

import base64
import io
import os
import hmac
import json
import time
from pathlib import Path

from fastmcp import FastMCP
from mcp.types import TextContent, ImageContent
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, Response, RedirectResponse

from starlette.middleware.base import BaseHTTPMiddleware

from starlette.middleware import Middleware

from anima_imagine.pipeline import AnimaPipeline
from anima_imagine.storage import ImageStorage
from anima_imagine.resolution import resolve_size
from anima_imagine.config import load_config, Config
from anima_imagine.codex import CodexIndex, resolve_codex_dir

# ============================================================
# 配置：config.yaml > 环境变量 > 默认值
# ============================================================
cfg: Config = load_config()

# ============================================================
# 全局实例
# ============================================================
mcp = FastMCP("AnimaImagine")
storage = ImageStorage(cfg.output_dir)
pipeline = AnimaPipeline(cfg=cfg)

# gallery.html 所在目录（和本文件同级）
_HERE = Path(__file__).resolve().parent

# 法典索引：给 AI 一次调用就能查到「条目名 + tag 块」。
# 路径解析按优先级尝试多个候选，找到第一个「装着法典-常规.md」的目录就用：
#   1. 环境变量 ANIMA_CODEX_DIR（显式配置）
#   2. 当前工作目录下的 AnimaImagineSkill/references（从仓库根启动时）
#   3. 当前工作目录下的 references（从 AnimaImagineSkill 子目录启动时）
#   4. _HERE.parents[1] / AnimaImagineSkill / references（pip 装到 site-packages 时）
#   5. _HERE.parents[2] / AnimaImagineSkill / references（仓库名嵌套场景，兼容旧布局）
# 这么做是因为旧版写死 parents[2] 在客户端实际启动环境下常算不对，却只会静默加载 0 条。
_CWD = Path.cwd()
_CODEX_DIR = resolve_codex_dir([
    os.getenv("ANIMA_CODEX_DIR"),
    _CWD / "AnimaImagineSkill" / "references",
    _CWD / "references",
    _HERE.parents[1] / "AnimaImagineSkill" / "references",
    _HERE.parents[2] / "AnimaImagineSkill" / "references" if len(_HERE.parents) >= 3 else None,
])
codex = CodexIndex(_CODEX_DIR if _CODEX_DIR else _CWD)



# ============================================================
# Cookie 签名工具函数（#2: HMAC-SHA256 无状态 session）
# ============================================================
# 用 HMAC-SHA256 对 auth_token 签名，生成 cookie 值。
# 校验时重新计算并比对，不存服务端 session，重启不丢失。

_COOKIE_NAME = "_anima_session"
_HMAC_MESSAGE = b"anima_session"


def _make_session_cookie(auth_token: str) -> str:
    """用 auth_token 生成 cookie 值：HMAC-SHA256(auth_token, 'anima_session').hexdigest()"""
    return hmac.new(auth_token.encode(), _HMAC_MESSAGE, "sha256").hexdigest()


def _verify_session_cookie(cookie_value: str, auth_token: str) -> bool:
    """常量时间比对 cookie 值，防止 timing attack。"""
    expected = _make_session_cookie(auth_token)
    return hmac.compare_digest(cookie_value, expected)


# ============================================================
# Fail2Ban 独立类（中间件 + 登录路由共享同一实例）
# ============================================================
# 之前 fail2ban 状态内嵌在 SecurityMiddleware 里，/api/login 白名单绕过了中间件，
# 导致登录暴力破解不受限。抽成独立类后两边都能调用。

class Fail2Ban:
    """内存级 IP 封禁。线程安全靠 asyncio 单线程模型保证。"""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self._banned_ips: dict[str, float] = {}
        self._failed_attempts: dict[str, list[float]] = {}

    def is_banned(self, client_ip: str) -> bool:
        """检查 IP 是否被封禁，顺便清理过期封禁。"""
        if not self.cfg.fail2ban_enabled:
            return False
        now = time.time()
        ban_until = self._banned_ips.get(client_ip)
        if ban_until is None:
            return False
        if now < ban_until:
            return True
        # 封禁已过期，清理
        del self._banned_ips[client_ip]
        return False

    def record_fail(self, client_ip: str):
        """记录一次认证失败，达到阈值则封禁 IP。"""
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


# 全局 fail2ban 实例（security_enabled=false 时所有方法都是 no-op）
fail2ban = Fail2Ban(cfg)


# ============================================================
# 路径白名单（不需要任何认证即可访问）
# ============================================================
_PUBLIC_PATHS = frozenset({"/login", "/api/login"})


class SecurityMiddleware(BaseHTTPMiddleware):
    """路径分流鉴权 + 内存级 fail2ban。默认关闭，供远程部署时手动开启。

    认证策略按路径分流：
    - /login, /api/login  → 放行（白名单）
    - /mcp/*              → Bearer Token（AI 客户端）
    - 其他（/, /api/*, /health）→ Cookie _anima_session（浏览器）

    fail2ban 只对 Bearer 失败和 /api/login 密码错误计数，
    cookie 无效不计数（可能只是过期），直接 302 到登录页。
    """

    def __init__(self, app, cfg: Config, fail2ban_inst: Fail2Ban):
        super().__init__(app)
        self.cfg = cfg
        self._f2b = fail2ban_inst

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # ---- 白名单路径：直接放行 ----
        if path in _PUBLIC_PATHS:
            return await call_next(request)

        # ---- 获取真实 IP ----
        forwarded = request.headers.get("x-forwarded-for")
        client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

        # ---- fail2ban 封禁检查 ----
        if self._f2b.is_banned(client_ip):
            return JSONResponse({"error": "IP banned"}, status_code=403)

        # ---- MCP 端点：Bearer Token ----
        if path.startswith("/mcp"):
            expected = f"Bearer {self.cfg.auth_token}"
            auth_header = request.headers.get("authorization", "")
            if auth_header != expected:
                self._f2b.record_fail(client_ip)
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            return await call_next(request)

        # ---- 其他路径（画廊、API、health）：Cookie 认证 ----
        cookie_val = request.cookies.get(_COOKIE_NAME, "")
        if cookie_val and _verify_session_cookie(cookie_val, self.cfg.auth_token):
            return await call_next(request)

        # Cookie 无效：浏览器 302 到登录页，API 返回 401
        accept = request.headers.get("accept", "")
        if "text/html" in accept:
            return RedirectResponse(url="/login", status_code=302)
        return JSONResponse({"error": "Unauthorized", "login": "/login"}, status_code=401)

# ============================================================
# 内部：公共生图逻辑（供多个工具复用）
# ============================================================

from anima_imagine.prompt_builder import build_prompt

# 默认负面提示词（和 Skill 里推荐的一致）
_DEFAULT_NEG = (
    "worst quality, low quality, score_1, score_2, score_3, "
    "blurry, jpeg artifacts, sepia, bad hands, bad anatomy, "
    "extra fingers, missing fingers, anatomical nonsense"
)


async def _do_generate(
    prompt: str, negative_prompt: str, aspect_ratio: str,
    width: int, height: int, steps: int, seed: int, cfg_scale: float,
) -> list:
    """公共生图逻辑：推理 → 保存 → 返回 MCP 内容。供多个工具复用。"""
    w, h = resolve_size(aspect_ratio, width, height)

    image, actual_seed, gen_time = await pipeline.generate(
        prompt=prompt, negative_prompt=negative_prompt,
        width=w, height=h, steps=steps, seed=seed, cfg_scale=cfg_scale,
    )

    saved = storage.save(image, {
        "prompt": prompt, "negative_prompt": negative_prompt,
        "seed": actual_seed, "steps": steps,
        "width": w, "height": h,
        "cfg_scale": cfg_scale, "aspect_ratio": aspect_ratio,
        "generation_time": round(gen_time, 2),
    })

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()

    return [
        ImageContent(type="image", data=b64, mimeType="image/png"),
        TextContent(type="text", text=(
            f"Seed: {actual_seed} | {w}×{h} | {steps} steps | {gen_time:.1f}s\n"
            f"Saved: {saved['relative_path']}\n"
            f"Gallery: http://{cfg.host}:{cfg.port}/"
        )),
    ]


# ============================================================
# MCP 工具 1：结构化生图（推荐，服务端自动拼接 prompt）
# ============================================================
@mcp.tool()
async def generate_anima_image(
    quality_meta_year_safe: str = "masterpiece, best quality, newest, year 2025, safe",
    count: str = "1girl",
    character: str = "",
    series: str = "",
    appearance: str = "",
    artist: str = "",
    style: str = "",
    tags: str = "",
    nltags: str = "",
    environment: str = "",
    neg: str = _DEFAULT_NEG,
    seed: int = -1,
    steps: int = 20,
    aspect_ratio: str = "3:4",
    width: int = 0,
    height: int = 0,
    cfg_scale: float = 4.5,
) -> list:
    """Generate an Anima anime/illustration image with structured fields.

    服务端会按 Anima 固定标签顺序自动拼接 prompt，无需手动拼接。
    字段严格分离：character 只放角色名，series 只放作品名，tags 不含角色名/作品名。

    示例:
    # 自定义分辨率：width=1024, height=1536 (约 1.5MP)
    # 当 width 和 height 同时大于 0 时，aspect_ratio 会被忽略
    generate_anima_image(
      count="1girl", character="hatsune miku", series="vocaloid",
      artist="@fkey", appearance="long twintails, aqua hair, aqua eyes",
      tags="upper body, smile, singing, microphone",
      environment="stage, spotlight, neon, night"
    )
    """
    # 服务端按固定顺序拼接，保证标签顺序正确
    prompt = build_prompt(
        quality_meta_year_safe=quality_meta_year_safe,
        count=count, character=character, series=series,
        appearance=appearance, artist=artist, style=style,
        tags=tags, nltags=nltags, environment=environment,
    )
    return await _do_generate(
        prompt=prompt, negative_prompt=neg,
        aspect_ratio=aspect_ratio if not (width > 0 and height > 0) else "custom",
        width=width, height=height, steps=steps, seed=seed, cfg_scale=cfg_scale,
    )


# ============================================================
# MCP 工具 2：Reroll（基于历史记录重新生成，可覆盖部分参数）
# ============================================================
@mcp.tool()
async def reroll_anima_image(
    filename: str,
    seed: int = -1,
    artist: str = "",
    tags: str = "",
    steps: int = 0,
    width: int = 0,
    height: int = 0,
    aspect_ratio: str = "",
    cfg_scale: float = 0,
) -> list:
    """Reroll: 基于一张已生成图片的参数重新生成，可覆盖部分参数。

    filename 来自上一次生成的返回值（如 "2026-04-15/140703_636473557.png"）。
    不传的参数保持原值，传了的参数覆盖原值。seed=-1 表示换随机种子。

    典型用法：
    - 换种子重抽：reroll_anima_image(filename="...", seed=-1)
    - 换画师：reroll_anima_image(filename="...", artist="@toridamono")
    - 换比例：reroll_anima_image(filename="...", aspect_ratio="16:9")
    - 换分辨率：reroll_anima_image(filename="...", width=1024, height=1536)
    """
    # 读取原始元数据
    meta = storage.get_meta_by_path(filename)
    if meta is None:
        return [TextContent(type="text", text=f"找不到记录: {filename}")]

    # 用原始参数，覆盖用户指定的字段
    orig_prompt = meta.get("prompt", "")
    orig_neg = meta.get("negative_prompt", _DEFAULT_NEG)

    # 如果用户指定了新 artist 或 tags，需要替换 prompt 中的对应部分
    # 简单策略：如果传了 artist/tags，用它们替换原 prompt 中的对应片段
    final_prompt = orig_prompt
    if artist:
        # 替换 prompt 中的画师标签（@开头的部分）
        import re
        final_prompt = re.sub(r'@[\w\s]+(?:\\[()][\w\s]*\\[()])?', artist, final_prompt, count=1)
        if artist not in final_prompt:
            # 原 prompt 中没有画师，追加到前面（角色名后面）
            final_prompt = final_prompt + ", " + artist
    if tags:
        final_prompt = final_prompt + ", " + tags

    return await _do_generate(
        prompt=final_prompt,
        negative_prompt=orig_neg,
        aspect_ratio=(aspect_ratio or meta.get("aspect_ratio", "3:4"))
            if not (width > 0 and height > 0) else "custom",
        width=width, height=height,
        steps=steps if steps > 0 else meta.get("steps", 20),
        seed=seed,
        cfg_scale=cfg_scale if cfg_scale > 0 else meta.get("cfg_scale", 4.5),
    )


# ============================================================
# MCP 工具 3：法典查询（只读，不依赖 GPU）
#
# 解决之前的痛点：AI 要经历「search_in_files 找行号 → read_file 读 tag」
# 两轮 shell，现在一次 lookup_codex 直接拿到条目名 + 正文 tag 块。
# ============================================================
@mcp.tool()
async def lookup_codex(
    query: str,
    section: str = "",
    scope: str = "normal",
    limit: int = 20,
    context_lines: int = 3,
) -> list:
    """在法典中检索条目，一次返回「标题 + tag 块」，无需手动 search + read。

    参数：
        query: 关键词子串，中文/英文均可，大小写不敏感。同时在标题和条目 tag 中搜。
            传空字符串 + 指定 ``section`` 表示「把该章节的条目整块拉出来」。
        section: 按粗章节名过滤，子串匹配，大小写不敏感；可用 ``,`` / ``|`` 分隔多个，
            例如 ``"内衣,睡衣,诱惑"``。对「性感服装」「色情服装」这种没有统一关键词
            的抽象需求，强烈建议先用 ``list_codex_sections`` 看章节名，再走 section 路径。
        scope: "normal"（默认）/ "r18" / "both"。未经用户明示前不要切到 r18。
        limit: 默认 20。要把整章拉下来可调大，但别超过 200。
        context_lines: 每条返回几行原文，默认 3。

    返回：JSON，每条含 source / scope / section / title / line / tag_block。
    """
    hits = codex.lookup(
        query=query, section=section,
        scope=scope, limit=limit, context_lines=context_lines,
    )
    return [TextContent(type="text", text=json.dumps(hits, ensure_ascii=False, indent=2))]


@mcp.tool()
async def list_codex_sections(scope: str = "normal") -> list:
    """返回法典的粗章节列表：章节名 + entry_count + 起止行。

    用于「先逛目录」。想做「各种色情服装/各种姿势」这类模糊需求时，先调这个工具看
    R18 章节（内衣 / 睡衣 / 诱惑 / 幻想改造 / 日常改造 / 露出…），再用
    ``lookup_codex(section=..., query="")`` 或 ``list_codex_entries(section=...)`` 展开。
    """
    secs = codex.list_sections(scope=scope)
    return [TextContent(type="text", text=json.dumps(secs, ensure_ascii=False, indent=2))]


@mcp.tool()
async def list_codex_entries(
    section: str = "",
    scope: str = "normal",
    limit: int = 200,
) -> list:
    """列出指定章节下所有条目的「标题菜单」（不带 tag 正文，token 友好）。

    处理「某大类下有哪些玩法/变体」的问题：先用 list_codex_sections 看大类，
    再用本工具拿到该大类的条目列表，最后用 lookup_codex 按选中的标题拿 tag。

    参数：
        section: 章节名子串，可用 ``,`` / ``|`` 分隔多选。留空表示列出 scope 下所有条目
            （受 limit 截断，慎用）。
        scope: 同 lookup_codex。
        limit: 默认 200，足以覆盖绝大多数章节。

    返回：JSON 列表，每项含 source / scope / section / title / line。
    """
    entries = codex.list_entries(section=section, scope=scope, limit=limit)
    return [TextContent(type="text", text=json.dumps(entries, ensure_ascii=False, indent=2))]



# ============================================================
# 登录路由（#3: 白名单路径，不需要认证）
# ============================================================

@mcp.custom_route("/login", methods=["GET"])
async def login_page(request: Request):
    """返回登录页 HTML。白名单路径，SecurityMiddleware 会放行。"""
    html_path = _HERE / "login.html"
    html = html_path.read_text(encoding="utf-8")
    return HTMLResponse(html)


@mcp.custom_route("/api/login", methods=["POST"])
async def api_login(request: Request):
    """校验 token，成功则 Set-Cookie _anima_session。登录失败计入 fail2ban。

    请求体: {"token": "..."}
    成功: 200 + Set-Cookie
    失败: 401（计入 fail2ban）
    """
    data = await request.json()
    token = data.get("token", "")

    # 登录路由虽在白名单（中间件放行），但仍需检查 fail2ban 封禁状态，
    # 防止被封禁的 IP 继续尝试登录。
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

    if fail2ban.is_banned(client_ip):
        return JSONResponse({"error": "IP banned"}, status_code=403)

    if token == cfg.auth_token and cfg.auth_token:
        # 认证成功：生成签名 cookie 并设置
        cookie_value = _make_session_cookie(cfg.auth_token)
        resp = JSONResponse({"status": "ok"})
        # HttpOnly 防止 JS 读取；SameSite=Lax 防止 CSRF；
        # Secure 由 nginx 层面保证（本地开发不强制）。
        resp.set_cookie(
            key=_COOKIE_NAME, value=cookie_value,
            httponly=True, samesite="lax",
            max_age=86400 * 30,  # 30 天有效
        )
        return resp

    # 认证失败：计入 fail2ban，防止暴力破解密码。
    # 使用全局 fail2ban 实例，与中间件共享封禁状态。
    fail2ban.record_fail(client_ip)
    return JSONResponse({"error": "密码错误"}, status_code=401)


# ============================================================
# 画廊路由：网页 + API
# ============================================================

@mcp.custom_route("/", methods=["GET"])
async def gallery_page(request: Request):
    """返回画廊 HTML 页面。"""
    html_path = _HERE / "gallery.html"
    html = html_path.read_text(encoding="utf-8")
    return HTMLResponse(html)


@mcp.custom_route("/api/images", methods=["GET"])
async def api_images(request: Request):
    """返回图片列表 JSON。

    参数:
      ?date=2026-07-15  指定日期
      ?limit=100        最大返回数
    """
    date = request.query_params.get("date")
    limit = int(request.query_params.get("limit", "200"))
    images = storage.list_images(date=date, limit=limit)
    dates = storage.list_dates()
    return JSONResponse({"dates": dates, "images": images})


@mcp.custom_route("/api/image", methods=["GET"])
async def serve_image(request: Request):
    """提供图片文件服务。

    参数:
      ?path=2026-07-15/143025_42.png     原图
      ?path=2026-07-15/143025_42.png&thumb=1  缩略图
    """
    rel_path = request.query_params.get("path", "")
    is_thumb = request.query_params.get("thumb", "0") in ("1", "true")

    if is_thumb:
        # 缩略图路径：插入 thumbs/ 并换后缀
        parts = rel_path.rsplit("/", 1)
        if len(parts) == 2:
            rel_path = f"{parts[0]}/thumbs/{parts[1].replace('.png', '.jpg')}"

    full_path = Path(cfg.output_dir) / rel_path

    # 安全检查：禁止路径穿越
    try:
        full_path.resolve().relative_to(Path(cfg.output_dir).resolve())
    except ValueError:
        return JSONResponse({"error": "forbidden"}, status_code=403)

    if not full_path.exists() or not full_path.is_file():
        return JSONResponse({"error": "not found"}, status_code=404)

    suffix = full_path.suffix.lower()
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
    media_type = mime.get(suffix.lstrip("."), "application/octet-stream")

    return Response(content=full_path.read_bytes(), media_type=media_type)


@mcp.custom_route("/api/generate", methods=["POST"])
async def api_generate(request: Request):
    """前端生图 API"""
    data = await request.json()
    
    # 判断是否为高级模式
    is_advanced = data.get("mode") == "advanced"
    
    if is_advanced:
        prompt = build_prompt(
            quality_meta_year_safe=data.get("quality_meta_year_safe", "masterpiece, best quality, newest, year 2025, safe"),
            count=data.get("count", "1girl"),
            character=data.get("character", ""),
            series=data.get("series", ""),
            appearance=data.get("appearance", ""),
            artist=data.get("artist", ""),
            style=data.get("style", ""),
            tags=data.get("tags", ""),
            nltags=data.get("nltags", ""),
            environment=data.get("environment", "")
        )
    else:
        # 基础模式或直接导入 json
        prompt = data.get("prompt", "")

    neg = data.get("negative_prompt", _DEFAULT_NEG)
    seed = int(data.get("seed", -1))
    steps = int(data.get("steps", 20))
    aspect_ratio = data.get("aspect_ratio", "3:4")
    width = int(data.get("width", 0))
    height = int(data.get("height", 0))
    cfg_scale = float(data.get("cfg_scale", 4.5))

    w, h = resolve_size(aspect_ratio, width, height)

    image, actual_seed, gen_time = await pipeline.generate(
        prompt=prompt, negative_prompt=neg,
        width=w, height=h, steps=steps, seed=seed, cfg_scale=cfg_scale,
    )

    saved = storage.save(image, {
        "prompt": prompt, "negative_prompt": neg,
        "seed": actual_seed, "steps": steps,
        "width": w, "height": h,
        "cfg_scale": cfg_scale, "aspect_ratio": aspect_ratio,
        "generation_time": round(gen_time, 2),
    })

    return JSONResponse({"status": "ok", "meta": saved["meta"]})

@mcp.custom_route("/health", methods=["GET"])
async def health(request: Request):
    """健康检查。"""
    return JSONResponse({
        "status": "ok",
        "model_loaded": pipeline.pipe is not None,
        "output_dir": str(Path(cfg.output_dir).resolve()),
        "device": cfg.device,
        "codex": codex.stats(),
    })


# ============================================================
# 入口
# ============================================================
def main():
    """CLI 入口点。"""
    print("=" * 60)
    print("AnimaImagineSkill")
    print("=" * 60)

    # 加载模型（阻塞直到完成）
    pipeline.load()

    print(f"  Optimization : sage_attention={pipeline.sage_attention}, "
          f"compile={pipeline.compile_models}, "
          f"clear_cuda_cache={pipeline.clear_cuda_cache}")

    print(f"\n  MCP Endpoint : http://{cfg.host}:{cfg.port}/mcp/")
    print(f"  Gallery      : http://{cfg.host}:{cfg.port}/")
    print(f"  Health       : http://{cfg.host}:{cfg.port}/health")
    print(f"  Output Dir   : {Path(cfg.output_dir).resolve()}")

    # 打印 codex 加载结果。空加载是静默失败的常见根因，
    # 之前的 bug 就是因为路径算错却没日志提示，AI 调用 lookup_codex 拿到 []。
    stats = codex.stats()
    if stats["fine_entries"] == 0:
        print(f"  Codex        : [WARN] 未加载任何法典条目！")
        print(f"                 候选路径尝试失败，当前 _CODEX_DIR={_CODEX_DIR!s}")
        print(f"                 cwd={_CWD!s}")
        print(f"                 可设置环境变量 ANIMA_CODEX_DIR 指向 references 目录")
    else:
        print(f"  Codex        : {stats['fine_entries']} entries, "
              f"{stats['sections']} sections, from {_CODEX_DIR}")

    # 安全配置
    # [BUG FIX] 旧代码通过 getattr(mcp, "_app") 获取内部 app 来添加中间件，
    # 但 FastMCP 没有 _app / app 属性（只有 http_app 方法），导致中间件从未被注册，
    # 安全功能静默失败。正确做法是通过 mcp.http_app(middleware=...) 传入中间件，
    # 再用 uvicorn 启动返回的 ASGI app。
    user_middleware = []
    if cfg.security_enabled:
        if not cfg.auth_token:
            print("  [WARN] security.enabled=true 但 auth_token 为空，远程暴露存在风险")
        # 传入全局 fail2ban 实例，让中间件和登录路由共享封禁状态
        user_middleware.append(Middleware(SecurityMiddleware, cfg=cfg, fail2ban_inst=fail2ban))
        print(f"  Security     : enabled | fail2ban={cfg.fail2ban_enabled}")
    else:
        print("  Security     : disabled (set security.enabled=true to protect public endpoints)")

    print()

    # 启动 Streamable HTTP MCP 服务。
    # 当有自定义中间件时，必须走 http_app() + uvicorn 路径，因为 mcp.run() 不接受 middleware 参数。
    if user_middleware:
        import uvicorn
        app = mcp.http_app(
            transport="streamable-http",
            middleware=user_middleware,
        )
        uvicorn.run(app, host=cfg.host, port=cfg.port)
    else:
        mcp.run(transport="streamable-http", host=cfg.host, port=cfg.port)


if __name__ == "__main__":
    main()
