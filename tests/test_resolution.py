# -*- coding: utf-8 -*-
"""v2 分辨率模块测试。

覆盖：
- 预设查表匹配
- 自定义 width/height 优先级
- 16 倍数对齐
- MP 缩放
- 无效 ratio 兜底
- get_ui_presets 返回格式
"""
import unittest

from anima_imagine.domain.resolution import resolve_size, get_ui_presets, ASPECT_PRESETS


class TestResolveSize(unittest.TestCase):
    def test_preset_1mp(self):
        """预设 3:4 at 1.0 MP 应返回固定值。"""
        w, h = resolve_size(aspect_ratio="3:4", megapixels=1.0)
        self.assertEqual((w, h), (896, 1152))

    def test_preset_16_9(self):
        w, h = resolve_size(aspect_ratio="16:9", megapixels=1.0)
        self.assertEqual((w, h), (1344, 768))

    def test_custom_wh_overrides(self):
        """给定 width+height 时忽略 ratio。"""
        w, h = resolve_size(aspect_ratio="3:4", width=1024, height=1536)
        self.assertEqual(w, 1024)
        self.assertEqual(h, 1536)

    def test_custom_wh_aligns_16(self):
        w, h = resolve_size(width=1025, height=1537)
        self.assertEqual(w % 16, 0)
        self.assertEqual(h % 16, 0)

    def test_mp_scaling(self):
        """2.0 MP 应返回更大分辨率。"""
        w1, h1 = resolve_size(aspect_ratio="1:1", megapixels=1.0)
        w2, h2 = resolve_size(aspect_ratio="1:1", megapixels=2.0)
        self.assertGreater(w2 * h2, w1 * h1 * 1.5)

    def test_unknown_ratio_fallback(self):
        w, h = resolve_size(aspect_ratio="99:1")
        # 应该从自由比例解析的逻辑走，不崩溃
        self.assertEqual(w % 16, 0)
        self.assertEqual(h % 16, 0)

    def test_no_args_fallback(self):
        w, h = resolve_size()
        self.assertEqual((w, h), (1024, 1024))

    def test_all_presets_align_16(self):
        """所有预设都必须 16 对齐。"""
        for ratio, (w, h) in ASPECT_PRESETS.items():
            self.assertEqual(w % 16, 0, f"{ratio}: width {w} not aligned")
            self.assertEqual(h % 16, 0, f"{ratio}: height {h} not aligned")


class TestUIPresets(unittest.TestCase):
    def test_format(self):
        presets = get_ui_presets()
        self.assertIsInstance(presets, list)
        self.assertTrue(len(presets) > 0)
        for p in presets:
            self.assertIn("ratio", p)
            self.assertIn("width", p)
            self.assertIn("height", p)


if __name__ == "__main__":
    unittest.main()
