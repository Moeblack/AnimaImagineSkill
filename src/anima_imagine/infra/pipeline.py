"""v2 GPU 推理管线。

相对 v1 的变化：
- 移除了 asyncio.Lock，GPU 串行化由 JobQueue 保证
- generate() 变为纯同步方法（由 queue worker 在线程池中调用）
- 其余逻辑（模型加载、tokenizer 查找、SageAttention、torch.compile）不变
"""
from __future__ import annotations

import gc
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING

import torch
from PIL import Image

from anima_imagine.config import Config

if TYPE_CHECKING:
    pass

_DIT_BY_VERSION = {
    "preview":  "anima-preview.safetensors",
    "preview2": "anima-preview2.safetensors",
    "preview3": "anima-preview3-base.safetensors",
    "base-v1.0": "anima-base-v1.0.safetensors",
}


class AnimaPipeline:
    """Anima 推理封装。

    v2: 不再内置 asyncio.Lock，串行化由 JobQueue 在上层保证。
    generate() 是纯同步方法，在线程池中执行。
    """

    def __init__(self, cfg: Config | None = None):
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

    def load(self) -> None:
        """Load Anima model into VRAM. Blocks until ready."""
        from diffsynth.pipelines.anima_image import AnimaImagePipeline, ModelConfig

        dit_filename = _DIT_BY_VERSION.get(self.model_version)
        if dit_filename is None:
            raise ValueError(
                f"不支持的 model_version: {self.model_version!r}，"
                f"可选值: {', '.join(_DIT_BY_VERSION.keys())}"
            )

        print(f"[AnimaPipeline] 加载模型（版本: {self.model_version}）...")
        t0 = time.time()

        if self.model_dir:
            d = Path(self.model_dir)
            model_configs = [
                ModelConfig(path=str(d / "diffusion_models" / dit_filename)),
                ModelConfig(path=str(d / "text_encoders" / "qwen_3_06b_base.safetensors")),
                ModelConfig(path=str(d / "vae" / "qwen_image_vae.safetensors")),
            ]
            tokenizer_cfg = self._find_qwen_tokenizer(ModelConfig)
            tokenizer_t5_cfg = self._find_t5_tokenizer(ModelConfig)
        else:
            model_configs = [
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern=f"split_files/diffusion_models/{dit_filename}"),
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern="split_files/text_encoders/qwen_3_06b_base.safetensors"),
                ModelConfig(model_id="circlestone-labs/Anima", origin_file_pattern="split_files/vae/qwen_image_vae.safetensors"),
            ]
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

        if self.sage_attention:
            try:
                from sageattention import sageattn  # noqa: F401
                import diffsynth.core.attention as attn_module
                attn_module.ATTENTION_IMPLEMENTATION = "sage_attention"
                print("[AnimaPipeline] SageAttention 已启用")
            except Exception as e:
                print(f"[AnimaPipeline] SageAttention 不可用: {e}")

        if self.compile_models and hasattr(self.pipe, "compile_pipeline"):
            print("[AnimaPipeline] 正在编译 DiT (torch.compile)...")
            t_compile = time.time()
            self.pipe.compile_pipeline(mode="default", dynamic=True)
            print(f"[AnimaPipeline] torch.compile 完成，耗时 {time.time() - t_compile:.1f}s")

        if self.low_vram and hasattr(self.pipe, "enable_cpu_offload"):
            self.pipe.enable_cpu_offload()
            print("[AnimaPipeline] 低显存模式已启用 (CPU offload)")

    def _find_qwen_tokenizer(self, ModelConfig):
        if self._cfg.qwen_tokenizer_path:
            p = Path(self._cfg.qwen_tokenizer_path)
            if p.exists() and (p / "tokenizer.json").exists():
                return ModelConfig(path=str(p))
        base = os.environ.get("DIFFSYNTH_MODEL_BASE_PATH", "./models")
        cached = Path(base) / "Qwen" / "Qwen3-0.6B"
        if cached.exists() and (cached / "tokenizer.json").exists():
            return ModelConfig(path=str(cached))
        print("[AnimaPipeline] ⚠ Qwen3 tokenizer 未找到，将从远程下载")
        return ModelConfig(model_id="Qwen/Qwen3-0.6B", origin_file_pattern="./")

    def _find_t5_tokenizer(self, ModelConfig):
        if self._cfg.t5xxl_tokenizer_path:
            p = Path(self._cfg.t5xxl_tokenizer_path)
            if p.exists() and (p / "tokenizer.json").exists():
                return ModelConfig(path=str(p))
        return ModelConfig(
            model_id="stabilityai/stable-diffusion-3.5-large",
            origin_file_pattern="tokenizer_3/",
        )

    def generate(
        self,
        prompt: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        seed: int = -1,
        cfg_scale: float = 4.5,
    ) -> tuple[Image.Image, int, float]:
        """v2: 纯同步生成。由 JobQueue 在线程池中调用。

        返回 (PIL.Image, 实际种子, 耗时秒)。
        """
        # 【v3.1】自动加载：如果模型已被 unload()，则在此处自动重新加载
        # 这样用户无需手动点击「重新加载」按钮，直接生图即可触发
        if self.pipe is None:
            print("[AnimaPipeline] 模型未加载，正在自动加载...")
            self.load()  # 使用 __init__ 时保留的 _cfg，与初始加载完全一致
            print("[AnimaPipeline] 自动加载完成，继续推理")

        if seed < 0:
            seed = torch.randint(0, 2**32 - 1, (1,)).item()

        # 对齐 16 倍数
        width = ((width + 15) // 16) * 16
        height = ((height + 15) // 16) * 16

        print(f"[Generate] {width}×{height}, steps={steps}, seed={seed}, cfg={cfg_scale}")
        print(f"  prompt: {prompt[:100]}{'...' if len(prompt) > 100 else ''}")

        t0 = time.time()
        with torch.inference_mode():
            try:
                result = self.pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    height=height, width=width,
                    num_inference_steps=steps,
                    cfg_scale=cfg_scale,
                    seed=seed,
                )
            except TypeError:
                print("[Generate] 回退到最小参数集")
                result = self.pipe(prompt=prompt, num_inference_steps=steps, seed=seed)

        elapsed = time.time() - t0

        if isinstance(result, list):
            image = result[0]
        elif hasattr(result, "images"):
            image = result.images[0]
        else:
            image = result

        if self.clear_cuda_cache:
            torch.cuda.empty_cache()

        print(f"[Generate] 完成，耗时 {elapsed:.1f}s")
        return image, seed, elapsed


    # ------------------------------------------------------------------
    # 【v3.1 新增】显存管理：卸载 / 重载
    # ------------------------------------------------------------------

    @property
    def is_loaded(self) -> bool:
        """模型是否已加载到 GPU。"""
        return self.pipe is not None

    def unload(self) -> None:
        """卸载模型并释放 GPU 显存。

        执行顺序（经验证的最有效的清理步骤）：
        1. 将 pipeline 移到 CPU
        2. 删除 Python 引用
        3. 强制垃圾回收
        4. 清空 CUDA 缓存

        注意：卸载后必须调用 reload() 才能再次推理。
        """
        if self.pipe is None:
            print("[AnimaPipeline] 模型未加载，无需卸载")
            return

        print("[AnimaPipeline] 正在卸载模型...")
        try:
            # DiffSynth pipeline 可能有 to() 方法，尝试移到 CPU
            if hasattr(self.pipe, "to"):
                self.pipe.to("cpu")
                print("[AnimaPipeline] 模型已移至 CPU")
        except Exception as e:
            print(f"[AnimaPipeline] 移至 CPU 失败（非致命）: {e}")

        # 删除 pipeline 引用
        del self.pipe
        self.pipe = None

        # 强制垃圾回收（必须在 empty_cache 之前）
        gc.collect()

        # 清空 CUDA 缓存
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            # 同时清理 CUDA IPC 和 cuBLAS 工作区
            try:
                torch.cuda.ipc_collect()
            except Exception:
                pass
            try:
                torch._C._cuda_clearCublasWorkspaces()
            except Exception:
                pass

        print("[AnimaPipeline] 模型已卸载，GPU 显存已释放")

    def reload(self) -> None:
        """重新加载模型到 GPU。必须在 unload() 之后调用。"""
        if self.pipe is not None:
            print("[AnimaPipeline] 模型已加载，跳过 reload")
            return
        print("[AnimaPipeline] 正在重新加载模型...")
        self.load()
