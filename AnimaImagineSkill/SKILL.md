---
name: AnimaImagineSkill
description: "Anima 二次元出图专用提示词工程手册。启用此 Skill 以学习如何调用 generate_anima_image 工具生成高质量插画。"
---

# AnimaImagineSkill 术语表

为 Anima 出图流程提供统一术语，确保 AI 工程师在 Grill、分镜控制、tag 查阅等环节表述一致。

## 通用术语

**tag**:
Danbooru 标签，以逗号分隔的组合，直接作为 `generate_anima_image` 字段值传入。
_Avoid_: 标签、关键词、描述词

**prompt**:
服务端将各结构化字段按固定顺序拼接而成的完整提示词字符串。AI 工程师不需自行拼接。
_Avoid_: 提示词、输入文本、生成指令

**seed**:
随机种子，决定生成结果的唯一性。传入 `-1` 表示每次随机。
_Avoid_: 随机数、噪声

**roll**:
用不同 seed 重新调用 `generate_anima_image`，在固定 prompt 框架下获得构图一致但细节不同的变体。
_Avoid_: 重抽、刷新

**reroll**:
`reroll_anima_image` 工具的行为，基于已生成图片的参数重新生成并可选覆盖部分参数。

**字段**:
`generate_anima_image` 的结构化输入项，如 `outfit`、`pose_expression`、`composition`。

## 构图与控制

**分镜**:
用 `2koma`、`split screen` 等标签在单张图中分割多个独立画面。与 "多视图"（`multiple views`）不同，分镜有明确格子边界。
_Avoid_: 多格、拆分画面

**前缀**:
在多主体场景中，将角色名或格子方位前置到 tag 组合前，以将 tag 绑定到特定主体。前缀来自 `character` 字段（多角色）或 `composition` 字段（多格）。
_Avoid_: 标注、标识、归属标记

**共用字段**:
不加前缀的字段值，表示所有主体均适用该描述。

## 出图流程

**Grill**:
出图前逐个维度盘问用户直至达成共识的对话流程。提问顺序按需求灵活调整，不固定维度。
_Avoid_: 审阅、确认、需求沟通

**方案审阅**:
Grill 完成后用中文简要汇总全部方案，用户最终确认后再调用 MCP 工具。

**法典**:
`references/` 目录下的两本提示词参考文档（常规 / R18），由所长整理，包含大量条目化 tag 组合。
_Avoid_: 资料库、素材库

**lookup_codex**:
MCP 工具，在法典中按关键词或章节检索条目，返回条目名及 tag 块。

**安全等级**:
`quality_meta_year_safe` 字段中的安全标签，取值为 `safe`、`sensitive`、`nsfw`、`explicit`。

## Relationships

- **Grill** 完成后进入 **方案审阅**，审阅通过后调用 `generate_anima_image`
- **前缀** 依赖 `character` 或 `composition` 字段提供维度名称
- **tag** 是各字段的最小组成单元，**prompt** 是服务端将所有字段拼接后的最终产物
- **roll** 与 **reroll** 的区别：roll 是全新调用，reroll 基于已有图片参数覆盖

## Example dialogue

> **AI 工程师:** 「左格和右格的 outfit 需要不同前缀吗？」
> **SOP:** 「是。在 `outfit` 字段中，`left panel:` 和 `right panel:` 分别绑定到对应格子。」
> **AI 工程师:** 「共用的 appearance 不加前缀？」
> **SOP:** 「对。`appearance` 不加前缀，两格共用。这是共用字段。」

## Flagged ambiguities

- "roll" 曾被用于指 "reroll" — 已区分：roll 为全新 seed 调用，reroll 为基于已有图片的重新生成。


# AnimaImagineSkill — 提示词工程师指南

## 出图 SOP（三层）

### 第一层 — Grill 询问

在 Grill 询问的过程中并行，若任务涉及较陌生的题材（特定服装、特定姿势、特定表情），先通过 MCP 工具 `lookup_codex` 搜索 tags 获取灵感，再将所得 tag 素材作为 Grill 询问的建议依据。简单需求可直接 Grill。

###

出图前，逐步盘问直至共识。逐个确定角色/画师、构图、服装、表情动作、环境、安全等级。每问给出建议，确认后再进入下一问。一次只问一件事。

### 第二层 — 方案审阅

所有 grill 问题确认完毕，用中文简要汇总完整方案，用户最后审阅一次。

### 第三层 — MCP 调用

审阅通过后调用 `generate_anima_image`。

## 核心规则

1. 调用 `generate_anima_image` 时使用结构化字段，服务端自动拼接 prompt。
2. 画师标签以 `@` 开头。
3. 安全标签明确：`safe` / `sensitive` / `nsfw` / `explicit`，负面词里加入相反约束。
4. 非二次元风格：prompt 第一个标签写 dataset tag（`ye-pop` 或 `deviantart`）。
5. 不写可用主词推导出的常识性废话。
6. 除非用户要求，默认不追求写实。
7. 括号禁止转义 `\(` `\)`，直接写：`(` 和 `)`（如 `@yd (orange maru)`、`dawn (pokemon)`），禁止下划线，下划线用空格代替。

## 多格漫画控制

2koma 等分格图用 `composition` 字段指定布局，`outfit` / `pose_expression` / `environment` 三字段分别用 `left panel:` / `right panel:` 前缀锁每格内容。

## 提示词技巧

- 自然语言只在 tag 无法表达时使用（人物关系、动作细节等）。
- 保证主体占画面比例足够大。
- 用年份控制画风：`year 2025` / `newest` / `recent` / `mid` / `old`。
- 角色外貌要说清：发色发型、眼睛、服装、表情、姿态、镜头、光照、背景。
- 多人时逐个描述，避免只堆角色名。

## 参考文件

- `references/REFERENCE.md` — 法典速查、MCP参数说明、画师规范、分辨率策略、肢体崩坏防护
- `references/prompt-examples.md` — 提示词示例
- `references/artist-list.md` — 画师列表
- `references/法典-常规.md` / `references/法典-R18.md` — 两本法典正文
- `references/法典-常规-目录.md` / `references/法典-R18-目录.md` — 粗目录（章节级）
- `references/法典-常规-细目录.md` / `references/法典-R18-细目录.md` — 细目录（条目级）
- `references/法典-常规-目录.json` / `references/法典-R18-目录.json` — 机器可读目录
- `references/法典-常规-细目录.json` / `references/法典-R18-细目录.json` — 机器可读细目录

## 法典速查

**首选 MCP 工具 `lookup_codex`**（详见 REFERENCE.md）。回退方案：搜细目录 → 读正文行号。

严禁一次性整卷读入法典。

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

## 8. 控制字段

当画面中存在多个可区分的主体（多个角色、多个分格、同一角色的多个状态），在需要描述差异的字段中，用该主体在对应维度中的名称作为前缀，将描述绑定到该主体。前缀来自 character 字段（多角色时）或 composition 字段（多格时）。不加前缀的描述视为所有主体共用。

**示例一：多角色控制**

```
character: "hikigaya hachiman, yukinoshita yukino"

appearance: "
  hikigaya hachiman: short messy black hair, tired dark eyes, lean build;
  yukinoshita yukino: long straight black hair, sharp blue eyes, tall slender
"

outfit: "
  hikigaya hachiman: black turtleneck, gray blazer, black pants;
  yukinoshita yukino: white silk blouse, black wide-leg pants, long coat
"

pose_expression: "
  hikigaya hachiman: standing slightly behind, hands in pockets, deadpan;
  yukinoshita yukino: standing centre forward, arms crossed, calm
"
```

前缀来自 `character` 字段中的角色名。无前缀的顶层字段（如 `environment`）两人共用。

---

**示例二：2koma 分镜控制**

```
composition: "2koma, split screen, side by side"

outfit: "
  left panel: school uniform, blazer buttoned, tie neat;
  right panel: same uniform, blazer open, tie loose, shirt half unbuttoned
"

pose_expression: "
  left panel: sitting at desk, writing, calm;
  right panel: leaning over desk, reaching toward viewer, tongue out
"

environment: "
  left panel: classroom, afternoon light;
  right panel: bedroom, dim lamp light
"
```

前缀来自 `composition` 字段中的格子方位。`appearance`、`character` 无前缀，两格共用。

---

**示例三：多角色 + 分镜混合**

```
count: "2girls"
character: "kaname madoka, kinomoto sakura"
composition: "2koma, split screen, side by side"

appearance: "
  kaname madoka: pink short twintails, pink eyes, petite;
  kinomoto sakura: short brown hair, green eyes, petite
"

outfit: "
  left panel kaname madoka: white cheongsam, high collar, modest;
  right panel kinomoto sakura: black cheongsam, off-shoulder, side slit
"

pose_expression: "
  left panel kaname madoka: sitting seiza, looking down, nervous blush;
  right panel kinomoto sakura: standing, hand on hip, beckoning viewer, confident smile
"
```

两层前缀叠加：先按分格方位区分，再按角色名区分。前缀链式拼接：`格子方位 + 角色名`。

---

附表：

常用的质量词组合：
  newest, masterpiece, best quality, good quality, score_9, score_8

常用的负面词组合：
  worst quality, low quality, score_1, score_2, score_3, score_4, blurry, jpeg artifacts, sepia, bad hands, bad anatomy, extra fingers, missing fingers, anatomical nonsense, bar censor, mosaic censoring, nipple rings, text, watermark, greyscale,
