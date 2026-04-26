#!/usr/bin/env python3
"""
【v3.0】缩略图迁移脚本：将旧的 320px JPEG 缩略图重新生成为 768px WebP。

扫描 output 目录下所有日期文件夹，对每张原图：
- 如果 thumbs/ 下已有 .webp 则跳过
- 否则从原图重新生成 768px WebP q90 缩略图
- 不删除旧的 .jpg 缩略图

用法：
  python scripts/migrate_thumbs.py /path/to/output
"""

import sys
from pathlib import Path
from PIL import Image

THUMB_WIDTH = 768
QUALITY = 90


def migrate_dir(output_dir: Path):
    """\u626b\u63cf output_dir \u4e0b\u6240\u6709\u65e5\u671f\u76ee\u5f55\uff0c\u8fc1\u79fb\u7f29\u7565\u56fe\u3002"""
    count = 0
    skipped = 0
    errors = 0

    for date_dir in sorted(output_dir.iterdir()):
        if not date_dir.is_dir() or len(date_dir.name) != 10:
            continue
        thumb_dir = date_dir / "thumbs"
        thumb_dir.mkdir(exist_ok=True)

        for png_file in date_dir.glob("*.png"):
            stem = png_file.stem
            webp_path = thumb_dir / f"{stem}.webp"

            # \u5df2\u5b58\u5728 .webp \u5219\u8df3\u8fc7
            if webp_path.exists():
                skipped += 1
                continue

            try:
                img = Image.open(png_file)
                ratio = THUMB_WIDTH / img.width
                thumb_h = int(img.height * ratio)
                thumb = img.resize((THUMB_WIDTH, thumb_h), Image.LANCZOS)

                # \u539f\u5b50\u5199\u5165\uff1a\u5148\u5199\u4e34\u65f6\u6587\u4ef6\u518d\u91cd\u547d\u540d
                tmp_path = webp_path.with_suffix(".tmp.webp")
                thumb.save(tmp_path, "WEBP", quality=QUALITY)
                tmp_path.rename(webp_path)
                count += 1

                if count % 50 == 0:
                    print(f"  \u5df2\u8fc1\u79fb {count} \u5f20...")
            except Exception as e:
                print(f"  \u9519\u8bef: {png_file.name}: {e}")
                errors += 1

    print(f"\n\u5b8c\u6210\u3002\u65b0\u751f\u6210: {count}\uff0c\u8df3\u8fc7(\u5df2\u5b58\u5728): {skipped}\uff0c\u9519\u8bef: {errors}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("\u7528\u6cd5: python scripts/migrate_thumbs.py <output_dir>")
        sys.exit(1)
    output_path = Path(sys.argv[1])
    if not output_path.is_dir():
        print(f"\u76ee\u5f55\u4e0d\u5b58\u5728: {output_path}")
        sys.exit(1)
    print(f"\u5f00\u59cb\u8fc1\u79fb\u7f29\u7565\u56fe: {output_path}")
    migrate_dir(output_path)
