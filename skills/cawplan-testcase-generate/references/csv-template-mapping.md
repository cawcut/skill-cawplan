# CSV 列映射与导出契约（A3）

本文件仅在导出时读取，是 interim JSON、CSV 布局和脚本调用的文档真相源。机器实现为 `scripts/export_to_csv.js`，列模板为 `assets/testcase-template.csv`；变更任一方时必须同步其余两方。

## Interim JSON

导出当前 `cases[]` 的快照：

```json
{ "requirementTitle": "...", "cases": [ ... ] }
```

| 字段 | 契约 |
|---|---|
| `requirementTitle` | 用于 `<title>_<timestamp>.csv` 文件名 |
| `title` | 必填，用例标题 |
| `priority` | P0–P3 或英文优先级，由脚本映射 |
| `tag`, `group`, `testPointTitle` | 原样继承；`testPointTitle` 必须为全称，不得写 `同上` |
| `testPointId`, `requirementId` | 已归档主路径必填 |
| `moduleTreeNodeId` | 来自 Requirement；缺失时留空并存疑 |
| `preconditions` | string 或 string[]；标题态可省略或留空 |
| `steps[]`, `expected[]` | 必须等长；标题态只能是 `[]` / `[]` |
| `sourceCaseKey` | 可选；存在时用于 Refs 中的 case identity |

## 13 列映射

| # | 列名 | 内容 |
|---|---|---|
| 1 | CaseId | 脚本份内递增序号 |
| 2 | Title | 用例标题 |
| 3 | Priority | Critical/High/Medium/Low |
| 4 | Tag | 父测试点标签原文 |
| 5 | Group | 父测试点分组原文 |
| 6 | TestPointTitle | 父测试点完整标题 |
| 7 | Preconditions | 多条为 `1.\n2.`，不跨 Case 去重 |
| 8 | Step description | 一步一行 |
| 9 | Expected Result | 与 Step 同行一一对应 |
| 10 | moduleTreeNodeId | Requirement 模块树节点 id |
| 11 | RequirementId | Requirement id |
| 12 | TestPointId | 父测试点 id |
| 13 | Refs | 脚本生成的 TestRail References 埋点 |

## Refs

每条 Case 首行写：

```text
cawplan:{RequirementId};cawplan:{TestPointId};cawplan:case_{caseIdentity}
```

`caseIdentity` 优先使用 `sourceCaseKey`，否则由脚本按 title/steps/preconditions/tag 计算与后端一致的 `content_hash`。Refs 不得由 SQA 或 Agent 手写；TestRail 导入时映射到 References。同一 `TestPointId` 下不同 Case 的 identity 必须不同。

## 跨行和草稿态

- 用例级列 1–6、10–13 只在 Case 首行填写，续行留空。
- 详情列 7–9 同进退：展开态连续 N 行，N 为步骤数；首行含 Preconditions、Step 1、Expected 1，续行只含 Step/Expected。
- 单步 Case 占一行。标题态 Case 也占一行：用例级列和 Refs 正常填写，详情三列为空。
- 已展开与未展开 Case 可在同一 CSV 混排；标题态条目的详情三列保持为空。
- 脚本不生成、补齐或改写用例内容。
- 预览中的 `同上` 只属于 Markdown 显示层，JSON/CSV 每条 Case 始终保存完整 `testPointTitle` 和 `group`。

## 文件格式

一个 Requirement 生成一个时间戳 CSV。文件为 UTF-8 无 BOM、CRLF 行尾，并使用 RFC4180 转义。默认输出目录是当前工作目录下的 `testcases/`；SQA 指定时用 `-o <dir>`。多次导出互不覆盖，也不改变会话工作态。

## 调用

在本 Skill 目录执行。用临时 JSON 保存快照，完成后删除：

```bash
TMP_JSON="/tmp/a3_export_$(date +%Y%m%d_%H%M%S)_$RANDOM.json"

cat > "$TMP_JSON" <<'EOF'
{ "requirementTitle": "...", "cases": [ ... ] }
EOF

node scripts/export_to_csv.js "$TMP_JSON" -o testcases

rm -f "$TMP_JSON"
```

不得手写 CSV 或临时重写导出逻辑。脚本失败时如实报告 stderr，修复上游 JSON 后重试。

## 硬门

脚本拒绝空 `testPointId`、空 `requirementId`、空 `title`、Step/Expected 数量不等，以及展开态中空 Step 或空 Expected。标题态只允许 `[]` / `[]`。不得增加模板外列、用 CaseId 当稳定主键、改写 Refs、输出 BOM 或非 CRLF 文件。
