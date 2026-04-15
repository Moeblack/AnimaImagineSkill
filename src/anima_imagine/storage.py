"""图片存储模块。

按日期分目录归档，每张图保存：
- 原图 PNG
- 缩略图 JPG（320px 宽，供画廊快速加载）
- 元数据 JSON（提示词、参数、tags 列表）

目录结构：
  output/
  ├── 2026-07-15/
  │   ├── 143025_42.png
  │   ├── 143025_42.json
  │   └── thumbs/
  │       └── 143025_42.jpg
  └── 2026-07-16/
      └── ...
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from PIL import Image

# 缩略图宽度（像素）。320px 足够让画廊看清细节，又不会太大
THUMB_WIDTH = 320


class ImageStorage:
    """管理按日期归档的图片存储。"""

    def __init__(self, output_dir: str = "./output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def save(self, image: Image.Image, metadata: dict) -> dict:
        """保存图片 + 缩略图 + 元数据。返回保存信息。"""
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d")
        date_dir = self.output_dir / date_str
        date_dir.mkdir(exist_ok=True)

        # 缩略图目录
        thumb_dir = date_dir / "thumbs"
        thumb_dir.mkdir(exist_ok=True)

        # 文件名: HHMMSS_seed（同秒同 seed 概率极低）
        seed = metadata.get("seed", 0)
        timestamp = now.strftime("%H%M%S")
        filename = f"{timestamp}_{seed}"

        # --- 原图 ---
        image_path = date_dir / f"{filename}.png"
        image.save(image_path, "PNG")

        # --- 缩略图 ---
        # 保持宽高比，缩到 THUMB_WIDTH 宽，用 JPEG 压缩体积
        thumb = image.copy()
        ratio = THUMB_WIDTH / image.width
        thumb_h = int(image.height * ratio)
        thumb = thumb.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)
        thumb_path = thumb_dir / f"{filename}.jpg"
        thumb.save(thumb_path, "JPEG", quality=82)

        # --- 元数据 ---
        # tags: 把 prompt 按逗号拆开，供画廊展示和检索
        tags = [t.strip() for t in metadata.get("prompt", "").split(",") if t.strip()]
        meta = {
            **metadata,
            "filename": f"{filename}.png",
            "date": date_str,
            "created_at": now.isoformat(),
            "tags": tags,
        }
        meta_path = date_dir / f"{filename}.json"
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return {
            "image_path": str(image_path),
            "relative_path": f"{date_str}/{filename}.png",
            "thumb_relative": f"{date_str}/thumbs/{filename}.jpg",
            "meta": meta,
        }

    # ------------------------------------------------------------------
    # 查询接口（供画廊 API 调用）
    # ------------------------------------------------------------------

    def list_dates(self) -> list[str]:
        """返回所有有图片的日期（降序）。"""
        dates = []
        for d in sorted(self.output_dir.iterdir(), reverse=True):
            # 只认 YYYY-MM-DD 格式的目录
            if d.is_dir() and len(d.name) == 10 and d.name[4] == "-":
                dates.append(d.name)
        return dates

    def list_images(self, date: str | None = None, limit: int = 200) -> list[dict]:
        """返回图片元数据列表。

        date=None 返回所有日期（最新在前），最多 limit 条。
        """
        if date:
            dirs = [self.output_dir / date]
        else:
            dirs = sorted(self.output_dir.iterdir(), reverse=True)

        images: list[dict] = []
        for d in dirs:
            if not d.is_dir() or len(d.name) != 10:
                continue
            # 读取该日期下所有 .json 元数据，新的在前
            for meta_file in sorted(d.glob("*.json"), reverse=True):
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    images.append(meta)
                except (json.JSONDecodeError, OSError):
                    pass
                if len(images) >= limit:
                    return images
        return images

    def get_meta_by_path(self, relative_path: str) -> dict | None:
        """根据相对路径读取元数据。

        relative_path 格式: "2026-04-15/140703_636473557.png"
        会自动查找同名 .json 文件。供 reroll 工具读取历史参数。
        """
        # 支持 .png 或 .json 后缀输入
        meta_path = self.output_dir / relative_path.replace(".png", ".json")
        if not meta_path.exists():
            return None
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

