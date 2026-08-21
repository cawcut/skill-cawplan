# coding 日报基线固件（S1.1）

采自未改动的 `main`（`git diff --stat -- src/lib/collect/ src/commands/session.ts` 为空），
用于 S1.3 回归项 1：重构前后 coding 日报逐字段 diff 必须为空。

| 文件 | 日期 | sessions | agents |
|---|---|---|---|
| `before-2026-07-30.json` | 2026-07-30 | 27 | claude-code, cursor-gui |
| `before-2026-08-13.json` | 2026-08-13 | 23 | claude-code, cursor-gui |
| `before-2026-08-11.json` | 2026-08-11 | 23 | claude-code, cursor-gui |

codex 无本地数据（`~/.codex/sessions` 不存在），未覆盖。

> 注：最初选的第 3 个日期是 2026-08-20（含真实 QA 会话），但该日期在 S1.3 首次比对时是「今天」——
> 两次采集之间当前会话自身产生了新活动（新的助手消息/文件改动），导致 diff 非空且不可复现，
> 与 collect() 重构无关。已改用已结束、不再变化的 2026-08-11 替代。今天含 QA 会话的事实保留给
> M3 阶段用真实 QA 会话验证时单独处理。
