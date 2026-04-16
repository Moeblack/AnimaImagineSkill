# AnimaImagineSkill

独立的 Anima 二次元出图 MCP 服务。不依赖 ComfyUI，直接通过 [DiffSynth-Studio](https://github.com/modelscope/DiffSynth-Studio) 的 `AnimaImagePipeline` 在 GPU 上推理。

```
AI 客户端 (Cursor / Claude / Cherry Studio)
    │  Streamable HTTP MCP
    ▼
AnimaImagineSkill 服务器
    ├─ generate_anima_image()   MCP 工具
    ├─ 图片画廊网页             http://localhost:8008/
    └─ DiffSynth AnimaImagePipeline  (Anima 常驻显存)
```

---

## 环境要求

- Python ≥ 3.13
- NVIDIA GPU + CUDA（推荐 ≥ 12 GB 显存；低显存模式可在 8 GB 上跑）
- 磁盘空间：模型文件约 14 GB + tokenizer 约 16 MB

---

## 安装

有两种安装方式：**uv（推荐）** 和 **pip**。核心区别在于 PyTorch CUDA 版的处理方式。

### 方式 A：uv（推荐，一键搞定）

[uv](https://docs.astral.sh/uv/) 会自动处理虚拟环境、Python 版本，并通过 `pyproject.toml` 里的 `[[tool.uv.index]]` 配置自动安装 CUDA 版 PyTorch。

```bash
git clone https://github.com/Moeblack/AnimaImagineSkill.git
cd AnimaImagineSkill

# 安装 uv（如果没装过）
# Linux / macOS
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 一键安装（自动创建 .venv + 安装 CUDA 版 PyTorch + 所有依赖）
uv sync
```

默认通过南京大学镜像安装 CUDA 13.0 版 PyTorch（国内直连，无需代理）。如需其他 CUDA 版本，修改 `pyproject.toml` 中 `[[tool.uv.index]]` 的 URL：

```toml
# RTX 5090 (Blackwell) → cu130
url = "https://mirror.nju.edu.cn/pytorch/whl/cu130/"

# 海外用户 → PyTorch 官方源
url = "https://download.pytorch.org/whl/cu130/"
```

### 方式 B：pip（手动控制 PyTorch 版本）

PyPI 上的 torch 默认是 CPU 版。**必须先手动安装 CUDA 版 PyTorch**，再安装本包（pip 不会覆盖已装的 torch）：

```bash
git clone https://github.com/Moeblack/AnimaImagineSkill.git
cd AnimaImagineSkill
python -m venv .venv

# Linux / macOS
source .venv/bin/activate
# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# 第一步：先装 CUDA 版 PyTorch（根据 GPU 选择）
pip install torch torchvision torchaudio --index-url https://mirror.nju.edu.cn/pytorch/whl/cu124

# 第二步：再装本包（pip 检测到 torch 已满足 >=2.0，不会覆盖）
pip install anima-imagine-skill
# 或从源码安装
pip install -e .
```

> **为什么不能直接 `pip install anima-imagine-skill`？**
> 因为 pip 会从 PyPI 拉 CPU 版 torch。必须先用 `--index-url` 装好 CUDA 版，
> 再装本包时 pip 才会跳过 torch 不覆盖。这是整个 Python ML 生态的通用做法，
> diffusers、ComfyUI 等项目都是这样处理的。

---

## 下载模型

Anima 推理需要 3 个模型文件（约 14 GB）+ 2 个 tokenizer（约 16 MB）。

### 方法 A：ModelScope 下载（推荐，国内直连）

```bash
# uv run 会自动安装 modelscope 临时依赖并执行脚本，无需手动 pip install
uv run download_anima.py
# 文件保存到 ./models/ 目录

# 下载其他版本（preview / preview2 / preview3，默认 preview3）
uv run download_anima.py --version preview2
# 已存在且大小一致的文件会自动跳过，不重复下载
```

下载完成后目录结构：

```
models/
├── diffusion_models/
│   └── anima-preview3-base.safetensors   # DiT 扩散模型（~4.2 GB）
├── text_encoders/
│   └── qwen_3_06b_base.safetensors      # Qwen3 0.6B 文本编码器（~1.2 GB）
├── vae/
│   └── qwen_image_vae.safetensors       # Qwen-Image VAE（~300 MB）
└── tokenizers/                           # 脚本一并下载，无需手动处理
    ├── qwen3-0.6b/                       # Qwen3-0.6B tokenizer（~15 MB）
    │   ├── tokenizer.json
    │   └── ...
    └── t5xxl/                            # T5-xxl tokenizer（~800 KB）
        ├── tokenizer.json
        └── ...
```

### 方法 B：自动下载（需要能访问 HuggingFace）

不配置 `model_dir`，服务启动时会从 HuggingFace / ModelScope 自动下载到本地缓存。

> **国内用户注意**：自动下载默认走 HuggingFace，国内可能无法直连。
> 可设置镜像：`export HF_ENDPOINT=https://hf-mirror.com`（Linux/macOS）
> 或 `$env:HF_ENDPOINT = "https://hf-mirror.com"`（PowerShell）。
> 建议优先用方法 A。

### Tokenizer

`uv run download_anima.py` 已经包含 tokenizer 下载，无需额外操作。
如果 tokenizer 路径缺失或无效，服务启动时也会自动从远程下载（首次会多下载约 1.4 GB 的 Qwen3 模型权重作为副产品，之后缓存命中不再重复）。

---

## 配置

复制示例配置并修改路径：

```bash
# Linux / macOS
cp config.example.yaml config.yaml

# Windows PowerShell
Copy-Item config.example.yaml config.yaml
```

```yaml
# config.yaml
server:
  host: "0.0.0.0"
  port: 8008

model:
  model_dir: "./models"      # 指向 diffusion_models/ text_encoders/ vae/ 所在目录
  model_version: "preview3"  # preview / preview2 / preview3
  device: "cuda"
  low_vram: false            # 8GB 显存设为 true

optimization:
  sage_attention: true      # 启用 SageAttention 加速 DiT（需安装 sageattention）
  compile_models: true      # 启用 torch.compile 加速 DiT（常驻服务推荐）
  clear_cuda_cache: false   # 每次生成后清空 CUDA 缓存（常驻服务建议关闭）

tokenizer:
  qwen_path: "./models/tokenizers/qwen3-0.6b"
  t5xxl_path: "./models/tokenizers/t5xxl"

output:
  dir: "./output"
```

配置优先级：环境变量 > config.yaml > 默认值。环境变量名见下表：

| 环境变量 | 对应 config.yaml | 默认值 |
|---|---|---|
| `ANIMA_HOST` | `server.host` | `0.0.0.0` |
| `ANIMA_PORT` | `server.port` | `8008` |
| `ANIMA_MODEL_DIR` | `model.model_dir` | （空，自动下载） |
| `ANIMA_MODEL_VERSION` | `model.model_version` | `preview3` |
| `ANIMA_DEVICE` | `model.device` | `cuda` |
| `ANIMA_LOW_VRAM` | `model.low_vram` | `false` |
| `ANIMA_QWEN_TOKENIZER` | `tokenizer.qwen_path` | （空，自动下载） |
| `ANIMA_SAGE_ATTENTION` | `optimization.sage_attention` | `true` |
| `ANIMA_COMPILE_MODELS` | `optimization.compile_models` | `true` |
| `ANIMA_CLEAR_CUDA_CACHE` | `optimization.clear_cuda_cache` | `false` |
| `ANIMA_T5XXL_TOKENIZER` | `tokenizer.t5xxl_path` | （空，自动下载） |
| `ANIMA_OUTPUT_DIR` | `output.dir` | `./output` |

---

## 启动

```bash
# Linux / macOS
python -m anima_imagine

# Windows PowerShell
python -m anima_imagine
# 或用启动脚本
.\start.ps1
```

服务启动后：

| 地址 | 说明 |
|---|---|
| `http://localhost:8008/mcp/` | MCP 端点（AI 客户端连接） |
| `http://localhost:8008/` | 图片画廊（瀑布流浏览） |
| `http://localhost:8008/health` | 健康检查 |

---

## 连接 AI 客户端

### 1. 配置 MCP

在 Cursor / LimCode / Claude Desktop 的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "anima-imagine": {
      "type": "streamable-http",
      "url": "http://localhost:8008/mcp/"
    }
  }
}
```

### 2. 加载 Skill

将 `AnimaImagineSkill/SKILL.md` 添加为客户端的 Skill / System Prompt，AI 就会学会 Anima 的标签规范和提示词写法。

### 3. 开始使用

对 AI 说“画一个穿白裙的少女在花园里，竖屏 9:16”即可。

---

## 自定义分辨率

除了用 `aspect_ratio` 选择预设比例（均约 1MP），你还可以直接传入 `width` 和 `height` 自定义分辨率：

```json
{
  "width": 1024,
  "height": 1536,  // 约 1.5MP
  "steps": 20
}
```

常用自定义分辨率参考：

| 目标像素 | width × height | 说明 |
|---|---|---|
| ~1.0 MP | 1024 × 1024 | 默认 1:1，效果最稳定 |
| ~1.5 MP | 1024 × 1536 | **Anima3 推荐**，竖屏高清，steps=20 |
| ~1.6 MP | 1152 × 1344 | 接近 4:3，画面更饱满，steps=20 |
| ~2.0 MP | 1152 × 1792 | 竖屏超高清，steps 建议 30+ |

> 提示：宽高会自动对齐到 16 的倍数。超过 1.5MP 时建议适当增加 steps 以稳定肢体细节。

---

## 项目结构

```
AnimaImagineSkill/
├── config.example.yaml       # 配置示例（提交到 Git）
├── config.yaml               # 本地配置（不提交，在 .gitignore 中）
├── pyproject.toml
├── mcp-config.json           # MCP 客户端配置示例
├── download_anima.py          # ModelScope 模型下载脚本
├── start.ps1                 # Windows 启动脚本
├── models/                    # 所有模型文件（按类别分子目录）
│   ├── diffusion_models/      #   Anima DiT 扩散模型
│   ├── text_encoders/         #   Qwen3 文本编码器权重
│   ├── vae/                   #   Qwen-Image VAE
│   └── tokenizers/            #   tokenizer 文件（不含模型权重）
│       ├── qwen3-0.6b/
│       └── t5xxl/
├── src/anima_imagine/
│   ├── server.py             # FastMCP 入口 + 画廊路由
│   ├── pipeline.py           # DiffSynth GPU 推理封装
│   ├── prompt_builder.py     # 结构化字段 → prompt 拼接
│   ├── config.py             # 配置加载（YAML + 环境变量）
│   ├── storage.py            # 日期归档 + 缩略图
│   ├── resolution.py         # 比例 → 分辨率映射
│   └── gallery.html          # 瀑布流画廊网页
├── AnimaImagineSkill/
│   ├── SKILL.md              # 提示词工程师 Skill
│   └── references/
│       ├── artist-list.md    # 画师收藏
│       └── prompt-examples.md
└── output/                   # 生成的图片（按日期分目录）
```

---

## 性能优化

服务内置了多项与 ComfyUI 对齐的加速优化，无需引入 ComfyUI 依赖：

- **`torch.compile`**：服务启动时自动编译 DiT，首次生图有 5~10s 预热，之后每张图显著加速。
- **SageAttention**：自动检测并启用。RTX 5090/Blackwell 用户需手动安装对应版本：
  ```powershell
  # Windows + Python 3.13 + PyTorch 2.11 cu130 (Blackwell)
  uv pip install triton-windows
  uv pip install https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl
  ```
- **移除强制 `empty_cache()`**：默认关闭，避免连续生成时反复分配显存，提升常驻服务吞吐量。
- **分辨率 16 对齐**：自动生成前将宽高对齐到 16 的倍数，符合 Cosmos 架构要求。

### Benchmark（RTX 5090, 832×1216, steps=30, cfg=4.5）

| 配置 | 平均耗时 | 说明 |
|---|---|---|
| Baseline | 6.60s | 无优化 |
| Optimized | **4.53s** | SageAttention + torch.compile |
| **提速** | **~13%** | 连续生成时后两张稳定在 ~5.8s |

> 注：`torch.compile` 首图会有额外 5~15s 的编译预热时间，仅对多次生成或常驻服务有收益。

---

## 设计决策

- **无 ComfyUI 依赖**：直接调用 DiffSynth-Studio，单进程部署。
- **Prompt 拼接由 AI 完成**：工具接受已拼接的字符串，不做结构化拆分。Skill 教 AI 正确的标签顺序。
- **GPU 串行调度**：`asyncio.Lock` 保证同时只有 1 个推理任务，多请求自动排队。
- **显存管理**：默认不复用 `torch.cuda.empty_cache()`，提升连续生成速度；低显存或单次运行场景可在配置中开启。
- **日期归档**：图片按日期分目录，每张附带元数据 JSON + 缩略图。

---

## License

MIT
