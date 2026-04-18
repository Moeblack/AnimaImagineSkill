"""v2 生图服务。

封装生图业务逻辑：prompt 拼接 → 分辨率解析 → 提交任务 → 保存结果。
router 层只做请求解析和响应返回，业务逻辑全在这里。
"""
from __future__ import annotations

import base64
import io
from typing import Any

from anima_imagine.domain.models import Job, ImageRecord
from anima_imagine.domain.resolution import resolve_size
from anima_imagine.infra.db import ImageDB
from anima_imagine.infra.pipeline import AnimaPipeline
from anima_imagine.infra.queue import JobQueue, QueueFull
from anima_imagine.infra.storage import FileStorage
from anima_imagine.prompt_builder import build_prompt
from anima_imagine.schemas.schemas import GenerateRequest

# 默认负面提示词
DEFAULT_NEG = (
    "worst quality, low quality, score_1, score_2, score_3, "
    "blurry, jpeg artifacts, sepia, bad hands, bad anatomy, "
    "extra fingers, missing fingers, anatomical nonsense"
)


class GenerationService:
    """v2 生图服务。负责调度生图任务，不直接控制 GPU。"""

    def __init__(
        self,
        pipeline: AnimaPipeline,
        storage: FileStorage,
        db: ImageDB,
        queue: JobQueue,
    ):
        self.pipeline = pipeline
        self.storage = storage
        self.db = db
        self.queue = queue

    def submit_job(self, req: GenerateRequest) -> Job:
        """v2: 提交生图任务到队列。返回 Job 对象含 job_id。"""
        # 拼接 prompt
        if req.mode == "advanced":
            prompt = build_prompt(
                quality_meta_year_safe=req.quality_meta_year_safe or "masterpiece, best quality, newest, year 2025, safe",
                count=req.count or "1girl",
                character=req.character,
                series=req.series,
                artist=req.artist,
                appearance=req.appearance,
                outfit=req.outfit,
                pose_expression=req.pose_expression,
                composition=req.composition,
                environment=req.environment,
                style=req.style,
                nl_caption=req.nl_caption,
                # 后向兼容旧字段
                tags=req.tags,
                nltags=req.nltags,
            )
        else:
            prompt = req.prompt

        # 解析分辨率
        w, h = resolve_size(
            aspect_ratio=req.aspect_ratio if not (req.width > 0 and req.height > 0) else None,
            width=req.width,
            height=req.height,
        )

        neg = req.negative_prompt or DEFAULT_NEG

        job = Job(
            prompt=prompt,
            negative_prompt=neg,
            width=w,
            height=h,
            steps=req.steps,
            seed=req.seed,
            cfg_scale=req.cfg_scale,
            aspect_ratio=req.aspect_ratio,
        )
        # 【v2.3】保存高级模式各字段原始值，用于回填和数据库存储
        if req.mode == "advanced":
            job.adv_fields = {
                "quality_meta_year_safe": req.quality_meta_year_safe,
                "count": req.count,
                "character": req.character,
                "series": req.series,
                "artist": req.artist,
                "appearance": req.appearance,
                "outfit": req.outfit,
                "pose_expression": req.pose_expression,
                "composition": req.composition,
                "environment": req.environment,
                "style": req.style,
                "nl_caption": req.nl_caption,
            }

        return self.queue.submit(job)

    def execute_job(self, job: Job) -> dict[str, Any]:
        """v2: 由 JobQueue worker 调用的同步执行函数。

        在线程池中运行，不阻塞事件循环。
        执行：GPU 推理 → 保存文件 → 写 DB 索引 → 返回结果。
        """
        image, actual_seed, gen_time = self.pipeline.generate(
            prompt=job.prompt,
            negative_prompt=job.negative_prompt,
            width=job.width,
            height=job.height,
            steps=job.steps,
            seed=job.seed,
            cfg_scale=job.cfg_scale,
        )

        # 保存文件
        saved = self.storage.save(image, {
            "prompt": job.prompt,
            "negative_prompt": job.negative_prompt,
            "seed": actual_seed,
            "steps": job.steps,
            "width": job.width,
            "height": job.height,
            "cfg_scale": job.cfg_scale,
            "aspect_ratio": job.aspect_ratio,
            "generation_time": round(gen_time, 2),
            # 【v2.3】保存高级模式各字段原始值到 JSON 文件
            "adv_fields": job.adv_fields if job.adv_fields else {},
        })

        # 写 DB 索引
        meta = saved["meta"]
        rel = saved["relative_path"]
        image_id = rel.replace(".png", "")
        rec = ImageRecord(
            id=image_id,
            filename=meta["filename"],
            date=meta["date"],
            prompt=meta.get("prompt", ""),
            negative_prompt=meta.get("negative_prompt", ""),
            seed=actual_seed,
            steps=meta.get("steps", 20),
            width=meta.get("width", 1024),
            height=meta.get("height", 1024),
            cfg_scale=meta.get("cfg_scale", 4.5),
            aspect_ratio=meta.get("aspect_ratio", ""),
            generation_time=round(gen_time, 2),
            created_at=meta.get("created_at", ""),
            tags=meta.get("tags", []),
            # 【v2.3】adv_fields 通过 extra dict 传递给 DB
            extra={"adv_fields": job.adv_fields} if job.adv_fields else {},
        )
        self.db.upsert(rec)

        return {
            "image_id": image_id,
            "meta": meta,
            "generation_time": round(gen_time, 2),
        }

    def build_mcp_result(self, job: Job, host: str, port: int) -> list:
        """v2: 为 MCP 工具构建返回内容（图片 + 文本）。"""
        from mcp.types import TextContent, ImageContent

        meta = job.image_meta or {}
        rel_path = f"{meta.get('date', '')}/{meta.get('filename', '')}"

        # 从磁盘读取图片转 base64
        full_path = self.storage.resolve_path(rel_path)
        if full_path:
            b64 = base64.b64encode(full_path.read_bytes()).decode()
        else:
            b64 = ""

        return [
            ImageContent(type="image", data=b64, mimeType="image/png"),
            TextContent(type="text", text=(
                f"Seed: {meta.get('seed', '?')} | {meta.get('width', '?')}×{meta.get('height', '?')} | "
                f"{meta.get('steps', '?')} steps | {job.generation_time or 0:.1f}s\n"
                f"Saved: {rel_path}\n"
                f"Gallery: http://{host}:{port}/"
            )),
        ]
