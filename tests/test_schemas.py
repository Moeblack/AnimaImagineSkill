# -*- coding: utf-8 -*-
"""v2 输入校验测试。"""
import unittest

from anima_imagine.schemas.schemas import (
    GenerateRequest, FavoriteRequest, DeleteRequest, ImagesQuery, LoginRequest
)


class TestGenerateRequest(unittest.TestCase):
    def test_valid_basic(self):
        req = GenerateRequest.parse({"prompt": "test", "steps": 20})
        self.assertEqual(req.prompt, "test")
        self.assertEqual(req.steps, 20)

    def test_steps_out_of_range(self):
        with self.assertRaises(ValueError):
            GenerateRequest.parse({"prompt": "test", "steps": 200})

    def test_cfg_out_of_range(self):
        with self.assertRaises(ValueError):
            GenerateRequest.parse({"prompt": "test", "cfg_scale": 50})

    def test_empty_prompt_basic(self):
        with self.assertRaises(ValueError):
            GenerateRequest.parse({"prompt": "", "mode": "basic"})

    def test_advanced_mode_no_prompt_ok(self):
        req = GenerateRequest.parse({
            "mode": "advanced",
            "quality_meta_year_safe": "masterpiece",
            "count": "1girl",
        })
        self.assertEqual(req.mode, "advanced")

    def test_width_too_large(self):
        with self.assertRaises(ValueError):
            GenerateRequest.parse({"prompt": "x", "width": 9999})


class TestDeleteRequest(unittest.TestCase):
    def test_single_path(self):
        req = DeleteRequest.parse({"path": "2026/foo.png"})
        self.assertEqual(req.paths, ["2026/foo.png"])

    def test_empty_paths(self):
        with self.assertRaises(ValueError):
            DeleteRequest.parse({"paths": []})

    def test_too_many_paths(self):
        with self.assertRaises(ValueError):
            DeleteRequest.parse({"paths": [f"p{i}.png" for i in range(201)]})


class TestImagesQuery(unittest.TestCase):
    def test_default(self):
        q = ImagesQuery.parse({})
        self.assertEqual(q.limit, 200)
        self.assertIsNone(q.date)

    def test_bad_limit(self):
        with self.assertRaises(ValueError):
            ImagesQuery.parse({"limit": "0"})

    def test_tag_filter_trimmed(self):
        # 前端性能优化需要把标签过滤下推到 /api/images，避免浏览器一次拉全量图片再扫描。
        # 这里先锁定查询参数会被标准化，后续实现按同一个通用 tag 字段组合分页和日期筛选。
        q = ImagesQuery.parse({"tag": "  miku  ", "limit": "120"})
        self.assertEqual(q.tag, "miku")


if __name__ == "__main__":
    unittest.main()
