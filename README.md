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

### Triton（必需）

本服务默认开启 `torch.compile` 加速 DiT，而 `torch.compile` 依赖 Triton。**如果 Triton 缺失，服务启动或直接生图时会报错**（Windows 常见错误：`torch._inductor.exc.TritonMissing`）。

- **Linux**：通常 PyTorch 已经自带 `triton`，无需额外操作。如缺失可执行：
  ```bash
  uv pip install triton
  ```

- **Windows**：PyTorch 官方未在 Windows 分发 Triton，必须手动安装社区维护的 `triton-windows`，并确保已安装 [Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe)。

  | PyTorch | 推荐 Triton 版本 | 安装命令 |
  |---|---|---|
  | 2.10 及以上 | 3.6 | `uv pip install "triton-windows<3.7"` |
  | 2.9 | 3.5 | `uv pip install "triton-windows<3.6"` |
  | 2.8 | 3.4 | `uv pip install "triton-windows<3.5"` |
  | 2.7 | 3.3 | `uv pip install "triton-windows<3.4"` |
  | 2.6 | 3.2 | `uv pip install "triton-windows<3.3"` |

- **不想/不能安装 Triton？**  
  在 `config.yaml` 中将 `compile_models` 设为 `false`，或设置环境变量 `ANIMA_COMPILE_MODELS=false` 即可跳过编译，但会损失显著的性能提升。

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


## 法典数据准备（可选，用于 `lookup_codex` 等 MCP 查询工具）

服务内置了 3 个**只读**查询 MCP 工具，帮 AI 在一份庞大的 NovelAI tag 法典中快速
定位「条目名 + tag 组合」，无需 GPU。详见 `AnimaImagineSkill/SKILL.md` §9.4。

- `list_codex_sections` — 列粗章节（含每章条目数）
- `list_codex_entries`  — 列某章节下的条目菜单（仅标题，省 token）
- `lookup_codex`        — 按关键字 / 章节检索，返回「条目名 + tag 块」

### 为什么默认没有法典数据？

本仓库默认附带的法典文件**来自第三方作者（一般所长）整理的 NovelAI 个人法典**，
属于版权物，**未经作者授权不随代码仓库分发**。仓库的 `.gitignore` 已将所有
`法典-*.md` / `法典-*.json` / `*.docx` / `media_*/` 排除在提交之外。

没有法典数据时，MCP 服务仍可正常生图，只是 `lookup_codex` 等查询工具加载 0 条，
启动日志会打印 `[WARN] 未加载任何法典条目！`。

### 我应该怎么获得法典数据？

途径：
    **自行准备**：联系法典作者取得 docx 源文件，按下面的「数据格式」章节自行构建。

### 数据格式

服务启动时会在以下候选路径按顺序寻找**第一个同时包含**下列清单的目录：

```
AnimaImagineSkill/references/
├── 法典-常规.md              # 必需。若找不到此文件，整套 codex 工具不启用
├── 法典-R18.md               # 可选。R18 法典，缺失时 scope="r18" 返回空
├── 法典-常规-目录.json        # 粗章节索引（由 build_index.py 生成）
├── 法典-常规-细目录.json      # 条目级索引（同上）
├── 法典-R18-目录.json         # R18 粗目录（若有 R18 法典 md 则需要）
└── 法典-R18-细目录.json       # R18 细目录
```

候选路径（按优先级）：

1. 环境变量 `ANIMA_CODEX_DIR` 指向的绝对目录（推荐用于部署场景）
2. `{cwd}/AnimaImagineSkill/references/`
3. `{cwd}/references/`
4. 包安装目录同级的 `AnimaImagineSkill/references/`

找不到就静默跳过（生图功能不受影响）。

### 自己从 docx 构建数据

准备好两份 docx 后：

```powershell
# 需要先装 pandoc：https://pandoc.org/installing.html
cd AnimaImagineSkill\references

# 1) docx -> md
pandoc "所长常规NovalAI个人法典（X.X.XX版，一般所长整理）.docx" `
  -t gfm --wrap=none --extract-media=./media_normal -o "法典-常规.md"
pandoc "所长色色NovalAI个人法典（X.X.XX版，一般所长整理）.docx" `
  -t gfm --wrap=none --extract-media=./media_r18 -o "法典-R18.md"

# 2) 生成粗 / 细目录
python build_index.py
```

脚本的工作原理（便于二次定制）：

- **粗目录** 扫描 pandoc 转出的 `<span id="_Toc..." class="anchor">` 锚点行，
  这些锚点来自 docx 的 Heading 样式；每章附带 `end_line = 下一章 line - 1`。
- **细目录** 在每个粗章节范围内启发式抓取「条目小标题行」：一行 ≤ 40 字，
  至少含一个中文字符，不以 markdown 控制符开头，且下一行为空、再下一行像 tag 块
  （含逗号 / `::` / `1girl` 等线索）。匹配到就记录行号 + 标题 + 所属章节。

如果你的数据不是「所长法典」而是自定义内容，只要维持同样的 md 骨架（章节锚点 +
`小标题 / 空行 / tag 行` 模式），用这套脚本就能直接出索引。

---

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

security:
  enabled: false               # 远程公网部署时建议设为 true
  auth_token: ""               # Bearer Token（建议随机强密码）
  fail2ban_enabled: false      # 失败过多自动封禁 IP
  fail2ban_max_attempts: 5
  fail2ban_window_seconds: 300 # 统计窗口 5 分钟
  fail2ban_ban_seconds: 3600   # 封禁 1 小时

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
| `ANIMA_SECURITY_ENABLED` | `security.enabled` | `false` |
| `ANIMA_AUTH_TOKEN` | `security.auth_token` | `（空）` |
| `ANIMA_FAIL2BAN_ENABLED` | `security.fail2ban_enabled` | `false` |
| `ANIMA_FAIL2BAN_MAX_ATTEMPTS` | `security.fail2ban_max_attempts` | `5` |
| `ANIMA_FAIL2BAN_WINDOW_SECONDS` | `security.fail2ban_window_seconds` | `300` |
| `ANIMA_FAIL2BAN_BAN_SECONDS` | `security.fail2ban_ban_seconds` | `3600` |
| `ANIMA_T5XXL_TOKENIZER` | `tokenizer.t5xxl_path` | （空，自动下载） |
| `ANIMA_OUTPUT_DIR` | `output.dir` | `./output` |
| `ANIMA_CODEX_DIR` | （无） | （空，按候选路径自动寻址） |

### 远程部署安全建议

若服务需要暴露在公网或团队内网之外，**强烈建议开启鉴权**（默认关闭）：

1. 在 `config.yaml` 中设置 `security.enabled: true`，并设置 `auth_token`（一个随机强密码）。
2. 建议同时开启 `fail2ban_enabled: true`，防止密码被暴力穷举。
3. **开启后的认证分流**：
   - **MCP 端点**（`/mcp/*`）→ 在客户端配置中指定 Bearer Token，每次请求自动在 `Authorization` 头中携带。
   - **网页端**（`/`、`/api/*`、`/health`）→ 首次访问会被 302 到 `/login`，输入密码后获得 30 天有效期的 Cookie，后续自动认证。
   - **登录页**（`/login`、`/api/login`）→ 白名单放行，无需认证。

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

AI 客户端通过 **Streamable HTTP MCP** 连接本服务。支持 Cursor、Claude Desktop、Cherry Studio、LimCode 等所有支持 Streamable HTTP 的 MCP 客户端。

### 1. MCP 配置示例

将以下内容写入客户端的 MCP 配置文件（各客户端配置位置见下方「客户端配置位置」）：

```json
{
  "mcpServers": {
    "anima-imagine": {
      "type": "streamable-http",
      "url": "http://localhost:8008/mcp/",
      "headers": {}
    }
  }
}
```

如果开启了安全认证（`security.enabled: true`），必须在 `headers` 中加入 Bearer Token：

```json
{
  "mcpServers": {
    "anima-imagine": {
      "type": "streamable-http",
      "url": "http://localhost:8008/mcp/",
      "headers": {
        "Authorization": "Bearer your_secret_token_here"
      }
    }
  }
}
```

> **注意**：`url` 末尾的 `/` 是必需的（`http://localhost:8008/mcp/` 而不是 `/mcp`）。

### 2. 各客户端配置位置

| 客户端 | MCP 配置文件路径 |
|---|---|
| **Cursor** | `~/.cursor/mcp.json`（macOS/Linux）或 `%USERPROFILE%\.cursor\mcp.json`（Windows） |
| **Claude Desktop** | `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）或 `%APPDATA%\Claude\claude_desktop_config.json`（Windows） |
| **Cherry Studio** | 设置 → MCP → 添加 → 选择「Streamable HTTP」类型，填入 URL 和 Headers |
| **LimCode** | 将 `mcp-config.json` 放在工作区根目录，LimCode 启动时自动加载 |

### 3. nginx 反向代理场景

如果通过 nginx 反向代理暴露到外网，配置示例：

```nginx
server {
    listen 443 ssl;
    server_name anima.example.com;

    location / {
        proxy_pass http://127.0.0.1:8008;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

> nginx 必须透传 `X-Forwarded-For`，否则 fail2ban 和真实 IP 获取会失效。

### 4. 加载 Skill

将本仓库根目录的 `SKILL.md` 添加为 AI 客户端的 Skill / System Prompt，AI 就会学会 Anima 的标签规范和提示词写法。

### 5. 开始使用

对 AI 说「画一个穿白裙的少女在花园里，竖屏 9:16」即可。

### 6. MCP 工具清单

| 工具 | 用途 | 需要 GPU |
|---|---|---|
| `generate_anima_image` | 结构化字段生图（推荐调用方式） | ✅ |
| `reroll_anima_image` | 基于历史图片参数重新生成 | ✅ |
| `list_codex_sections` | 列法典粗章节（带每章条目数） | ❌ |
| `list_codex_entries` | 列某章节下条目菜单（只有标题） | ❌ |
| `lookup_codex` | 按关键词 / 章节检索条目，返回「标题 + tag 块」 | ❌ |

后三个 codex 查询工具**仅在 `AnimaImagineSkill/references/` 下有法典数据时生效**，
见上文「法典数据准备」一节。没有数据时只会返回空数组，不会影响生图。

---

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
│       ├── prompt-examples.md
│       ├── build_index.py    # 法典目录构建脚本
│       ├── 法典-*.md         # 法典正文（版权物，不提交，见「法典数据准备」）
│       └── 法典-*-目录.json  # 目录 / 细目录（版权物，不提交）
└── output/                   # 生成的图片（按日期分目录）
```

---

## 性能优化

服务内置了多项与 ComfyUI 对齐的加速优化，无需引入 ComfyUI 依赖：

- **`torch.compile`**：服务启动时自动编译 DiT，首次生图有 5~10s 预热，之后每张图显著加速。
  **Triton 安装方法见上文「环境要求 › Triton（必需）」。**
- **SageAttention**：自动检测并启用。RTX 5090/Blackwell 等 Windows 用户需手动安装对应版本：
  ```powershell
  # 示例：Windows + PyTorch 2.9+ cu130 (Blackwell)
  uv pip install "triton-windows<3.7"
  uv pip install https://github.com/woct0rdho/SageAttention/releases/download/v2.2.0-windows.post4/sageattention-2.2.0+cu130torch2.9.0andhigher.post4-cp39-abi3-win_amd64.whl
  ```
  > 其他 CUDA / PyTorch 组合请去 [SageAttention Releases](https://github.com/woct0rdho/SageAttention/releases) 页面查找对应的 `.whl`。
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

[AGPL-3.0-or-later](./LICENSE)

本项目采用 GNU Affero General Public License v3（或更新版本）。要点：

- 你可以自由地使用、修改、分发本项目代码。
- 修改后的版本必须同样以 AGPL 开源。
- **AGPL 的关键条款（§13）**：如果你将本服务（或其衍生版本）作为网络服务对外提供
  （包括 MCP endpoint、Web 面板等任何远程访问方式），必须向所有远程用户提供对应
  的源码获取途径。

简单地说：自己玩怎么改都行；公开提供服务就必须公开源码。
