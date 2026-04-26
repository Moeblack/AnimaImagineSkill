# -*- coding: utf-8 -*-
"""v2 SQLite 图库索引测试。

覆盖：
- 插入/查询/更新
- 收藏状态
- 软删除
- 日期筛选
- JSON 导入
"""
import json
import tempfile
import unittest
from pathlib import Path

from anima_imagine.domain.models import ImageRecord
from anima_imagine.infra.db import ImageDB


class TestImageDB(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.db = ImageDB(str(self.tmp / "test.db"))

    def tearDown(self):
        self.db.close()

    def _make_record(self, id="2026-04-15/143025_42", **kwargs):
        defaults = dict(
            id=id,
            filename="143025_42.png",
            date="2026-04-15",
            prompt="test prompt",
            seed=42,
            steps=20,
            width=896,
            height=1152,
            cfg_scale=4.5,
            created_at="2026-04-15T14:30:25",
            tags=["test", "prompt"],
        )
        defaults.update(kwargs)
        return ImageRecord(**defaults)

    def test_upsert_and_query(self):
        rec = self._make_record()
        self.db.upsert(rec)
        result = self.db.get_by_id(rec.id)
        self.assertIsNotNone(result)
        self.assertEqual(result["seed"], 42)
        self.assertEqual(result["tags"], ["test", "prompt"])

    def test_list_images_order(self):
        self.db.upsert(self._make_record("2026-04-15/100000_1", created_at="2026-04-15T10:00:00"))
        self.db.upsert(self._make_record("2026-04-15/120000_2", created_at="2026-04-15T12:00:00"))
        images = self.db.list_images()
        self.assertEqual(len(images), 2)
        # 新的在前
        self.assertEqual(images[0]["id"], "2026-04-15/120000_2")

    def test_favorite(self):
        self.db.upsert(self._make_record())
        self.db.set_favorited("2026-04-15/143025_42", True)
        rec = self.db.get_by_id("2026-04-15/143025_42")
        self.assertTrue(rec["favorited"])

    def test_soft_delete(self):
        self.db.upsert(self._make_record())
        self.db.mark_deleted("2026-04-15/143025_42")
        # 列表查询不返回已删除的
        images = self.db.list_images()
        self.assertEqual(len(images), 0)
        # 但 get_by_id 仍可查到
        rec = self.db.get_by_id("2026-04-15/143025_42")
        self.assertTrue(rec["deleted"])

    def test_date_filter(self):
        self.db.upsert(self._make_record("2026-04-15/100000_1", date="2026-04-15"))
        self.db.upsert(self._make_record("2026-04-16/100000_2", date="2026-04-16"))
        images = self.db.list_images(date="2026-04-15")
        self.assertEqual(len(images), 1)

    def test_list_dates(self):
        self.db.upsert(self._make_record("2026-04-15/100000_1", date="2026-04-15"))
        self.db.upsert(self._make_record("2026-04-16/100000_2", date="2026-04-16"))
        dates = self.db.list_dates()
        self.assertEqual(dates, ["2026-04-16", "2026-04-15"])

    def test_tag_filter_combines_with_date_and_pagination(self):
        # 前端性能优化依赖数据库直接完成标签过滤、日期过滤和分页。
        # 这个测试先定义通用查询行为，避免后续在浏览器里为某个页面写特判扫描逻辑。
        self.db.upsert(self._make_record(
            "2026-04-15/100000_1", date="2026-04-15", tags=["cat girl", "blue eyes"], created_at="2026-04-15T10:00:00"
        ))
        self.db.upsert(self._make_record(
            "2026-04-15/110000_2", date="2026-04-15", tags=["dog boy"], created_at="2026-04-15T11:00:00"
        ))
        self.db.upsert(self._make_record(
            "2026-04-16/120000_3", date="2026-04-16", tags=["cat ears"], created_at="2026-04-16T12:00:00"
        ))
        images = self.db.list_images(date="2026-04-15", tag="cat", limit=1, offset=0)
        self.assertEqual([i["id"] for i in images], ["2026-04-15/100000_1"])
        self.assertEqual(self.db.count(date="2026-04-15", tag="cat"), 1)

    def test_import_from_json(self):
        json_dir = self.tmp / "output" / "2026-04-20"
        json_dir.mkdir(parents=True)
        meta = {
            "filename": "100000_99.png",
            "date": "2026-04-20",
            "prompt": "imported",
            "seed": 99,
            "steps": 25,
            "width": 1024,
            "height": 1024,
            "created_at": "2026-04-20T10:00:00",
            "tags": ["imported"],
        }
        json_path = json_dir / "100000_99.json"
        json_path.write_text(json.dumps(meta), encoding="utf-8")

        ok = self.db.import_from_json(json_path)
        self.assertTrue(ok)
        # 重复导入不应新增
        ok2 = self.db.import_from_json(json_path)
        self.assertFalse(ok2)

        rec = self.db.get_by_id("2026-04-20/100000_99")
        self.assertIsNotNone(rec)
        self.assertEqual(rec["prompt"], "imported")


if __name__ == "__main__":
    unittest.main()
