## Output

**After analysis** (steps 1–6, no archive yet):

- Full five-field draft (section headings, fixed order).
- Display summary (展示摘要) after five fields, before open-questions list.
- Open-questions list (三类 or **无存疑项**).
- **固定尾巴**（五字段 + 展示摘要 + 存疑之后，仅此一句，逐字）：
  > 以上是整理好的需求，你看看内容对不对。没问题就说一声「保存到 CawPlan」。
- **禁止**在同一轮追加产品、模块树、节点 id、保存确认问句。
- After SQA edits: full five-field draft + current display summary + open-questions list + **同一尾巴** again, not a one-line acknowledgment.

**After archive** (step 11): see **Confirmation** below.

## Confirmation

### §6 成功回执（`outcome: SUCCESS` 的 POST / PATCH）

向 SQA 逐字呈现（`需求` = API `summary`，**勿**拼接五字段；`关联工单` 有无都显示）：

**新建（POST）**：

```text
已保存成功。
需求:{需求摘要}
产品:{产品名}
位置:{模块树节点全路径}
关联工单:{工单号，没有则「无」}
Requirement 链接:{api.data.url 完整可点链接}
```

**更新（PATCH）** — 首行改 `已更新成功。`，其余字段同上。

内部：从 `api.data` 设置 `bound_requirement_id` 并刷新 `five_field_snapshot` / `summary_snapshot` / `ticket_id_snapshot`（step 10 **Store**）。**勿**向 SQA 展示 Requirement UUID、`review_status`、`product_id`、`module_tree_node_id` 等内部 id。

`Requirement 链接`：返回 `api.data.url` 原样；可拼 portal 基址供浏览器打开。**Never** construct `url` or pass it to `cawplan api`.

### reconcile 绑定成功（`strong_match_single`）

无新写入。先逐字：

> 这条上次其实已经保存成功了(当时没返回确认)。已绑定到那一条,没有重复创建。

下接 §6 成功回执（数据取自绑定行：`summary`、产品名、节点全路径、关联工单、`url`）。清除 `pending_write` 与 UNKNOWN。

### reconcile 绑定（`patch_already_applied`）— 已知例外，文案未改本轮

- State that the prior write outcome was unclear but the server already has a matching Requirement (`requirements reconcile` returned `patch_already_applied`).
- Report bound `id`, product, module-tree node, `summary`, and `review_status` from the list row.
- Clear `pending_write` and UNKNOWN.

### 保存失败（POST `FAILURE`）

逐字（`{错误信息}` = `error.message` 原文；**勿**标 outcome / FAILURE / api.code）：

> 没能保存。原因:{错误信息}。需求草稿还在,改完可以再存一次。

### 更新失败（PATCH `FAILURE`）— 已知例外，文案未改本轮

- The error `code` and `msg`.
- That the draft (five fields + display summary) is unchanged and SQA may revise and retry.
