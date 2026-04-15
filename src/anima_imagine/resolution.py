"""
长宽比 → 分辨率映射。

Anima 在 ~1MP (1,048,576 像素) 下效果最稳定，
所有预设都接近 1MP 且宽高均为 16 的倍数（VAE scale factor 要求）。
"""

# 预设比例 → (width, height)，均 ≈1MP 且 %16==0
# 来源：AnimaTool 14 种预设 + 社区常用值
ASPECT_RATIOS: dict[str, tuple[int, int]] = {
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
) -> tuple[int, int]:
    """根据 aspect_ratio 或 width/height 确定实际分辨率。

    优先级：
    1. 如果 width & height 都 >0，直接使用（对齐到 16 的倍数）
    2. 如果给了 aspect_ratio 且在预设中，用预设值
    3. 兜底 1024×1024
    """
    if width > 0 and height > 0:
        # 用户指定了精确分辨率，对齐到 16
        return (width // 16) * 16, (height // 16) * 16

    if aspect_ratio and aspect_ratio in ASPECT_RATIOS:
        return ASPECT_RATIOS[aspect_ratio]

    # 兜底: 方形 1024×1024
    return 1024, 1024
