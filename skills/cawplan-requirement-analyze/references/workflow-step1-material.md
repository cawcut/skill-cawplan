Accept any mix of:

- **User text** — use as-is.
- **CawPlan ticket** — URL, `PREFIX-123` display ID, or unique ID. Extract display IDs from URLs like `/issue/CAWP-04606` before searching.
- **Screenshots** — multimodal images only; **do not OCR**. 分析截图时除文字外也要留意控件状态与页面当前状态（如按钮置灰/禁用、输入框已填、是否正显示错误/成功态），并区分「当前正处于」和「规则上会出现」；写入五字段时用页面/规则表述，勿写来源词（step 2 No provenance）。**强推断**（UI 强暗示、可与惯例一并写入字段）→ 用 **`（界面推断）`** 写入字段（step 3 固定措辞）；**弱推断**（单帧难区分态与规则）→ **待确认** 存疑，不写进字段。If SQA provides **multiple** screenshots, **include every image** — do not analyze only the first or drop the rest.

Do not process ticket image attachments in A1.

**Ticket lookup** (only when a ticket is provided as material):

```bash
# Single display ID
cawplan tickets search --display_ids CAWP-04606
# Multiple display IDs — comma-separated, no spaces
cawplan tickets search --display_ids CAWP-13477,CAW-04560
```

From each ticket, use **only** `description` and `remarks` (no separate title — rely on these two). Strip HTML tags from `remarks` before analysis. Do **not** use `progress_comment`, comments, or attachments.

**Product info（内部背景 · 可选）** — 系统自动派生的定向理解上下文（产品名 + 描述），帮助判断「这是什么产品、术语与场景背景」；**不呈现给 SQA**；`argument-hint` 不变。

- **取数时机**（进入 step 2 之前，命中其一即取；取到后 step 6 修订轮复用、**不重复 GET**）：
  - 工单响应已带 `product_id`（step 1 ticket lookup 之后）；
  - 会话已有 `product_id`（含接力入站已带）。
- **不取数**：纯文字/截图且无 ticket、会话无 `product_id`（产品选择仍延后到保存意图 step 7）；冷交接（step 10）；接力入站且跳过 step 1–6。
- **命令**（分析阶段允许的 product 只读 overview；与 step 7 的 `products list` 保存流程分离）：

```bash
cawplan products overview <product_id>
```

- **解析**：响应外层 `code` / `data` / `msg`（**不用** qa-insights 的 `outcome`）。**成功** = `code == "SUCCESS"` **且** `data.description` 非空；此时只认 `data.name` 与 `data.description`（均在 `data` 顶层、无嵌套），**忽略** `data` 内 `product_line` / `type` / `product_types` 等同名字段。
- **用法**：仅作 step 2–5「这条需求在讲什么」的背景参考；**不是第四类素材**（见 step 2）。
- **绝不能进归档链路**：不进五字段、不进展示摘要、不进存疑清单；不进归档 body（仍仅五字段 + `summary` + `ticket_id`）；不进 `five_field_snapshot` / `summary_snapshot` / `ticket_id_snapshot` / `pending_write` probe。
- **降级**：请求失败、`code != "SUCCESS"`、`data.description` 空或缺失 → 等同于没有这层背景；分析照常进行，不早停、不中断、不向 SQA 报错。
