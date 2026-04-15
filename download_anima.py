# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "modelscope>=1.18.0",
#     "transformers",
# ]
# ///

"""
Anima 模型下载脚本
用法：uv run download_anima.py [--version preview3] [--output-dir ./models]

功能：
  - 从 ModelScope 下载 circlestone-labs/Anima（国内直连，无需代理）
  - 支持选择版本：preview / preview2 / preview3（默认 preview3）
  - 同时下载两个 tokenizer（Qwen3-0.6B + T5-xxl，共约 16 MB）
  - 已存在且大小一致的文件自动跳过，不重复下载
  - 断点续传（modelscope SDK 内置支持）

推理所需文件：
  1. anima-<version>.safetensors  — DiT 扩散模型（2B 参数，~4.2 GB）
  2. qwen_3_06b_base.safetensors — 文本编码器 Qwen3 0.6B（~1.2 GB）
  3. qwen_image_vae.safetensors  — VAE 解码器（~300 MB）
  4. Qwen3-0.6B tokenizer        — json 文件（~15 MB）
  5. T5-xxl tokenizer             — json 文件（~800 KB）

下载完成后目录结构：
  models/
  ├── diffusion_models/
  │   └── anima-<version>.safetensors
  ├── text_encoders/
  │   └── qwen_3_06b_base.safetensors
  ├── vae/
  │   └── qwen_image_vae.safetensors
  └── tokenizers/
      ├── qwen3-0.6b/   (tokenizer.json 等)
      └── t5xxl/         (tokenizer.json 等)
"""

import os
import sys
import shutil
import argparse


# ============================================================
# 各版本 DiT 文件名映射
# text_encoders 和 vae 三版本共用，只有 DiT 不同
# ============================================================
_DIT_BY_VERSION = {
    "preview":  "anima-preview.safetensors",
    "preview2": "anima-preview2.safetensors",
    "preview3": "anima-preview3-base.safetensors",
}

# text_encoder + vae（所有版本共用）
_SHARED_FILES = [
    # (ModelScope 仓库内路径, 本地子目录, 文件名)
    ("split_files/text_encoders/qwen_3_06b_base.safetensors",
     "text_encoders", "qwen_3_06b_base.safetensors"),
    ("split_files/vae/qwen_image_vae.safetensors",
     "vae", "qwen_image_vae.safetensors"),
]


def _build_file_list(version: str) -> list[tuple[str, str, str]]:
    """根据版本构建完整的下载文件列表。"""
    dit_name = _DIT_BY_VERSION[version]
    dit_entry = (
        f"split_files/diffusion_models/{dit_name}",
        "diffusion_models",
        dit_name,
    )
    # DiT 放第一个，然后是共用的 text_encoder 和 vae
    return [dit_entry] + _SHARED_FILES


def _should_skip(target: str, cached: str) -> bool:
    """判断目标文件是否已存在且大小一致，一致则跳过。

    对比文件大小而非哈希，因为模型文件动辄数 GB，算哈希太慢。
    大小一致在实践中足以判断文件完整性。
    """
    if not os.path.exists(target):
        return False
    target_size = os.path.getsize(target)
    cached_size = os.path.getsize(cached)
    return target_size == cached_size


def main():
    parser = argparse.ArgumentParser(
        description="从 ModelScope 下载 Anima 模型",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  uv run download_anima.py                    # 默认下载 preview3\n"
               "  uv run download_anima.py --version preview2  # 下载 preview2\n"
               "  uv run download_anima.py --output-dir D:\\models\n",
    )
    parser.add_argument(
        "--version", default="preview3",
        choices=list(_DIT_BY_VERSION.keys()),
        help="Anima 版本（默认 preview3）",
    )
    parser.add_argument(
        "--output-dir", default=None,
        help="模型下载目标目录（默认 ./models/）",
    )
    args = parser.parse_args()

    model_id = "circlestone-labs/Anima"
    base_dir = args.output_dir or "./models"
    files = _build_file_list(args.version)

    # modelscope SDK，国内直连无需镜像/代理
    from modelscope.hub.file_download import model_file_download

    print("=" * 60)
    print(f"  模型:   {model_id}")
    print(f"  版本:   {args.version}")
    print(f"  下载源: ModelScope（国内直连）")
    print(f"  保存到: {os.path.abspath(base_dir)}")
    print(f"  文件数: {len(files)}")
    print("=" * 60)
    print()

    skipped = 0
    downloaded = 0

    try:
        for i, (ms_path, sub_dir, filename) in enumerate(files, 1):
            target_dir = os.path.join(base_dir, sub_dir)
            os.makedirs(target_dir, exist_ok=True)
            target = os.path.join(target_dir, filename)

            print(f"[{i}/{len(files)}] {filename}")
            print(f"  仓库路径: {ms_path}")
            print(f"  保存到:   {target}")

            # modelscope 下载到缓存（支持断点续传）
            cached = model_file_download(
                model_id=model_id,
                file_path=ms_path,
            )

            # 跳过已存在且大小一致的文件，避免重复 copy 浪费时间
            if _should_skip(target, cached):
                print(f"  ⏭ 已存在，跳过")
                skipped += 1
            else:
                shutil.copy2(cached, target)
                print(f"  ✓ 完成")
                downloaded += 1
            print()

        # ============================================================
        # 下载 Tokenizer
        # ============================================================
        # Qwen3-0.6B tokenizer：用 snapshot_download + allow_patterns
        # 排除 model.safetensors（~1.4GB），只下载 tokenizer json 文件（~15MB）。
        from modelscope import snapshot_download

        tok_base = os.path.join(base_dir, "tokenizers")

        # ---- Qwen3-0.6B tokenizer ----
        qwen_tok_dir = os.path.join(tok_base, "qwen3-0.6b")
        if os.path.exists(os.path.join(qwen_tok_dir, "tokenizer.json")):
            print(f"[tokenizer] qwen3-0.6b: ⏭ 已存在，跳过")
        else:
            print(f"[tokenizer] 下载 Qwen3-0.6B tokenizer...")
            cached_dir = snapshot_download(
                "Qwen/Qwen3-0.6B",
                allow_patterns=["*.json"],
            )
            # snapshot_download 返回缓存目录，复制 json 文件到目标
            os.makedirs(qwen_tok_dir, exist_ok=True)
            for f in os.listdir(cached_dir):
                if f.endswith(".json"):
                    shutil.copy2(os.path.join(cached_dir, f), qwen_tok_dir)
            print(f"  ✓ 保存到: {qwen_tok_dir}")

        # ---- T5-xxl tokenizer ----
        t5_tok_dir = os.path.join(tok_base, "t5xxl")
        if os.path.exists(os.path.join(t5_tok_dir, "tokenizer.json")):
            print(f"[tokenizer] t5xxl: ⏭ 已存在，跳过")
        else:
            print(f"[tokenizer] 下载 T5-xxl tokenizer...")
            cached_dir = snapshot_download(
                "stabilityai/stable-diffusion-3.5-large",
                allow_patterns=["tokenizer_3/*"],
            )
            os.makedirs(t5_tok_dir, exist_ok=True)
            t3_dir = os.path.join(cached_dir, "tokenizer_3")
            for f in os.listdir(t3_dir):
                shutil.copy2(os.path.join(t3_dir, f), t5_tok_dir)
            print(f"  ✓ 保存到: {t5_tok_dir}")
        print()

        # ---- 汇总 ----
        print("=" * 60)
        print(f"下载完成！保存到: {os.path.abspath(base_dir)}")
        print(f"  新下载: {downloaded}  跳过: {skipped}")
        print()
        print("目录结构:")
        print(f"  {base_dir}/")
        dit_name = _DIT_BY_VERSION[args.version]
        print(f"  ├── diffusion_models/{dit_name}")
        print(f"  ├── text_encoders/qwen_3_06b_base.safetensors")
        print(f"  ├── vae/qwen_image_vae.safetensors")
        print(f"  └── tokenizers/")
        print(f"      ├── qwen3-0.6b/   (tokenizer.json ...)")
        print(f"      └── t5xxl/         (tokenizer.json ...)")
        print("=" * 60)

    except KeyboardInterrupt:
        print("\n下载被用户中断。重新运行即可继续（支持断点续传）。")
        sys.exit(1)
    except Exception as e:
        print(f"\n下载出错: {e}")
        print("请检查网络连接，然后重新运行（支持断点续传 + 跳过已有文件）。")
        sys.exit(1)


if __name__ == "__main__":
    main()
