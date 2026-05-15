# REFERENCE — AnimaImagineSkill 参考手册

## 1. 法典速查流程

### MCP 工具（首选）

三段漏斗：

| 层 | 工具 | 返回 | 用途 |
|---|---|---|---|
| 粗 | `list_codex_sections(scope)` | 章节名 + entry_count + 起止行 | 看法典有哪些大类 |
| 中 | `list_codex_entries(section, scope, limit)` | 某章下所有条目标题菜单（无 tag） | 浏览条目名挑心仪的 |
| 细 | `lookup_codex(query, section, scope, limit, context_lines)` | 条目名 + tag 块 | 按关键词或章节拿 tag |

- `scope`：`"normal"`（默认）、`"r18"`（仅 NSFW）、`"both"`
- `query`：**必须连续单词**，不能空格分隔多个关键词
- `section`：子串匹配，可用 `,` 或 `|` 分隔多个

### 回退方案（文件手工查）

1. 看粗目录（行号范围）
2. 搜细目录（`search_in_files` 搜中文条目名）
3. 按行号 `read_file` 读正文 3~5 行
4. 正文模糊检索（搜关键词 + 读前后 50~200 行）
5. 严禁整卷读入

## 2. MCP 工具参数说明

### generate_anima_image

| 参数 | 类型 | 说明 |
|---|---|---|
| `quality_meta_year_safe` | str | 质量/安全标签（默认 "masterpiece, best quality, newest, year 2025, safe"） |
| `count` | str | 人数（1girl, 2girls, 1boy, no humans） |
| `character` | str | 只放角色名（括号需转义） |
| `series` | str | 只放作品名 |
| `appearance` | str | 角色不变外表（发色、发型、眼睛、体型） |
| `outfit` | str | 服装（tags 格式） |
| `pose_expression` | str | 姿势/表情（tags 格式） |
| `composition` | str | 构图/视角（tags 格式） |
| `artist` | str | 画师，必须 @ 开头 |
| `style` | str | 画风，默认留空 |
| `environment` | str | 环境与光影 |
| `others` | str | 其他补充 tag |
| `nl_caption` | str | 自然语言描述 |
| `neg` | str | 负面提示词 |
| `seed` | int | 随机种子，-1=随机 |
| `steps` | int | 推理步数，默认 20 |
| `aspect_ratio` | str | 长宽比（如 "3:4"、"16:9"、"1:1"） |
| `width` | int | 自定义宽度（与 height 同时大于 0 时生效） |
| `height` | int | 自定义高度 |
| `cfg_scale` | float | CFG 引导强度，默认 4.5 |

### reroll_anima_image

基于已生成图片参数重新生成，可覆盖部分参数。

## 3. 画师标签规范

- 以 `@` 开头（如 `@fkey`）
- 括号必须直接写：`(` 和 `)`（如 `@yd (orange maru)`）
- 禁止下划线（直接用空格）
- 多画师可用逗号分隔（如 `@kawakami rokkaku, @shamonabe, @nyuu (manekin-eko)`），但稳定性会下降
- AI 自动生成时建议只用 1 位画师

## 4. 安全标签分级

| 等级 | 标签 | 负面约束 |
|---|---|---|
| sfw | `sfw, safe` | 负面加入 `explicit, nsfw` |
| 轻度 | `sensitive` | 负面加入 `explicit` |
| R18 | `nsfw` | 负面加入 `safe` |
| 完全 | `explicit` | 负面加入 `safe, censored, mosaic censoring` |

## 5. 分辨率策略

MCP 工具 generate_anima_image 的分辨率输入只有两种格式：

格式 1：预设比例字符串 aspect_ratio，传入 aspect_ratio 为 "W:H" 格式的字符串，按 1.0 MP 总像素自动计算。

格式 2：自定义像素 width + height，当 width > 0 且 height > 0 时，忽略 aspect_ratio，直接使用宽高值并自动对齐到 16 的倍数（Cosmos VAE 要求）。aspect_ratio 会被后端自动标记为 "custom"。

## 6. 肢体崩坏防护

**正面加强**：稍微强调 `nail` 或 `finger detail`，手脚不容易坏。

**负面词（量大管饱）**：
```
bad hands, bad arm, bad knees, missing fingers, extra fingers,
anatomical nonsense, bad perspective, bad anatomy
```

**兽耳娘防变异**：负面塞 `anthro`。

**默认负面词**：
```
worst quality, low quality, score_1, score_2, score_3,
blurry, jpeg artifacts, sepia, bad hands, bad anatomy,
extra fingers, missing fingers, anatomical nonsense
```

## 7. 自由发挥

Anima 在生成时有一定自由发挥空间。若提示词中仅给出宽泛的主题标签（例如 `fellatio`），而未锁定具体姿势、视角、构图等细节，则每次以不同 seed 出图时，模型会自行在标签范围内探索不同的构图、表情和光影方案。因此可以先固定核心主题标签，再用不同 seed 多次 roll，在同一个主题下获取不同视角和氛围的候选图。
