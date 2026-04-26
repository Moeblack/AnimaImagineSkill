"""v2 SQLite 图库索引。

文件系统保存原始 PNG/JPG/JSON 产物，SQLite 做索引和状态表。
解决：
- list_images 扫描性能问题
- 日期筛选可以查全量
- 收藏/删除状态并发安全（SQLite 内置锁）
- 软删除统一管理

启动时自动建表 + 从现有 JSON 导入历史数据。
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from anima_imagine.domain.models import ImageRecord

# 数据库 schema 版本，将来迁移用
# 【v3.0】版本升至 3，新增 user_preferences 表
_SCHEMA_VERSION = 3

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,         -- "YYYY-MM-DD/HHMMSS_seed"
    filename TEXT NOT NULL,
    date TEXT NOT NULL,
    prompt TEXT DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    seed INTEGER DEFAULT 0,
    steps INTEGER DEFAULT 20,
    width INTEGER DEFAULT 1024,
    height INTEGER DEFAULT 1024,
    cfg_scale REAL DEFAULT 4.5,
    aspect_ratio TEXT DEFAULT '3:4',
    generation_time REAL DEFAULT 0,
    favorited INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT '',
    tags_json TEXT DEFAULT '[]',
    -- 【v2.3】保存高级模式各字段的原始值，便于回填和重新生成
    adv_fields_json TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_date ON images(date);
CREATE INDEX IF NOT EXISTS idx_favorited ON images(favorited);
CREATE INDEX IF NOT EXISTS idx_deleted ON images(deleted);
CREATE INDEX IF NOT EXISTS idx_created_at ON images(created_at DESC);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- 【v3.0 新增】用户偏好表，存储提示词缓存/预设/自定义标签等，
-- 实现全平台同步（所有设备共享同一份 SQLite 数据库）。
CREATE TABLE IF NOT EXISTS user_preferences (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
);
"""


class ImageDB:
    """图库 SQLite 索引。同步 API，在 async 路由中用 to_thread 调用写操作。

    读操作直接同步调用即可（单用户场景下足够快）。
    """

    def __init__(self, db_path: str):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=NORMAL")
        self._init_schema()

    def _init_schema(self):
        self._conn.executescript(_CREATE_SQL)
        # 检查/设置 schema 版本，并执行迁移
        cur = self._conn.execute("SELECT value FROM meta WHERE key='schema_version'")
        row = cur.fetchone()
        if row is None:
            self._conn.execute(
                "INSERT INTO meta(key, value) VALUES('schema_version', ?)",
                (str(_SCHEMA_VERSION),),
            )
            self._conn.commit()
        else:
            current_ver = int(row["value"])
            if current_ver < _SCHEMA_VERSION:
                self._migrate(current_ver)

    def _migrate(self, from_ver: int):
        """【v3.0】增量迁移数据库 schema。"""
        if from_ver < 2:
            # v2 → v2: 增加 adv_fields_json 列，保存高级模式各字段原始值
            try:
                self._conn.execute("ALTER TABLE images ADD COLUMN adv_fields_json TEXT DEFAULT ''")
            except Exception:
                pass  # 列已存在（比如从新 CREATE_SQL 创建的库）
        if from_ver < 3:
            # 【v3.0】新增 user_preferences 表
            try:
                self._conn.execute("""
                    CREATE TABLE IF NOT EXISTS user_preferences (
                        key        TEXT PRIMARY KEY,
                        value      TEXT NOT NULL DEFAULT '',
                        updated_at TEXT DEFAULT (datetime('now'))
                    )
                """)
            except Exception:
                pass  # 表已存在
        self._conn.execute(
            "UPDATE meta SET value=? WHERE key='schema_version'",
            (str(_SCHEMA_VERSION),),
        )
        self._conn.commit()

    # ------------------------------------------------------------------
    # 写入
    # ------------------------------------------------------------------

    def upsert(self, rec: ImageRecord) -> None:
        """插入或更新一条记录。"""
        self._conn.execute(
            """
            INSERT INTO images(id, filename, date, prompt, negative_prompt,
                seed, steps, width, height, cfg_scale, aspect_ratio,
                generation_time, favorited, deleted, created_at, tags_json,
                adv_fields_json)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                favorited=excluded.favorited,
                deleted=excluded.deleted,
                tags_json=excluded.tags_json,
                adv_fields_json=excluded.adv_fields_json
            """,
            (
                rec.id, rec.filename, rec.date, rec.prompt, rec.negative_prompt,
                rec.seed, rec.steps, rec.width, rec.height, rec.cfg_scale,
                rec.aspect_ratio, rec.generation_time,
                1 if rec.favorited else 0,
                1 if rec.deleted else 0,
                rec.created_at,
                json.dumps(rec.tags, ensure_ascii=False),
                json.dumps(rec.extra.get("adv_fields", {}), ensure_ascii=False) if rec.extra.get("adv_fields") else "",
            ),
        )
        self._conn.commit()

    def set_favorited(self, image_id: str, favorited: bool) -> bool:
        """设置收藏状态。返回是否找到记录。"""
        cur = self._conn.execute(
            "UPDATE images SET favorited=? WHERE id=? AND deleted=0",
            (1 if favorited else 0, image_id),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def mark_deleted(self, image_id: str) -> bool:
        """软删除。返回是否找到记录。"""
        cur = self._conn.execute(
            "UPDATE images SET deleted=1 WHERE id=?",
            (image_id,),
        )
        self._conn.commit()
        return cur.rowcount > 0

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def list_images(
        self,
        date: str | None = None,
        limit: int = 200,
        offset: int = 0,
        favorited_only: bool = False,
        tag: str | None = None,
    ) -> list[dict]:
        """查询图片列表，新的在前。"""
        # 前端性能优化：复用统一 WHERE 构造，在分页之前完成日期、收藏和标签过滤。
        # 这样 gallery-view.js 可以小批量请求，不再为了筛选而把全部图片塞进 DOM 和内存。
        where, params = self._gallery_where(date=date, favorited_only=favorited_only, tag=tag)
        params.extend([limit, offset])
        rows = self._conn.execute(
            f"SELECT * FROM images WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params,
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def list_dates(self) -> list[str]:
        """返回所有有图片的日期（降序）。"""
        rows = self._conn.execute(
            "SELECT DISTINCT date FROM images WHERE deleted=0 ORDER BY date DESC"
        ).fetchall()
        return [r["date"] for r in rows]

    def count(self, date: str | None = None, favorited_only: bool = False, tag: str | None = None) -> int:
        # 与 list_images 共享同一套过滤条件，目的在于让前端分页统计和实际列表始终一致。
        where, params = self._gallery_where(date=date, favorited_only=favorited_only, tag=tag)
        row = self._conn.execute(
            f"SELECT COUNT(*) as c FROM images WHERE {where}", params
        ).fetchone()
        return row["c"]

    def get_by_id(self, image_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM images WHERE id=?", (image_id,)
        ).fetchone()
        return self._row_to_dict(row) if row else None

    def exists(self, image_id: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM images WHERE id=?", (image_id,)
        ).fetchone()
        return row is not None

    # ------------------------------------------------------------------
    # JSON 迁移
    # ------------------------------------------------------------------

    def import_from_json(self, json_path: Path) -> bool:
        """从单个元数据 JSON 文件导入。返回是否新增。

        用于启动时自动导入历史数据。已存在的记录跳过。
        """
        try:
            meta = json.loads(json_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return False

        date = meta.get("date", json_path.parent.name)
        filename = meta.get("filename", json_path.stem + ".png")
        image_id = f"{date}/{filename.replace('.png', '')}"

        if self.exists(image_id):
            return False

        rec = ImageRecord(
            id=image_id,
            filename=filename,
            date=date,
            prompt=meta.get("prompt", ""),
            negative_prompt=meta.get("negative_prompt", ""),
            seed=meta.get("seed", 0),
            steps=meta.get("steps", 20),
            width=meta.get("width", 1024),
            height=meta.get("height", 1024),
            cfg_scale=meta.get("cfg_scale", 4.5),
            aspect_ratio=meta.get("aspect_ratio", ""),
            generation_time=meta.get("generation_time", 0),
            favorited=bool(meta.get("favorited", False)),
            deleted=False,
            created_at=meta.get("created_at", ""),
            tags=meta.get("tags", []),
        )
        self.upsert(rec)
        return True

    def import_all_from_output(self, output_dir: Path) -> int:
        """扫描 output 目录，导入所有尚未索引的 JSON 文件。

        返回新增条数。启动时调用一次即可。
        """
        count = 0
        if not output_dir.exists():
            return 0
        for date_dir in sorted(output_dir.iterdir()):
            if not date_dir.is_dir() or len(date_dir.name) != 10:
                continue
            for json_file in date_dir.glob("*.json"):
                if self.import_from_json(json_file):
                    count += 1
        return count

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------

    @staticmethod
    def _gallery_where(
        date: str | None = None,
        favorited_only: bool = False,
        tag: str | None = None,
    ) -> tuple[str, list]:
        """构造图库查询 WHERE 子句。"""
        clauses = ["deleted=0"]
        params: list = []
        if date:
            clauses.append("date=?")
            params.append(date)
        if favorited_only:
            clauses.append("favorited=1")
        if tag:
            # 前端性能优化：用 SQLite instr(lower(tags_json), ?) 表达原先 JS includes 的子串匹配。
            # 目的不是做搜索引擎，而是把已有标签过滤语义下推到数据库分页之前，减少传输和 DOM 压力。
            clauses.append("instr(LOWER(tags_json), ?) > 0")
            params.append(tag.lower())
        return " AND ".join(clauses), params

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["favorited"] = bool(d.get("favorited", 0))
        d["deleted"] = bool(d.get("deleted", 0))
        try:
            d["tags"] = json.loads(d.pop("tags_json", "[]"))
        except (json.JSONDecodeError, TypeError):
            d["tags"] = []
        # 【v2.3】解析 adv_fields_json → adv_fields 字典，供前端回填高级模式
        adv_raw = d.pop("adv_fields_json", "")
        try:
            d["adv_fields"] = json.loads(adv_raw) if adv_raw else {}
        except (json.JSONDecodeError, TypeError):
            d["adv_fields"] = {}
        return d


    # ------------------------------------------------------------------
    # 【v3.0 新增】用户偏好 CRUD
    # 用于实现提示词缓存/预设/自定义标签的全平台同步。
    # ------------------------------------------------------------------

    def get_preference(self, key: str) -> str | None:
        """获取单个偏好。不存在返回 None。"""
        row = self._conn.execute(
            "SELECT value FROM user_preferences WHERE key=?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def set_preference(self, key: str, value: str) -> None:
        """设置单个偏好（upsert）。"""
        self._conn.execute(
            """INSERT INTO user_preferences(key, value, updated_at)
               VALUES(?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET
                   value=excluded.value,
                   updated_at=excluded.updated_at""",
            (key, value),
        )
        self._conn.commit()

    def get_preferences(self, keys: list[str]) -> dict[str, str]:
        """批量获取偏好。返回 {key: value}，不存在的 key 不包含。"""
        if not keys:
            return {}
        placeholders = ",".join("?" * len(keys))
        rows = self._conn.execute(
            f"SELECT key, value FROM user_preferences WHERE key IN ({placeholders})",
            keys,
        ).fetchall()
        return {r["key"]: r["value"] for r in rows}

    def list_preferences_by_prefix(self, prefix: str) -> dict[str, str]:
        """按前缀查找偏好（如 'presets_' 获取所有字段预设）。"""
        rows = self._conn.execute(
            "SELECT key, value FROM user_preferences WHERE key LIKE ?",
            (prefix + "%",),
        ).fetchall()
        return {r["key"]: r["value"] for r in rows}

    def delete_preference(self, key: str) -> bool:
        """删除单个偏好。返回是否存在。"""
        cur = self._conn.execute(
            "DELETE FROM user_preferences WHERE key=?", (key,)
        )
        self._conn.commit()
        return cur.rowcount > 0

    def close(self):
        self._conn.close()
