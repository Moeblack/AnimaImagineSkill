"""v2 任务队列。

替代 v1 的 asyncio.Lock，提供：
- 显式 job_id
- 状态跟踪 (queued/running/succeeded/failed/cancelled)
- 排队位置查询
- 超时保护
- 预留取消能力

单消费者模型（单 GPU），asyncio.Queue + 后台 worker task。
"""
from __future__ import annotations

import asyncio
import time
import traceback
from collections import OrderedDict
from typing import Callable, Any

from anima_imagine.domain.models import Job, JobStatus


class JobQueue:
    """v2 生图任务队列。

    - submit() 提交任务，返回 Job
    - get_job() 查询任务状态
    - wait_for_job() 等待任务完成（供同步 API 兼容）
    - worker 后台循环消费队列
    """

    def __init__(
        self,
        executor: Callable[..., Any],
        timeout_seconds: int = 300,
        max_queue_size: int = 50,
    ):
        """
        Args:
            executor: 同步函数，接受 Job 参数，返回结果 dict。
                      在线程池中调用，不阻塞事件循环。
            timeout_seconds: 单个任务超时。
            max_queue_size: 队列上限。
        """
        self._executor = executor
        self._timeout = timeout_seconds
        self._max_size = max_queue_size
        self._queue: asyncio.Queue[str] = asyncio.Queue(maxsize=max_queue_size)
        # job_id -> Job，保留最近 200 个任务的状态
        self._jobs: OrderedDict[str, Job] = OrderedDict()
        # job_id -> asyncio.Event，用于 wait_for_job
        self._events: dict[str, asyncio.Event] = {}
        self._worker_task: asyncio.Task | None = None

    async def start(self):
        """启动后台 worker。在 app lifespan 中调用。"""
        self._worker_task = asyncio.create_task(self._worker_loop())

    async def stop(self):
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass

    def submit(self, job: Job) -> Job:
        """提交任务到队列。如果队列满则抛 QueueFull。"""
        if self._queue.full():
            raise QueueFull(f"队列已满（上限 {self._max_size}）")
        job.status = JobStatus.QUEUED
        job.queue_position = self._queue.qsize() + 1
        self._jobs[job.job_id] = job
        self._events[job.job_id] = asyncio.Event()
        self._queue.put_nowait(job.job_id)
        self._trim_history()
        return job

    def get_job(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    async def wait_for_job(self, job_id: str, timeout: float | None = None) -> Job | None:
        """等待任务完成。超时返回当前状态。"""
        event = self._events.get(job_id)
        if not event:
            return self._jobs.get(job_id)
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout or self._timeout + 10)
        except asyncio.TimeoutError:
            pass
        return self._jobs.get(job_id)

    def queue_status(self) -> dict:
        """v2: 返回队列状态概览。"""
        return {
            "queue_size": self._queue.qsize(),
            "max_size": self._max_size,
            "total_jobs": len(self._jobs),
        }

    # ------------------------------------------------------------------
    # 后台 worker
    # ------------------------------------------------------------------

    async def _worker_loop(self):
        """v2: 单消费者循环，一次处理一个任务。"""
        while True:
            job_id = await self._queue.get()
            job = self._jobs.get(job_id)
            if not job or job.status == JobStatus.CANCELLED:
                self._signal_done(job_id)
                continue

            # 更新所有排队任务的位置
            self._update_positions()

            job.status = JobStatus.RUNNING
            job.queue_position = 0
            job.started_at = time.time()

            try:
                # 在线程池中执行 GPU 推理，不阻塞事件循环
                result = await asyncio.wait_for(
                    asyncio.to_thread(self._executor, job),
                    timeout=self._timeout,
                )
                job.status = JobStatus.SUCCEEDED
                job.finished_at = time.time()
                if isinstance(result, dict):
                    job.image_id = result.get("image_id")
                    job.image_meta = result.get("meta")
                    job.generation_time = result.get("generation_time")
            except asyncio.TimeoutError:
                job.status = JobStatus.FAILED
                job.error = f"任务超时（{self._timeout}s）"
                job.finished_at = time.time()
            except Exception as e:
                job.status = JobStatus.FAILED
                job.error = str(e)
                job.finished_at = time.time()
                traceback.print_exc()

            self._signal_done(job_id)

    def _signal_done(self, job_id: str):
        event = self._events.pop(job_id, None)
        if event:
            event.set()

    def _update_positions(self):
        pos = 1
        for jid in list(self._queue._queue):  # type: ignore[attr-defined]
            j = self._jobs.get(jid)
            if j and j.status == JobStatus.QUEUED:
                j.queue_position = pos
                pos += 1

    def _trim_history(self):
        """v2: 保留最近 200 个任务状态，清理早期历史。"""
        while len(self._jobs) > 200:
            oldest_id, _ = self._jobs.popitem(last=False)
            self._events.pop(oldest_id, None)


class QueueFull(Exception):
    """v2: 队列已满时抛出。"""
    pass
