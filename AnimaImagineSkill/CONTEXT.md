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
