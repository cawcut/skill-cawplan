# 交互框逐字文案

仅在 `SKILL.md` 触发框 1～框 5 时读取本文件。触发条件、选择后的业务落点以 `SKILL.md` 为准；本文件只规定怎么说。

## 通用载体规则

- 跟随会话语言，整框只输出中文或英文，不同时输出。
- 优先使用 AskUserQuestion；每个选项都必须包含 `label` 和 `description`。
- Other / 自由输入行由工具自动追加，标题和占位不可自定义；不要手写该选项。
- AskUserQuestion 不可用时，使用对应纯文本 fallback，逐字输出。

## 框 1 · 锁定 Requirement

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 锁定 Requirement | Lock Requirement |
| `question` | 生成用例前，先确定是哪条 Requirement？ | Before generating test cases, let's confirm which Requirement this is |
| option 1 · `label` | 已有 Requirement 链接 | I have a Requirement link |
| option 1 · `description` | 把链接发我 | Send me the link |
| option 2 · `label` | 没有 Requirement | No Requirement yet |
| option 2 · `description` | 马上生成并保存到 CawPlan | Generate and save to CawPlan now |

Fallback：

```text
锁定 Requirement
生成用例前，先确定是哪条 Requirement？
1. 已有 Requirement 链接 —— 选这个，把 Requirement 链接发我
2. 没有 Requirement —— 马上生成并保存到 CawPlan
请回复序号，或直接粘贴 Requirement 链接、或直接说你想怎么做。
```

```text
Lock Requirement
Before generating test cases, let's confirm which Requirement this is
1. I have a Requirement link — pick this, then send me the link
2. No Requirement yet — generate and save to CawPlan now
Reply with a number, paste the Requirement link directly, or just tell me what you'd like to do.
```

## 框 2 · 还没有测试点

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 还没有测试点 | No Test Points Yet |
| `question` | 这条 Requirement 还没有测试点 | This Requirement doesn't have test points yet |
| option 1 · `label` | 马上生成测试点 | Generate test points now |
| option 1 · `description` | 生成好再接着展开用例 | Generate them, then continue to expand test cases |
| option 2 · `label` | 先看看需求内容 | Review the requirement first |
| option 2 · `description` | 读一遍再决定 | Read it through before deciding |

Fallback：

```text
还没有测试点
这条 Requirement 还没有测试点
1. 马上生成测试点 —— 生成好再接着展开用例
2. 先看看需求内容 —— 读一遍再决定
请回复序号，或直接说你想怎么做。
```

```text
No Test Points Yet
This Requirement doesn't have test points yet
1. Generate test points now — generate them, then continue to expand test cases
2. Review the requirement first — read it through before deciding
Reply with a number, or just tell me what you'd like to do.
```

## 框 3 · 需求还没保存

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 需求还没保存 | Requirement Not Saved Yet |
| `question` | 这份需求还没保存到 CawPlan，先保存再来展开用例 | This requirement hasn't been saved to CawPlan yet — save it first, then expand test cases |
| option 1 · `label` | 马上保存 | Save now |
| option 1 · `description` | 存好再接着展开用例 | Save it, then continue to expand test cases |
| option 2 · `label` | 先不保存 | Not yet |
| option 2 · `description` | 先停一下，我再看看这份需求 | Pause for now, I'll review this requirement again |

Fallback：

```text
需求还没保存
这份需求还没保存到 CawPlan，先保存再来展开用例
1. 马上保存 —— 存好再接着展开用例
2. 先不保存 —— 先停一下，我再看看这份需求
请回复序号，或直接说你想怎么做。
```

```text
Requirement Not Saved Yet
This requirement hasn't been saved to CawPlan yet — save it first, then expand test cases
1. Save now — save it, then continue to expand test cases
2. Not yet — pause for now, I'll review this requirement again
Reply with a number, or just tell me what you'd like to do.
```

## 框 4 · 展开方式

将 `N` 替换为本批 `batchCount`。

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 展开方式 | Expansion Method |
| `question` | 本次要展开 N 条,在对话里会很长。怎么弄? | Expanding all N of these will make this reply very long — how should I proceed? |
| option 1 · `label` | 全部铺开 | Expand all inline |
| option 1 · `description` | 不管多长都在对话里展开 | Expand everything in this conversation, however long |
| option 2 · `label` | 全部带步骤导出 | Export all with steps |
| option 2 · `description` | 缺步骤的自动补齐 | Auto-fill any missing steps |
| option 3 · `label` | 先不展开 | Not yet |
| option 3 · `description` | 换个更小范围,比如「先展开 5 条」 | Narrow it down, e.g. "expand the first 5" |

Fallback：

```text
展开方式
本次要展开 N 条,在对话里会很长。怎么弄?
1. 全部铺开
2. 全部带步骤导出 —— 缺步骤的自动补齐
3. 先不展开 —— 换个更小范围,比如「先展开 5 条」
请回复序号，或直接说你想怎么做。
```

```text
Expansion Method
Expanding all N of these will make this reply very long — how should I proceed?
1. Expand all inline
2. Export all with steps — auto-fill any missing steps
3. Not yet — narrow it down, e.g. "expand the first 5"
Reply with a number, or just tell me what you'd like to do.
```

## 框 5 · 导出方式

| 字段 | 中文值 | English value |
|------|-----|-----|
| `header` | 导出方式 | Export Method |
| `question` | 这批用例要怎么导出? | How should this batch of test cases be exported? |
| option 1 · `label` | 导出当前草稿 | Export current draft |
| option 1 · `description` | 没展开的条目只有标题,不作为最终可执行用例 | Un-expanded entries will have titles only and are not final executable cases |
| option 2 · `label` | 全部带步骤导出 | Export all with steps |
| option 2 · `description` | 缺步骤的自动补齐再导,不在对话里铺开 | Auto-fill any missing steps before export, without expanding inline |

Fallback：

```text
导出方式
这批用例要怎么导出?
1. 导出当前草稿 —— 没展开的条目只有标题,不作为最终可执行用例
2. 全部带步骤导出 —— 缺步骤的自动补齐再导,不在对话里铺开
请回复序号，或直接说你想怎么做。
```

```text
Export Method
How should this batch of test cases be exported?
1. Export current draft — un-expanded entries will have titles only and are not final executable cases
2. Export all with steps — auto-fill any missing steps before export, without expanding inline
Reply with a number, or just tell me what you'd like to do.
```
