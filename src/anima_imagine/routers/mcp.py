"""v2 MCP 工具路由。

将 MCP 工具定义从 server.py 迁出，统一注册。
工具逻辑调用 service 层，不直接操作 pipeline/storage。
"""
from __future__ import annotations

import json

from mcp.types import TextContent

from anima_imagine.domain.resolution import resolve_size
from anima_imagine.prompt_builder import build_prompt
from anima_imagine.services.generation import DEFAULT_NEG


def register_mcp_tools(mcp, gen_service, codex, cfg):
    """v2: 注册所有 MCP 工具。"""

    @mcp.tool()
    async def generate_anima_image(
        quality_meta_year_safe: str = "masterpiece, best quality, newest, year 2025, safe",
        count: str = "1girl",
        character: str = "",
        series: str = "",
        appearance: str = "",
        outfit: str = "",
        pose_expression: str = "",
        composition: str = "",
        artist: str = "",
        style: str = "",
        environment: str = "",
        nl_caption: str = "",
        neg: str = DEFAULT_NEG,
        seed: int = -1,
        steps: int = 20,
        aspect_ratio: str = "3:4",
        width: int = 0,
        height: int = 0,
        cfg_scale: float = 4.5,
    ) -> list:
        """Generate an Anima anime/illustration image with structured prompt fields.

        Server auto-joins fields into Anima prompt order:
        [quality] [count] [character] [series] [artist] [appearance] [outfit]
        [pose_expression] [composition] [environment] [style] [nl_caption]
        """
        from anima_imagine.schemas.schemas import GenerateRequest

        req = GenerateRequest(
            mode="advanced",
            prompt="",
            negative_prompt=neg,
            seed=seed,
            steps=steps,
            cfg_scale=cfg_scale,
            aspect_ratio=aspect_ratio if not (width > 0 and height > 0) else "custom",
            width=width,
            height=height,
            quality_meta_year_safe=quality_meta_year_safe,
            count=count,
            character=character,
            series=series,
            appearance=appearance,
            outfit=outfit,
            pose_expression=pose_expression,
            composition=composition,
            artist=artist,
            style=style,
            environment=environment,
            nl_caption=nl_caption,
        )
        job = gen_service.submit_job(req)
        finished = await gen_service.queue.wait_for_job(job.job_id)
        if finished and finished.status.value == "succeeded":
            return gen_service.build_mcp_result(finished, cfg.host, cfg.port)
        error = finished.error if finished else "未知错误"
        return [TextContent(type="text", text=f"生成失败: {error}")]

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
        """Reroll: 基于一张已生成图片的参数重新生成。"""
        meta = gen_service.storage.get_meta_by_path(filename)
        if meta is None:
            return [TextContent(type="text", text=f"找不到记录: {filename}")]

        final_prompt = meta.get("prompt", "")
        if artist:
            import re
            final_prompt = re.sub(r'@[\w\s]+', artist, final_prompt, count=1)
            if artist not in final_prompt:
                final_prompt += ", " + artist
        if tags:
            final_prompt += ", " + tags

        from anima_imagine.schemas.schemas import GenerateRequest
        req = GenerateRequest(
            mode="basic",
            prompt=final_prompt,
            negative_prompt=meta.get("negative_prompt", DEFAULT_NEG),
            seed=seed,
            steps=steps if steps > 0 else meta.get("steps", 20),
            cfg_scale=cfg_scale if cfg_scale > 0 else meta.get("cfg_scale", 4.5),
            aspect_ratio=(aspect_ratio or meta.get("aspect_ratio", "3:4"))
                if not (width > 0 and height > 0) else "custom",
            width=width,
            height=height,
        )
        job = gen_service.submit_job(req)
        finished = await gen_service.queue.wait_for_job(job.job_id)
        if finished and finished.status.value == "succeeded":
            return gen_service.build_mcp_result(finished, cfg.host, cfg.port)
        error = finished.error if finished else "未知错误"
        return [TextContent(type="text", text=f"生成失败: {error}")]

    @mcp.tool()
    async def lookup_codex(
        query: str,
        section: str = "",
        scope: str = "normal",
        limit: int = 20,
        context_lines: int = 3,
    ) -> list:
        """在法典中检索条目。"""
        hits = codex.lookup(query=query, section=section, scope=scope, limit=limit, context_lines=context_lines)
        return [TextContent(type="text", text=json.dumps(hits, ensure_ascii=False, indent=2))]

    @mcp.tool()
    async def list_codex_sections(scope: str = "normal") -> list:
        """返回法典粗章节列表。"""
        secs = codex.list_sections(scope=scope)
        return [TextContent(type="text", text=json.dumps(secs, ensure_ascii=False, indent=2))]

    @mcp.tool()
    async def list_codex_entries(section: str = "", scope: str = "normal", limit: int = 200) -> list:
        """列出指定章节下的条目标题。"""
        entries = codex.list_entries(section=section, scope=scope, limit=limit)
        return [TextContent(type="text", text=json.dumps(entries, ensure_ascii=False, indent=2))]
