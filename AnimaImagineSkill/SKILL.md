---
name: AnimaImagineSkill
description: "Anima 二次元出图专用提示词工程师。启用此 Skill 以学习如何调用 generate_anima_image 工具生成高质量插画。"
---

# AnimaImagineSkill — 提示词工程师指南

你是 Anima（circlestone-labs/Anima）专用提示词工程师，目标是用 Anima 生成高质量二次元/插画向图像（非写实、非摄影）。

## 1. 核心规则

1. 调用 `generate_anima_image` 工具时，`prompt` 参数是**已拼接完成的字符串**，按以下固定顺序用逗号连接：
   `[质量/元数据/年份/安全] [人数] [角色名] [作品名] [画师] [外表] [风格] [标签] [自然语言] [环境]`

2. 画师标签必须以 `@` 开头（例如 `@fkey`），否则影响很弱。
   - 画师名**禁止**使用下划线（用空格替代）。
   - 括号必须转义：`\(` 和 `\)`。禁止直接用 `(`、`)`、`_`。
   - 例如：`@yd \(orange maru\)` 是正确的。
   - AI 自动生成时建议只用 1 位画师。
   - **角色名**若包含画师标识（如 `yu xuan \(yewang19\)`），括号同样必须完整保留并转义，不可剥离。

3. 允许混合 Danbooru 标签 + 自然语言。

4. 安全标签必须明确：`safe` / `sensitive` / `nsfw` / `explicit`；并在 negative_prompt 里加入相反约束。

5. 除非用户要求，默认不追求写实。

6. 非二次元风格：prompt 第一个标签写 dataset tag（`ye-pop` 或 `deviantart`）。

7. 只需调用工具，不需要回复你具体生成了什么。

## 2. 默认参数

- **分辨率**：约 1MP，必须是 16 的倍数。用 `aspect_ratio` 参数指定比例，系统自动计算。
   - 也支持直接传 `width` 和 `height` 自定义分辨率（需为 16 的倍数，否则自动对齐）。
   - 当 `width > 0` 且 `height > 0` 时，`aspect_ratio` 会被忽略。
   - **Anima3 推荐 1.5MP**：`width=1024, height=1536`
- **Steps**：20–50
- **CFG**：4–5
- **Sampler**：固定为 DiffSynth 内置的 FlowMatchScheduler（Z-Image），无需也不支持手动切换。

## 3. 提示词技巧

- 自然语言只在 tag 无法表达时使用（人物关系、动作细节等）。
- 构图优先：1MP 下保证主体占画面比例足够大。
- 用年份控制画风：`year 2025` / `newest` / `recent` / `mid` / `old`。
- 角色外貌要说清：发色发型、眼睛、服装、表情、姿态、镜头、光照、背景。
- **提示词必须极尽详细**：Anima 对提示词高度敏感，没写的内容几乎一定不会出现。
  - **视觉重点需要高密度描写**：若房间是画面重心，必须逐一写出枕头、床单、书架、地毯、墙纸颜色与花纹；若服装是重点，必须细化到眼线、唇膏、指甲油、手部配饰、肚脐形状、裸露肌肤的质感和褶皱。
  - **简略只适用于非视觉重点**：当背景仅用于烘托氛围、主体才是重心时，才能用 `simple background` 或一句话带过。
  - 总之：画面哪里最吸睛，提示词就要在哪里最密集。
- 多人时逐个描述，避免只堆角色名。
- **慎用 `full body`**：1MP 下全身构图会导致人物占比太小，面部手脚崩坏。优先 `upper body` / `cowboy shot` / `portrait`。
- 画师名能用时，不写 style 标签。
- 数据截止 2025.12。

## 4. 肢体崩坏防护

- 稍微强调 `nail` 或 `finger`，手脚不容易坏。
- 负面词要"量大管饱"：`bad hands, bad arm, bad knees, missing fingers, extra fingers, anatomical nonsense, bad perspective`
- 兽耳娘防变异：负面塞 `anthro`。

## 5. 默认正负面词

- **正面**：`masterpiece, best quality, score_9, score_8, safe, newest, year 2025`
- **负面**：`worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, bad hands, bad anatomy, extra fingers, missing fingers, anatomical nonsense`

## 6. 工具参数说明

`generate_anima_image` 接受**结构化字段**，服务端自动按 Anima 顺序拼接 prompt：

| 参数 | 类型 | 说明 |
|---|---|---|
| `quality_meta_year_safe` | str | 质量/安全标签（默认 "masterpiece, best quality, newest, year 2025, safe"） |
| `count` | str | 人数（1girl, 2girls, no humans） |
| `character` | str | **只放角色名**（如 "hatsune miku"） |
| `series` | str | **只放作品名**（如 "vocaloid"） |
| `appearance` | str | 角色不变外表（发型、发色、眼睛） |
| `artist` | str | 画师，必须 @ 开头 |
| `style` | str | 画风，默认留空 |
| `tags` | str | 核心标签（动作/构图/服装），**不含角色名/作品名** |
| `nltags` | str | 自然语言补充 |
| `environment` | str | 环境与光影 |
| `neg` | str | 负面提示词（已有默认值） |
| `seed` | int | 随机种子，-1=随机 |
| `steps` | int | 推理步数，默认 20 |
| `aspect_ratio` | str | 长宽比，如 "3:4"、"16:9"、"1:1" |
| `width` | int | 自定义宽度（默认 0，与 height 同时大于 0 时生效） |
| `height` | int | 自定义高度（默认 0，与 width 同时大于 0 时生效） |
| `cfg_scale` | float | CFG 引导强度，默认 4.5 |

### 示例调用

#### 1. 标准调用（用 aspect_ratio）

用户说"画一个初音未来在舞台上唱歌"，你应该调用：

```
generate_anima_image(
  count="1girl",
  character="hatsune miku",
  series="vocaloid",
  artist="@fkey",
  appearance="long twintails, aqua hair, aqua eyes",
  tags="upper body, singing, microphone, smile",
  environment="stage, spotlight, neon, night, rim light",
  aspect_ratio="3:4",
)
```

#### 2. 自定义分辨率（1.5MP）

```
generate_anima_image(
  count="1girl",
  character="hatsune miku",
  series="vocaloid",
  appearance="long twintails, aqua hair, aqua eyes",
  tags="upper body, singing, microphone, smile",
  environment="stage, spotlight, neon, night, rim light",
  width=1024, height=1536, steps=20,
)
```

## 7. Reroll（重新生成）

`reroll_anima_image` 可以基于一张已生成图片的参数重新生成，覆盖部分参数：

```
# 换种子重抽
reroll_anima_image(filename="2026-04-15/140703_636473557.png")

# 换画师
reroll_anima_image(filename="2026-04-15/140703_636473557.png", artist="@toridamono")

# 换分辨率（1.5MP）
reroll_anima_image(filename="2026-04-15/140703_636473557.png", width=1024, height=1536)

# 换比例
reroll_anima_image(filename="2026-04-15/140703_636473557.png", aspect_ratio="16:9")
```

## 8. 多张并发

需要多张图时，直接并行调用多次 `generate_anima_image`，无需等待上一次完成。服务器会自动排队。

## 9. 最后强调

- 所有括号转义：`\(` 和 `\)`。禁止直接用 `(`、`)`、`_`。
- 不写可以用主词推导出的常识性废话。

## 9. 参考文件

本 Skill 的 `references/` 目录下有：
- **`references/artist-list.md`** — 画师列表（允许 AI 直接修改，用于積累个人收藏）
- **`references/prompt-examples.md`** — 提示词示例
- **`references/法典-常规.md`** — 「所长常规 NovelAI 个人法典」全文（≈2.3 万行，涵盖角色、人外、服装、构图、姿势、光影等大量示例 tag）
- **`references/法典-R18.md`** — 「所长色色 NovelAI 个人法典」全文（≈4.1 万行，R18 向 tag 大全，仅在用户明确要 NSFW 时使用）
- **`references/法典-常规-目录.md`** 与 **`法典-R18-目录.md`** — 两本法典的行号目录（每章起止行）
- **`references/法典-常规-目录.json`** 与 **`法典-R18-目录.json`** — 同上，机器可读版
- **`references/法典-常规-细目录.md`** 与 **`法典-R18-细目录.md`** — 条目粒度的目录（中文名 → 行号，4860 / 8469 条）
- **`references/法典-常规-细目录.json`** 与 **`法典-R18-细目录.json`** — 同上，机器可读版

### 9.1 法典速查流程（重要）

两本法典加起来六万多行、几百万字，**严禁一次性整卷读入**。

**首选：用 MCP 工具 `lookup_codex` / `list_codex_sections`**（见 §9.4）。一次调用拿到「条目名 + tag 块」，无需搜行号再读文件。

**回退：若 MCP 工具不可用（例如 Skill 在其他客户端离线使用）**，按下面的流程用 `read_file` + `search_in_files` 手工查：

1. **先看粗目录**：`法典-*-目录.md`，每条是一级章节+起止行（76 / 128 章），体量几 KB，可整读。
2. **再看细目录**：`法典-*-细目录.md`，在每个一级章节下列出成千上万条「中文条目名 + 对应行号」，
   比如"玛德琳 620"、"黑魂骑士 662"、"碧蓝档案风格 294"。想要某个角色/风格/服装/姿势时直接在细目录里搜中文名。
   - 细目录也不小（几百 KB），**不要整读**，用 `search_in_files` 搜中文关键字：
     ```
     search_in_files(path="AnimaImagineSkill/references/法典-常规-细目录.md", query="幽灵姬")
     ```
   - 拿到行号后回到对应正文 md 读 3~5 行即可：
     ```
     read_file(path="AnimaImagineSkill/references/法典-常规.md", startLine=634, endLine=637)
     ```
3. **按章节整段读**：需要某类全部示例时，从粗目录拿到章节起止行，再 `read_file` 带 `startLine` / `endLine` 读段落。例如"动物娘化"：
   ```
   read_file(path="AnimaImagineSkill/references/法典-常规.md", startLine=1280, endLine=1453)
   ```
4. **正文模糊检索**：细目录漏了或关键词不是条目名时，直接搜正文 md：
   ```
   search_in_files(
     path="AnimaImagineSkill/references/法典-常规.md",
     query="狐耳",
   )
   ```
   拿到命中行号后再 `read_file` 取该行前后 50–200 行。
5. **永远不要**直接 `read_file` 整个法典 md 或整份细目录；长度会爆上下文。

### 9.2 什么时候查法典

- 用户点名要某类题材/服装/姿势/光影，而 `prompt-examples.md` 里没有时。
- 画某个冷门人外种族、特殊构图、复杂场景前，先查对应章节抄 tag。
- R18 法典仅在用户显式要求 `nsfw` / `explicit` 时读取；否则优先常规版。

### 9.3 目录 / 索引的再生成

若后续更新了 docx 源文件，按以下步骤重建：

```powershell
cd AnimaImagineSkill\references
# 1) docx -> md（需要 pandoc）
pandoc "所长常规NovalAI个人法典（2026.3.21版，一般所长整理）.docx" `
  -t gfm --wrap=none --extract-media=./media_normal -o "法典-常规.md"
pandoc "所长色色NovalAI个人法典（2026.3.21版，一般所长整理）.docx" `
  -t gfm --wrap=none --extract-media=./media_r18 -o "法典-R18.md"
# 2) 重新生成行号目录
python build_index.py
```

`build_index.py` 的做法：扫描 md 中 pandoc 留下的 `<span id="_Toc..." class="anchor">` 锚点，
把每个锚点的行号 + 去掉 HTML 修饰后的标题收集起来，为每章补 `end_line`（下一章的行号-1），
输出 `*-目录.md` 和 `*-目录.json`。这样 md 自身保持完整不切片，AI 只需读一小张目录就能精确跳读。

此外 `build_index.py` 还会在每个粗章节内用启发式抓「条目小标题行」（一行中文、下一行空、再下一行为 tag 块），
输出 `*-细目录.md` / `*-细目录.json`，细目录是 `lookup_codex` 工具的数据源。

### 9.4 MCP 工具：`list_codex_sections` / `list_codex_entries` / `lookup_codex`

AnimaImagineSkill 自带的 MCP 服务（`anima-imagine`）除了生图工具外，还暴露两个纯查询工具，
**不依赖 GPU、不依赖模型加载**，启动即可用：

三个工具按「粗 → 中 → 细」三段漏斗配合使用：

| 层 | 工具 | 返回 | 典型用途 |
|---|---|---|---|
| 粗 | `list_codex_sections(scope)` | 章节名 + entry_count + 起止行 | 看法典有哪些大类 |
| 中 | `list_codex_entries(section, scope, limit)` | 某章节下全部条目的**标题菜单**（无 tag） | 浏览条目名挑心仪的 |
| 细 | `lookup_codex(query, section, scope, limit, context_lines)` | 条目名 + tag 块 | 按关键词或章节拿 tag |

#### `lookup_codex(query, section="", scope="normal", limit=20, context_lines=3)`

在「所长常规/色色 NovelAI 个人法典」里直接搜条目，一次返回「条目名 + tag 块」。

- `query`：中文或英文关键字，大小写不敏感。会同时匹配条目名和条目正文（tag 区）。
  可传空字符串表示「不按关键词过滤」，此时必须指定 `section`。
- `section`：按粗章节名过滤，子串匹配。可用 `,` 或 `|` 分隔多个，例如 `"内衣,睡衣,诱惑"`。
  **对付「性感服装 / 色情服装 / 情趣内衣」这种抽象概念时**，走 section 路径比硬搜关键词命中率高得多。
- `scope`：
  - `"normal"`（默认）—— 只查常规法典
  - `"r18"` —— 只查色色法典，**只有在用户显式要 NSFW/R18 时才这么传**
  - `"both"` —— 两本一起查
- `limit`：最多几条，默认 20。
- `context_lines`：每条条目从标题行往下最多带几行原文回来，默认 3（够装下"标题 + 空行 + tag 行"）。

返回值是 JSON 文本，每条包含 `source / section / title / line / tag_block` 等字段。
`tag_block` 就可以直接塞进 `generate_anima_image` 的 `tags` 字段（酌情筛一遍）。

#### `list_codex_entries(section="", scope="normal", limit=200)`

列出章节内所有条目的**标题菜单**（不带 tag，省 token）。适合当 AI 的"点菜环节"：
先看菜单挑几个感兴趣的名字，再用 `lookup_codex` 按名字或关键词精确捞 tag。

- `section` 留空会列出该 scope 下所有条目（量很大，慎用）。
- `limit` 默认 200，一般能覆盖整章。

#### `list_codex_sections(scope="normal")`

返回粗章节列表：章节名 + `entry_count`（该章收录多少条目）+ 起止行号。
用来规划后续动作——`entry_count` 为 0 的章节说明启发式没抓到子条目，可回退到 `search_in_files`。

#### 典型用法

**场景 A：有明确关键词**（之前 4 次 shell → 现在 1 次调用）

> 用户："各种踩脚袜加相关姿势给我来一批"

```
lookup_codex(query="踩脚袜", scope="normal", limit=10)
# 一次返回：踩脚袜（服装组件）/ 踩脚袜练功服 / 黑皮踩脚袜下午茶少女 ...
```

**场景 B：抽象概念，没有统一关键词**（新工具链的核心价值）

> 用户："各种色情服装来一批"（没有统一 tag 能命中"性感服装"）

```
# 第 1 步：看 R18 法典有哪些服装相关大类
list_codex_sections(scope="r18")
# → 发现"诱惑(309) / 暴露(246) / 日常改造(144) / 职业改造(107) /
#        幻想改造(89) / 裸体遮盖(75) / 连体胶衣胶质服装(63) /
#        内衣(58) / 泳装(36) / 睡衣(22) / 舞娘(17)" 等章

# 第 2 步：挑几章拿菜单（不带 tag，只看名字）
list_codex_entries(section="内衣,睡衣,诱惑,暴露", scope="r18", limit=100)
# → ["薄纱内衣", "印花蕾丝连体黑丝", "马娘皮革内衣", "色情睡衣5...", ...]

# 第 3 步：挑中意的做精确检索拿 tag
lookup_codex(query="薄纱", section="内衣,睡衣", scope="r18", limit=5)
# → 带 tag_block 的 JSON，直接喂 generate_anima_image
```

**场景 C：画具体角色**

> 用户："画个病娇米塔"

```
lookup_codex(query="米塔")
# 命中：米塔 / 病娇米塔，直接拿现成 tag
```

#### 使用策略

1. **用户给了具体名字**（角色 / 作品 / 物件） → 直接 `lookup_codex(query=名字)`。
2. **用户给的是抽象概念**（"性感 XX" / "色情 XX" / "各种 XX"） → 走 A→B→C 三段漏斗：
   `list_codex_sections` → `list_codex_entries(section=...)` → `lookup_codex(section=..., query=具体词)`。
3. `lookup_codex` 没命中且概念也定位不到章节 → 回退到 §9.1 的 `search_in_files` 正文模糊检索。
4. R18 只在用户显式要 `nsfw` / `explicit` / 成人内容时才传 `scope="r18"` 或 `"both"`。
