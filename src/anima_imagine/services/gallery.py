"""v2 图库服务。

封装图片列表、收藏、删除等业务逻辑。
所有状态变更通过 SQLite 保证一致性。
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from anima_imagine.infra.db import ImageDB
from anima_imagine.infra.storage import FileStorage


class GalleryService:
    """v2 图库服务。"""

    def __init__(self, db: ImageDB, storage: FileStorage):
        self.db = db
        self.storage = storage

    def list_images(
        self,
        date: str | None = None,
        limit: int = 200,
        offset: int = 0,
        favorited_only: bool = False,
    ) -> dict:
        """v2: 从 SQLite 查询图片列表。不再扫描 JSON 文件。"""
        images = self.db.list_images(
            date=date, limit=limit, offset=offset,
            favorited_only=favorited_only,
        )
        dates = self.db.list_dates()
        total = self.db.count(date=date)
        return {
            "dates": dates,
            "images": images,
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def set_favorite(self, image_id: str, favorited: bool) -> bool:
        """v2: 通过 SQLite 设置收藏状态，同时更新 JSON 文件。"""
        # 先更新 DB
        found = self.db.set_favorited(image_id, favorited)
        if not found:
            return False
        # 同步更新 JSON 文件（保持文件和 DB 一致）
        meta = self.storage.get_meta_by_path(f"{image_id}.png")
        if meta:
            meta["favorited"] = favorited
            json_path = Path(self.storage.output_dir) / f"{image_id}.json"
            if json_path.exists():
                from anima_imagine.infra.storage import _atomic_write_json
                _atomic_write_json(json_path, meta)
        return True

    def delete_images(self, image_ids: list[str]) -> list[str]:
        """v2: 软删除 + 移入 .trash。返回成功删除的 ID 列表。"""
        deleted = []
        for image_id in image_ids:
            # image_id 格式: "YYYY-MM-DD/HHMMSS_seed"
            rel_path = f"{image_id}.png"
            # DB 标记删除
            if self.db.mark_deleted(image_id):
                # 文件移入 .trash
                self.storage.move_to_trash(rel_path)
                deleted.append(image_id)
        return deleted

    def get_image_path(self, rel_path: str) -> Path | None:
        """v2: 解析图片路径（含缩略图逻辑）。"""
        return self.storage.resolve_path(rel_path)

    def get_thumb_path(self, rel_path: str) -> Path | None:
        """v2: 解析缩略图路径。"""
        parts = rel_path.rsplit("/", 1)
        if len(parts) == 2:
            thumb_rel = f"{parts[0]}/thumbs/{parts[1].replace('.png', '.jpg')}"
        else:
            return None
        return self.storage.resolve_path(thumb_rel)
