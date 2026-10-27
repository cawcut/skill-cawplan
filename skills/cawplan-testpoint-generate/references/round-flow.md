# Round 流程细节（两阶段 Review）

SKILL.md §7/§8/§9 的细节补充。**阶段由 Review State 决定，Chat 不判断、不维护**：`open_questions` 中只要有一条 `round_answer_baseline` 为空（新提出、尚未被 AI 消费）→ **Questions 阶段**；否则（无问题，或问题都已被上一轮 AI 消费）→ **Review 阶段**。

## 1. 两阶段页面

| | Questions 阶段 | Review 阶段 |
|---|---|---|
| 页面内容 | 问题卡片（输入框 + Ignore）+ Continue | 测试点表格、Add、Ask AI to Optimize、Save to CawPlan |
| 测试点表格 | 不展示 | 展示 |
| Save | **没有入口**，服务端也拒绝 | 可用 |
| 答案 | 输入后自动保存（停止输入约 650ms / 失焦）；Ignore = 以「忽略」/「Ignore」作为答案；刷新后答案仍在 | 无问题面板 |
| 提交 | 每条都回答或 Ignore 后 Continue 才可点；Continue = Ask AI to Optimize | Ask AI to Optimize / Save |

- Continue 成功后页面锁定并尝试关闭标签；关不掉则显示「已完成，可关闭此页」。Optimize 与 Save 成功后同理。
- 点击 Continue 前页面会先 flush 未保存答案，失败则阻止提交。
- 创建 Review 时若传入了存疑，第一页就是 Questions 阶段；无存疑则直接是 Review 阶段。
- Review 状态里**不再有 Overall Feedback**（`global_comments` 已移除）。整体性意见走 Chat（由 transcript 收集，见 §8）或测试点 Comment。

## 2. Chat 输出（按阶段）

每轮（含首轮）都先读最新 Review State，取 `open_questions` 的 baseline 判断阶段，再输出：

- **Questions 阶段**：开场摘要 → 一次可点击 `review_url` → **完整**存疑清单（逐条原文，不只给数量或主题）→ 一句引导：在页面回答或 Ignore 后点 Continue（或直接在 Chat 回复）。**不提 Save**。
- **Review 阶段**：沿用 SKILL §7.2（首轮）/ §8 输出契约（修订轮）：链接 + 剩余存疑（如有）+ 引导 Save。

链接每轮只给一次；不播报过程。

## 3. 答案驱动轮（Questions 阶段 Continue 之后的 AI 规则）

`show` 读到的 State 中，`open_questions` 里 `answer` 非空且 `round_answer_baseline` 为空的问题 = 本轮新答案（包括 Ignore）。

- `retained_ids` **只保留仍未回答（`answer` 为 `null`）的问题**。已回答/已 Ignore 的不得保留，也不得换措辞重复提出。
- 答案若只确定了方向，可据此生成或修改测试点；Ignore 视为 SQA 明确不关心，按默认方向处理，不再追问。
- **尽量**不改动 SQA 此前已编辑/确认的测试点，除非答案直接影响它（这是 prompt 约束，非程序校验）。
- 尽量把疑问合并在一轮提出，**避免连续多轮 Questions**；新问题只针对答案揭示的新缺口。
- 若本轮输出**没有新问题**（即将进入 Review 阶段）：先按 `references/review-checklist.md` 复查整体覆盖，再写 `apply-optimization`。
- `questions` 字段依旧必填：`{"retained_ids": [...], "added": [...]}`。

## 4. 变更标签跨轮累积

页面上的「新增 / 已修改」标签由 `apply-optimization` 计算，Chat 不参与。规则：标签在 SQA **实际看过一次 Review 阶段页面**后才清算；连续的 Questions 轮 SQA 看不到测试点，所以标签累积（AI 新增的行保持「新增」，被改过的保持「已修改」），避免 SQA 在回到 Review 页时看不到前几轮的改动。

- 判据：Review State 的 `last_viewed_review_round`，服务端在渲染未锁定的 Review 阶段页面时写入；Chat 与 Agent **不得**为此 GET 页面（也不要用脚本探测页面）。
- 从未看过 Review 页时，下一轮只标本轮变化（不累积）。

## 5. Save 前置条件

Save to CawPlan 在以下情况被拒绝，且无强制入口：Questions 阶段（仍有 baseline 为空的问题）；仍有未被 Ask AI 消费的测试点 Comment；有本轮新增/修改且未被消费的非空问题答案。被拦截的 Save 不触发 Human Input 收集。仅 Edit / Delete / Add 可直接保存。

## 6. Human Input

Optimize / Continue 锁定边界会把当前 Round 的 Edit / Add / Delete / Comment / Answer Question 投影进既有 outbox；答案取边界前的最终非空值（含 Ignore 文案），清空为 `null` 的不收集。Chat 不回显、不总结这些事件。
