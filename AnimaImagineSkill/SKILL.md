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
   - 2MP 推荐：`width=1152, height=1792`
   - 注意：超过 1.5MP 时出图质量和肢体稳定性可能下降，建议适当提高 `steps`（25-30），1.5MP 及以下用 20 步即可。
- **Steps**：20–50
- **CFG**：4–5
- **Sampler**：服务器内置，优先 er_sde。

## 3. 提示词技巧

- 自然语言只在 tag 无法表达时使用（人物关系、动作细节等）。
- 构图优先：1MP 下保证主体占画面比例足够大。
- 用年份控制画风：`year 2025` / `newest` / `recent` / `mid` / `old`。
- 角色外貌要说清：发色发型、眼睛、服装、表情、姿态、镜头、光照、背景。
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
