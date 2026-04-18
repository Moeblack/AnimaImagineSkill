"""v2 domain models.

所有业务实体定义集中于此，作为各层之间的数据契约。
不依赖任何基础设施（DB / HTTP / GPU），保持纯数据结构。
"""
from __future__ import annotations

import enum
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


# ============================================================
# 图片记录（对应 SQLite images 表的一行）
# ============================================================

@dataclass
class ImageRecord:
    """图库中一张图片的完整元数据。

    同时作为 SQLite 行映射和 API 响应的中间表示。
    """
    id: str                          # 主键，格式 "YYYY-MM-DD/HHMMSS_seed"
    filename: str                    # 如 "143025_42.png"
    date: str                        # "YYYY-MM-DD"
    prompt: str = ""
    negative_prompt: str = ""
    seed: int = 0
    steps: int = 20
    width: int = 1024
    height: int = 1024
    cfg_scale: float = 4.5
    aspect_ratio: str = "3:4"
    generation_time: float = 0.0
    favorited: bool = False
    deleted: bool = False
    created_at: str = ""             # ISO 8601
    tags: list[str] = field(default_factory=list)
    # 供 JSON 兼容的额外字段（不入 DB 列，存 JSON 原件）
    extra: dict[str, Any] = field(default_factory=dict)


# ============================================================
# 生图任务
# ============================================================

class JobStatus(str, enum.Enum):
    """任务生命周期状态。"""
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class Job:
    """一次生图任务的完整状态。

    由 JobQueue 创建和管理，router/service 层只读。
    """
    job_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: JobStatus = JobStatus.QUEUED
    # 生图参数快照
    prompt: str = ""
    negative_prompt: str = ""
    width: int = 1024
    height: int = 1024
    steps: int = 20
    seed: int = -1
    cfg_scale: float = 4.5
    aspect_ratio: str = "3:4"
    # 运行时状态
    queue_position: int = 0          # 排队位置，0 = 正在执行
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    generation_time: float | None = None
    error: str | None = None
    # 结果
    image_id: str | None = None      # 成功后写入的 ImageRecord.id
    image_meta: dict[str, Any] | None = None  # 完整元数据，供前端刷新
    # 【v2.3】高级模式各字段原始值，保存到 DB 和 JSON 供回填
    adv_fields: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """转为 API 响应字典。"""
        return {
            "job_id": self.job_id,
            "status": self.status.value,
            "queue_position": self.queue_position,
            "prompt": self.prompt,
            "width": self.width,
            "height": self.height,
            "steps": self.steps,
            "seed": self.seed,
            "cfg_scale": self.cfg_scale,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "generation_time": self.generation_time,
            "error": self.error,
            "image_id": self.image_id,
            "image_meta": self.image_meta,
        }
