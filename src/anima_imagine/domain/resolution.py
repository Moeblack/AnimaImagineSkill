"""v2 分辨率映射 — 全项目唯一真相源。

后端和前端都从这里获取预设，消除 calcResolution / resolve_size 分叉。
前端通过 /api/config/ui 拉取 presets 表，不再自行计算。

所有预设均 ≈1 MP 且宽高为 16 的倍数（Cosmos VAE 要求）。
来源：AnimaTool 14 种预设 + 社区常用值。
"""
from __future__ import annotations

import math

# 预设比例 → (width, height) at 1.0 MP
ASPECT_PRESETS: dict[str, tuple[int, int]] = {
    "1:1":   (1024, 1024),
    "3:4":   (896,  1152),
    "4:3":   (1152, 896),
    "2:3":   (832,  1248),
    "3:2":   (1248, 832),
    "9:16":  (768,  1344),
    "16:9":  (1344, 768),
    "9:21":  (640,  1472),
    "21:9":  (1472, 640),
    "4:5":   (912,  1136),
    "5:4":   (1136, 912),
    "3:5":   (720,  1200),
    "5:3":   (1200, 720),
    "16:10": (1280, 800),
    "10:16": (800,  1280),
}


def resolve_size(
    aspect_ratio: str | None = None,
    width: int = 0,
    height: int = 0,
    megapixels: float = 1.0,
) -> tuple[int, int]:
    """确定实际像素分辨率。

    优先级：
    1. width & height 都 >0 → 直接使用（对齐 16）
    2. aspect_ratio 在预设中 → 按 megapixels 缩放预设基准
    3. aspect_ratio 是 "W:H" 格式但不在预设中 → 按比例+MP 计算
    4. 兜底 1024×1024
    """
    if width > 0 and height > 0:
        return _align16(width), _align16(height)

    mp = max(0.25, min(4.0, megapixels))

    # 预设查表：基准 MP ≈ 1.0，按 sqrt(mp) 等比缩放
    if aspect_ratio and aspect_ratio in ASPECT_PRESETS:
        bw, bh = ASPECT_PRESETS[aspect_ratio]
        if abs(mp - 1.0) < 0.01:
            return bw, bh
        scale = math.sqrt(mp)
        return _align16(round(bw * scale)), _align16(round(bh * scale))

    # 自由比例解析
    if aspect_ratio and ":" in aspect_ratio:
        parts = aspect_ratio.split(":")
        try:
            rw, rh = float(parts[0]), float(parts[1])
            if rw > 0 and rh > 0:
                total = mp * 1_000_000
                w = math.sqrt(total * rw / rh)
                h = w * rh / rw
                return _align16(round(w)), _align16(round(h))
        except (ValueError, IndexError):
            pass

    return 1024, 1024


def _align16(v: int) -> int:
    """对齐到 16 的倍数（向最近取整）。"""
    return max(16, ((v + 8) // 16) * 16)


def get_ui_presets() -> list[dict]:
    """返回前端需要的预设列表，含 ratio / width / height。

    供 /api/config/ui 使用，前端不再自行计算。
    """
    return [
        {"ratio": ratio, "width": w, "height": h}
        for ratio, (w, h) in ASPECT_PRESETS.items()
    ]
