# -*- coding: utf-8 -*-
"""v2 任务队列测试。

覆盖：
- 提交任务 + 状态流转
- 排队位置
- 超时
- 队列满
"""
import asyncio
import time
import unittest

from anima_imagine.domain.models import Job, JobStatus
from anima_imagine.infra.queue import JobQueue, QueueFull


def _fast_executor(job: Job):
    """0.01s 完成的 mock executor。"""
    time.sleep(0.01)
    return {
        "image_id": f"test/{job.job_id}",
        "meta": {"seed": 42},
        "generation_time": 0.01,
    }


def _slow_executor(job: Job):
    time.sleep(10)  # 超时
    return {}


class TestJobQueue(unittest.TestCase):
    def _run(self, coro):
        return asyncio.run(coro)

    def test_submit_and_complete(self):
        q = JobQueue(executor=_fast_executor, timeout_seconds=5)

        async def _test():
            await q.start()
            job = Job(prompt="test")
            submitted = q.submit(job)
            self.assertEqual(submitted.status, JobStatus.QUEUED)

            finished = await q.wait_for_job(submitted.job_id, timeout=5)
            self.assertEqual(finished.status, JobStatus.SUCCEEDED)
            self.assertEqual(finished.image_meta["seed"], 42)
            await q.stop()

        self._run(_test())

    def test_queue_position(self):
        q = JobQueue(executor=_fast_executor, timeout_seconds=5, max_queue_size=10)

        async def _test():
            # 不启动 worker，只提交
            j1 = q.submit(Job(prompt="1"))
            j2 = q.submit(Job(prompt="2"))
            self.assertEqual(j1.queue_position, 1)
            self.assertEqual(j2.queue_position, 2)

        self._run(_test())

    def test_queue_full(self):
        q = JobQueue(executor=_fast_executor, max_queue_size=2)
        q.submit(Job(prompt="1"))
        q.submit(Job(prompt="2"))
        with self.assertRaises(QueueFull):
            q.submit(Job(prompt="3"))

    def test_timeout(self):
        q = JobQueue(executor=_slow_executor, timeout_seconds=1)

        async def _test():
            await q.start()
            job = q.submit(Job(prompt="slow"))
            finished = await q.wait_for_job(job.job_id, timeout=3)
            self.assertEqual(finished.status, JobStatus.FAILED)
            self.assertIn("超时", finished.error)
            await q.stop()

        self._run(_test())


if __name__ == "__main__":
    unittest.main()
