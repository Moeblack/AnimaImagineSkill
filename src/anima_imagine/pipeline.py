"""
Anima GPU 推理管线。

封装 DiffSynth-Studio 的 AnimaImagePipeline，提供：
- 模型常驻显存（启动时加载一次）
- asyncio.Lock 串行化 GPU 访问，避免并发 OOM
- 每次生成后清理 CUDA 缓存
- torch.inference_mode() 加速推理
- 从 Config 对象读取所有路径，不再硬编码
"""

from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING

import torch
from PIL import Image

from anima_imagine.config import Config

if TYPE_CHECKING:
    pass

# ============================================================
# 各版本 DiT 文件名映射（与 download_anima.py 保持同步）
# text_encoder 和 vae 三版本共用，只有 DiT 不同
# ============================================================
_DIT_BY_VERSION = {
    "preview":  "anima-preview.safetensors",
    "preview2": "anima-preview2.safetensors",
    "preview3": "anima-preview3-base.safetensors",
}


class AnimaPipeline:
    """线程安全的 Anima 推理封装。

    通过 asyncio.Lock 保证同一时刻只有一个生成任务占用 GPU，
    多个请求会自动排队。
    """

    def __init__(
        self,
        cfg: Config | None = None,
    ):
        # 支持传入 Config 对象，也兼容无参构造（用默认值）
        if cfg is None:
            cfg = Config()
        self.model_dir = cfg.model_dir or None
        self.model_version = cfg.model_version
        self.device = cfg.device
        self.low_vram = cfg.low_vram
        self.sage_attention = cfg.sage_attention
        self.compile_models = cfg.compile_models
        self.clear_cuda_cache = cfg.clear_cuda_cache
        self._cfg = cfg
        self.pipe = None
        # GPU 锁：任意多个 HTTP 请求可以并发进入，但 GPU 推理严格串行
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # 模型加载（启动时调用一次）
    # ------------------------------------------------------------------
    def load(self) -> None:
        """Load Anima model into VRAM. Blocks until ready."""
        from diffsynth.pipelines.anima_image import AnimaImagePipeline, ModelConfig

        # 根据 model_version 查找 DiT 文件名
        dit_filename = _DIT_BY_VERSION.get(self.model_version)
        if dit_filename is None:
            raise ValueError(
                f"不支持的 model_version: {self.model_version!r}，"
                f"可选值: {', '.join(_DIT_BY_VERSION.keys())}"
            )

        print(f"[AnimaPipeline] 加载模型（版本: {self.model_version}）...")
        t0 = time.time()

        if self.model_dir:
            # --- 本地模型文件 ---
            # model_dir 结构: diffusion_models/ text_encoders/ vae/
            d = Path(self.model_dir)
            model_configs = [
                ModelConfig(
                    path=str(d / "diffusion_models" / dit_filename)
                ),
                ModelConfig(
                    path=str(d / "text_encoders" / "qwen_3_06b_base.safetensors")
                ),
                ModelConfig(
                    path=str(d / "vae" / "qwen_image_vae.safetensors")
                ),
            ]

            # --- Qwen tokenizer ---
            # 查找顺序：config 路径 → DiffSynth 缓存目录 → 远程下载
            tokenizer_cfg = self._find_qwen_tokenizer(ModelConfig)

            # --- T5 tokenizer ---
            tokenizer_t5_cfg = self._find_t5_tokenizer(ModelConfig)

        else:
            # --- 从 HuggingFace / ModelScope 自动下载 ---
            # DiT 文件名由 model_version 决定
            model_configs = [
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern=f"split_files/diffusion_models/{dit_filename}"),
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern="split_files/text_encoders/qwen_3_06b_base.safetensors"),
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern="split_files/vae/qwen_image_vae.safetensors"),
            ]
            # tokenizer 查找逻辑与本地模式相同
            tokenizer_cfg = self._find_qwen_tokenizer(ModelConfig)
            tokenizer_t5_cfg = self._find_t5_tokenizer(ModelConfig)

        self.pipe = AnimaImagePipeline.from_pretrained(
            torch_dtype=torch.bfloat16,
            device=self.device,
            model_configs=model_configs,
            tokenizer_config=tokenizer_cfg,
            tokenizer_t5xxl_config=tokenizer_t5_cfg,
        )

        elapsed = time.time() - t0
        print(f"[AnimaPipeline] 模型加载完成，耗时 {elapsed:.1f}s")

        # 启用 SageAttention（仅作用于 DiT，通过 DiffSynth 内置的 attention 模块切换）
        if self.sage_attention:
            try:
                from sageattention import sageattn  # noqa: F401
                import diffsynth.core.attention as attn_module
                attn_module.ATTENTION_IMPLEMENTATION = "sage_attention"
                print("[AnimaPipeline] SageAttention 已启用（仅 DiT）")
            except Exception as e:
                print(f"[AnimaPipeline] SageAttention 不可用，跳过: {e}")
                print("[AnimaPipeline]   安装方式: uv pip install sageattention 或 pip install sageattention")

        # 启用 torch.compile（DiT 为 compilable_models）
        if self.compile_models and hasattr(self.pipe, "compile_pipeline"):
            print("[AnimaPipeline] 正在编译 DiT (torch.compile)...")
            t_compile = time.time()
            self.pipe.compile_pipeline(mode="default", dynamic=True)
            print(f"[AnimaPipeline] torch.compile 完成，耗时 {time.time() - t_compile:.1f}s")

        # 低显存模式：DiffSynth 可能支持 CPU offload
        if self.low_vram and hasattr(self.pipe, "enable_cpu_offload"):
            self.pipe.enable_cpu_offload()
            print("[AnimaPipeline] 低显存模式已启用 (CPU offload)")

    # ------------------------------------------------------------------
    # Tokenizer 查找辅助方法
    # ------------------------------------------------------------------
    # Qwen3-0.6B 仓库根目录下既有 tokenizer json（~15MB）也有 model.safetensors（~1.4GB）。
    # DiffSynth 的 origin_file_pattern="./" 会下载整个仓库，浪费带宽。
    # 用 "*.json" 只下载 json 但会导致 path 变成文件列表，
    # 而 AutoTokenizer.from_pretrained() 需要目录路径，直接报错。
    #
    # 解决方案：多级查找。先查本地路径，再查 DiffSynth 缓存目录，
    # 最终回退到 "./" 完整下载（仅首次，之后缓存命中）。
    # ------------------------------------------------------------------

    def _find_qwen_tokenizer(self, ModelConfig):
        """查找 Qwen3-0.6B tokenizer 目录，返回 ModelConfig。

        查找顺序：
        1. config.yaml 中 tokenizer.qwen_path 配置的路径
        2. DiffSynth 默认缓存目录（DIFFSYNTH_MODEL_BASE_PATH/Qwen/Qwen3-0.6B/）
        3. 最终回退：origin_file_pattern="./" 从远程完整下载
        """
        # 1. 用户配置的本地路径
        if self._cfg.qwen_tokenizer_path:
            p = Path(self._cfg.qwen_tokenizer_path)
            if p.exists() and (p / "tokenizer.json").exists():
                return ModelConfig(path=str(p))

        # 2. DiffSynth 默认缓存（之前自动下载可能已经缓存在这里）
        base = os.environ.get("DIFFSYNTH_MODEL_BASE_PATH", "./models")
        cached = Path(base) / "Qwen" / "Qwen3-0.6B"
        if cached.exists() and (cached / "tokenizer.json").exists():
            return ModelConfig(path=str(cached))

        # 3. 最终回退：让 DiffSynth 从 ModelScope/HF 下载整个仓库。
        #    ⚠ 这会下载 ~1.4GB 模型权重，建议用 download_anima.py 预下载。
        print("[AnimaPipeline] ⚠ Qwen3 tokenizer 未找到，将从远程完整下载（含 ~1.4GB 模型权重）")
        print("[AnimaPipeline]   建议运行 uv run download_anima.py 预下载到本地")
        return ModelConfig(model_id="Qwen/Qwen3-0.6B", origin_file_pattern="./")

    def _find_t5_tokenizer(self, ModelConfig):
        """查找 T5-xxl tokenizer 目录，返回 ModelConfig。

        查找顺序：
        1. config.yaml 中 tokenizer.t5xxl_path 配置的路径
        2. 最终回退：从 stabilityai/stable-diffusion-3.5-large 的 tokenizer_3/ 下载
           （子目录模式，DiffSynth 能正确处理为目录路径）
        """
        if self._cfg.t5xxl_tokenizer_path:
            p = Path(self._cfg.t5xxl_tokenizer_path)
            if p.exists() and (p / "tokenizer.json").exists():
                return ModelConfig(path=str(p))

        return ModelConfig(
            model_id="stabilityai/stable-diffusion-3.5-large",
            origin_file_pattern="tokenizer_3/",
        )


    # ------------------------------------------------------------------
    # 异步生成接口（带 GPU 锁）
    # ------------------------------------------------------------------
    async def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        seed: int = -1,
        cfg_scale: float = 4.5,
    ) -> tuple[Image.Image, int, float]:
        """生成图片。返回 (PIL.Image, 实际种子, 生成耗时秒)。

        通过 asyncio.Lock 保证同时只有 1 个任务占用 GPU，
        多个并发请求自动排队等待。
        """
        async with self._lock:
            return await asyncio.to_thread(
                self._generate_sync,
                prompt, negative_prompt, width, height, steps, seed, cfg_scale,
            )

    def _generate_sync(
        self,
        prompt: str,
        negative_prompt: str,
        width: int,
        height: int,
        steps: int,
        seed: int,
        cfg_scale: float,
    ) -> tuple[Image.Image, int, float]:
        """同步生成（在线程池中执行，不阻塞事件循环）。"""
        assert self.pipe is not None, "模型未加载，请先调用 load()"

        # 种子处理：-1 表示随机
        if seed < 0:
            seed = torch.randint(0, 2**32 - 1, (1,)).item()

        # 分辨率对齐到 16 的倍数（Cosmos 架构要求，DiffSynth 内部也会做，但提前对齐并日志更清晰）
        orig_width, orig_height = width, height
        width = ((width + 15) // 16) * 16
        height = ((height + 15) // 16) * 16
        if width != orig_width or height != orig_height:
            print(f"[Generate] 分辨率已对齐到 16 倍数: {width}×{height}")

        print(f"[Generate] {width}×{height}, steps={steps}, seed={seed}, cfg={cfg_scale}")
        print(f"  prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")

        t0 = time.time()

        with torch.inference_mode():
            # DiffSynth AnimaImagePipeline 调用
            # 参数名可能随版本微调，用 try/except 兼容
            try:
                result = self.pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    height=height,
                    width=width,
                    num_inference_steps=steps,
                    cfg_scale=cfg_scale,
                    seed=seed,
                )
            except TypeError:
                # 回退：部分参数可能不被支持
                print("[Generate] 回退到最小参数集")
                result = self.pipe(
                    prompt=prompt,
                    num_inference_steps=steps,
                    seed=seed,
                )

        elapsed = time.time() - t0

        # DiffSynth 可能返回单图 / 列表 / 带 .images 属性的对象
        if isinstance(result, list):
            image = result[0]
        elif hasattr(result, "images"):
            image = result.images[0]
        else:
            image = result  # 假定是 PIL.Image

        # 显存清理：默认关闭以提升连续生成速度；仅在配置开启时执行
        if self.clear_cuda_cache:
            # 不同分辨率的请求会分配不同大小的显存块，
            # PyTorch 缓存分配器不会自动归还，累积几次就会 OOM。
            torch.cuda.empty_cache()

        print(f"[Generate] 完成，耗时 {elapsed:.1f}s")
        return image, seed, elapsed
