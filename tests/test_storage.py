# -*- coding: utf-8 -*-
"""v2 原子写入测试。"""
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from anima_imagine.infra.storage import FileStorage


class TestAtomicStorage(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.storage = FileStorage(str(self.tmp / "output"))

    def test_save_creates_three_files(self):
        """v2: 保存后应生成 PNG + JSON + JPG 三个文件，无 .tmp 残留。"""
        img = Image.new("RGB", (100, 100), "red")
        result = self.storage.save(img, {
            "prompt": "test",
            "seed": 42,
            "steps": 20,
            "width": 100,
            "height": 100,
        })
        # PNG
        self.assertTrue(Path(result["image_path"]).exists())
        # JSON
        json_path = Path(result["image_path"]).with_suffix(".json")
        self.assertTrue(json_path.exists())
        meta = json.loads(json_path.read_text())
        self.assertEqual(meta["seed"], 42)
        # JPG 缩略图
        thumb = self.storage.output_dir / result["thumb_relative"]
        self.assertTrue(thumb.exists())
        # 无 .tmp 残留
        tmp_files = list(self.storage.output_dir.rglob("*.tmp"))
        self.assertEqual(len(tmp_files), 0)

    def test_move_to_trash(self):
        img = Image.new("RGB", (100, 100), "blue")
        result = self.storage.save(img, {"prompt": "trash test", "seed": 1})
        rel = result["relative_path"]
        ok = self.storage.move_to_trash(rel)
        self.assertTrue(ok)
        self.assertFalse(Path(result["image_path"]).exists())
        # .trash 中应存在
        trash_files = list((self.storage.output_dir / ".trash").rglob("*.png"))
        self.assertEqual(len(trash_files), 1)


if __name__ == "__main__":
    unittest.main()
