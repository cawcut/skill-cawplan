# A3 UX — 字段友好名与用户引导

Agent 自行 `AskUserQuestion`（不写入 `allowed-tools`）。**跟随用户主语言**；禁止同一段中英各写一遍。

---

## §Glossary

主文用友好名；`product_id`/`version_id`/`result_id`/`plan_mapping_id` **默认隐藏**（技术详情按需）。

**范围**：产品 · 版本 · 工单 · 测试运行 · 编排批次

**健康度**：已执行/总用例 · 通过质量 · 待办 Failed/Blocked · 未登记缺陷的 Failed/Blocked

**待处理**：用例名称 · 执行状态 · 失败时间 · 原因摘要 · TestRail 测试 · CawPlan 缺陷

**枚举**：FAILED→失败 · BLOCKED→阻塞 · Critical/High/Medium/Low 可本地化

**意图同义词**（先匹配再弹框）：执行进度/通过率/execution progress · 失败列表/待处理/unlinked · 只看这个 Run/Ticket · flaky/稳定性 · 全 status/include zero · 登记缺陷/file defect · 刷新/latest · 简单看下/quick summary

---

## §Prompts 交互元模板（SHALL）

1. 框上正文 1–2 句（友好字段名）
2. `AskUserQuestion`：`header` + `question` + 选项 `label`（+ 可选 `description`）
3. 不可用 → 编号纯文字降级
4. 勿定义 `Other`

### 场景选项清单

| 场景 | option labels |
|------|---------------|
| 缺产品/版本 | 粘贴门户链接 / 产品名+版本名 / 提供 ID |
| 多产品/版本匹配 | 各候选名一行 / 重新说明 |
| **范围闸**（未指定范围） | 全版本（默认）/ 指定单个工单 / 指定单个 Run / 指定编排批次 |
| **下钻闸**（仅健康度或「简单看下」后） | 查看待处理失败 / 按工单进度表 / flaky 分析（较慢）/ 显示全部自定义状态 / 够了 |
| **行级 A4**（用户点行或说登记缺陷） | 转到缺陷登记(A4) / 先看 TestRail / 不用 |
| `total=0` | 确认是否已编排测试计划(A2) / 换版本 / 结束 |
| Run 不在版本 | 换版本或 Run / 结束 |
| failures 分页 | 加载更多 / 只看 Critical·High |

### 下钻闸规则（SHALL）

- **已输出完整 4 层**（健康度 + 待处理 + 工单进度 + 执行构成）→ **禁止**再弹下钻闸。
- **仅输出健康度**，或用户说「简单看下/只要摘要」→ **可弹**下钻闸。
- 用户在下钻闸选某项 → 补查/补展示对应层，不重复已展示块。

---

## §Output 四层报告（SHALL）

决策向总结；**不**输出原始大 JSON。列名跟随用户主语言（下为中文示例）。

```markdown
## 执行健康度 — {product_name} {version_name}

| 执行进度 | 通过质量 | 待闭环* |
|----------|----------|---------|
| **{executed}/{total} ({rate}%)** | {quality_passed}/{executed} ({pass_quality_rate}%) | Failed: {n_failed} · Blocked: {n_blocked}<br>未闭环：Failed {u_failed} 条、Blocked {u_blocked} 条尚未在 CawPlan 创建缺陷闭环 |

\* 按 Test 去重后的最新失败/阻塞；未闭环 = 尚未关联 CawPlan 缺陷

**一句话**：{执行是否过半、最大风险工单、是否需介入}

---

### 待处理（按优先级 · 已去重）

| 优先级 | 用例名称 | 状态 | 失败时间 | 原因摘要 | TestRail 测试 | CawPlan 缺陷 |
|--------|----------|------|----------|----------|---------------|--------------|

无失败时：「无失败/阻塞结果」；仍输出健康度与工单进度。

---

### 按工单执行进度

| 工单 | Run | 进度 | Failed | Blocked | 未执行 | 状态 |
|------|-----|------|--------|---------|--------|------|

---

### 执行构成

| 维度 | 数量 | 占比 |
|------|------|------|
| 总计 / 已执行 / 通过 / 失败 / 阻塞 / 未执行 | … | … |
| {Top3 自定义 status 各一行} | … | … |

### 附录（按需折叠）

历史失败 · result_id · flaky 说明 · failures 查询次数
```

**禁止主表列**：flaky · consecutive_failures · result_id · run_name（附录可选）。

**CawPlan 缺陷列**：有 `linked_ticket_url` → 链接(display id)；仅 id → 文本；空 → `未关联`。禁止 ✓/✗。

---

## §A4 缺陷登记衔接（SHALL）

1. **文末固定一句**（不弹窗）：
   > 需要登记缺陷时，请使用 `cawplan-defect-ticket`；待处理表中各行可用于 A4。已有关联缺陷的行优先走关联而非新建。

2. **行级**（仅当用户**点击某行**或明确说「登记缺陷/转缺陷/file defect」）→ `AskUserQuestion`：
   - 转到缺陷登记(A4) / 先看 TestRail / 不用

3. **禁止**：未请求时主动调用 A4、主动弹「是否现在建单」。

4. tests/view 链接要建缺陷 → 直接引导 A4 Skill，不走 A3 `failures --test-id`。

---

## §Errors 异常恢复

自然语言 + 编号选项；不以 error code 为标题。

| 场景 | 选项 |
|------|------|
| 数据可能异常(stale) | 稍后重试 / 结束 |
| 无可统计 Run | 确认 A2 编排 / 换版本 / 结束 |
| TestRail 不可用 | 稍后重试 / 结束 |
