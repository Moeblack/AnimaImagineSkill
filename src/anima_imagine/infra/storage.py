"""v2 文件存储层。

相对 v1 的改进：
- 原子写入：先写 .tmp 再 rename，避免中断导致产物不同步
- 不再负责 list_images / 收藏状态（转移到 SQLite）
- 保留纯文件 IO 职责：保存 PNG、生成缩略图、写 JSON、移动到 .trash
- 提供 .trash 清理方法
"""
from __future__ import annotations

import json
import os
import shutil
import time
from datetime import datetime
from pathlib import Path

from PIL import Image

# 【v3.0】缩略图宽度从 320 提升到 768，使用 WebP 格式 quality=90
THUMB_WIDTH = 768


class FileStorage:
    """文件系统存储层。负责 PNG/JPG/JSON 的写入和删除。"""

    def __init__(self, output_dir: str = "./output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def save(
        self,
        image: Image.Image,
        metadata: dict,
    ) -> dict:
        """原子地保存图片 + 缩略图 + 元数据。

        写入顺序：PNG → 缩略图 → JSON。
        每个文件先写 .tmp 后缀再 rename，保证崩溃时不会留下半成品。

        返回 {image_path, relative_path, thumb_relative, meta}。
        """
        now = datetime.now()
        date_str = now.strftime("%Y-%m-%d")
        date_dir = self.output_dir / date_str
        date_dir.mkdir(exist_ok=True)
        thumb_dir = date_dir / "thumbs"
        thumb_dir.mkdir(exist_ok=True)

        seed = metadata.get("seed", 0)
        timestamp = now.strftime("%H%M%S")
        filename = f"{timestamp}_{seed}"

        # --- 原图 PNG（原子写入）---
        image_path = date_dir / f"{filename}.png"
        _atomic_save_image(image, image_path, "PNG")

        # --- 【v3.0】缩略图改为 768px WebP q90，更清晰且文件更小 ---
        thumb = image.copy()
        ratio = THUMB_WIDTH / image.width
        thumb_h = int(image.height * ratio)
        thumb = thumb.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)
        thumb_path = thumb_dir / f"{filename}.webp"
        _atomic_save_image(thumb, thumb_path, "WEBP", quality=90)

        # --- 元数据 JSON（原子写入）---
        tags = [t.strip() for t in metadata.get("prompt", "").split(",") if t.strip()]
        meta = {
            **metadata,
            "filename": f"{filename}.png",
            "date": date_str,
            "created_at": now.isoformat(),
            "tags": tags,
        }
        meta_path = date_dir / f"{filename}.json"
        _atomic_write_json(meta_path, meta)

        return {
            "image_path": str(image_path),
            "relative_path": f"{date_str}/{filename}.png",
            # 【v3.0】缩略图后缀改为 .webp
            "thumb_relative": f"{date_str}/thumbs/{filename}.webp",
            "meta": meta,
        }

    def move_to_trash(self, rel_path: str) -> bool:
        """将图片及关联文件移入 .trash/。返回是否成功。"""
        img_full = self.output_dir / rel_path
        if not _is_safe_path(img_full, self.output_dir):
            return False
        if not img_full.exists():
            return False

        # 构建 .trash 目录，保留日期子目录
        parts = rel_path.split("/")
        if len(parts) >= 2:
            trash_dir = self.output_dir / ".trash" / parts[0]
        else:
            trash_dir = self.output_dir / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)

        # 移动 PNG
        img_full.rename(trash_dir / img_full.name)

        # 移动 JSON
        json_path = img_full.with_suffix(".json")
        if json_path.exists():
            json_path.rename(trash_dir / json_path.name)

        # 【v3.0】移动缩略图：优先移动 .webp，fallback 移动旧 .jpg
        thumb_dir = img_full.parent / "thumbs"
        thumb_webp = thumb_dir / img_full.name.replace(".png", ".webp")
        thumb_jpg = thumb_dir / img_full.name.replace(".png", ".jpg")
        thumb_path = thumb_webp if thumb_webp.exists() else (thumb_jpg if thumb_jpg.exists() else None)
        if thumb_path and thumb_path.exists():
            trash_thumbs = trash_dir / "thumbs"
            trash_thumbs.mkdir(parents=True, exist_ok=True)
            thumb_path.rename(trash_thumbs / thumb_path.name)

        return True

    def cleanup_trash(self, max_age_days: int) -> int:
        """v2: 清理超过 max_age_days 天的 .trash 内容。返回删除文件数。"""
        if max_age_days <= 0:
            return 0
        trash = self.output_dir / ".trash"
        if not trash.exists():
            return 0
        cutoff = time.time() - max_age_days * 86400
        count = 0
        for p in trash.rglob("*"):
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink()
                count += 1
        # 清理空目录
        for d in sorted(trash.rglob("*"), reverse=True):
            if d.is_dir() and not any(d.iterdir()):
                d.rmdir()
        return count

    def get_meta_by_path(self, relative_path: str) -> dict | None:
        """根据相对路径读取元数据 JSON。供 reroll 工具用。"""
        meta_path = self.output_dir / relative_path.replace(".png", ".json")
        if not meta_path.exists():
            return None
        try:
            return json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def resolve_path(self, rel_path: str) -> Path | None:
        """解析相对路径并进行安全检查。"""
        full = self.output_dir / rel_path
        if not _is_safe_path(full, self.output_dir):
            return None
        if not full.exists() or not full.is_file():
            return None
        return full

    def list_dates(self) -> list[str]:
        """执行文件系统扫描获取日期列表。仅用于迁移场景。"""
        dates = []
        for d in sorted(self.output_dir.iterdir(), reverse=True):
            if d.is_dir() and len(d.name) == 10 and d.name[4] == "-":
                dates.append(d.name)
        return dates


# ============================================================
# 原子写入工具
# ============================================================

def _atomic_save_image(img: Image.Image, path: Path, fmt: str, **kwargs):
    """v2: 先写临时文件再 rename，避免崩溃时留下半成品。"""
    tmp = path.with_suffix(path.suffix + ".tmp")
    img.save(tmp, fmt, **kwargs)
    # 【v2.3 修复】Windows 上 Path.rename 目标已存在时会抛 FileExistsError，
    # 改用 Path.replace，语义等同于 POSIX rename（覆盖目标）。
    tmp.replace(path)


def _atomic_write_json(path: Path, data: dict):
    """v2: 原子写入 JSON 文件。"""
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    # 【v2.3 修复】同上，Windows 兼容：rename → replace
    tmp.replace(path)


def _is_safe_path(full: Path, base: Path) -> bool:
    """路径穿越防护。"""
    try:
        full.resolve().relative_to(base.resolve())
        return True
    except ValueError:
        return False
