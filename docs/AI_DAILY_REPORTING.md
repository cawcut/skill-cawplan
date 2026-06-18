# AI 日志上报使用文档

本文档面向开发人员，说明如何使用当前项目的 `cawplan-coding-commit` skill 统一提交每日 AI Coding 日报。

## 上报目标

每天的上报会同时完成两件事：

- 上传 `ai-daily-*.json` 到 CawPlan Cloud，用于成本、token、session、prompt quality 等统计。
- 同步生成 `uid-team-skills` 旧版日报，并在 `uid-team-skills` 仓库中只提交最终 Markdown 日报文件。

开发人员不需要手动启动旧仓库里的 agent；统一从当前项目调用 `/cawplan-coding-commit`。

## 首次准备

1. 安装 Skill
    ```bash
    npx skills add Ubiquiti-UID/flow-cawplan-skill --skill cawplan-coding-commit -g -y
    ```

2. 安装并认证 `cawplan`：

   ```bash
   npm install -g cawplan@0.0.3
   cawplan --version
   cawplan auth login
   cawplan auth status
   ```

3. 确认本机有 `uid-team-skills` 仓库。

   如果 `uid-team-skills` 不是当前项目的兄弟目录，请配置：

   ```bash
   export UID_TEAM_SKILLS_DIR=/path/to/uid-team-skills
   ```

   建议写入自己的 shell 配置文件，例如 `~/.zshrc`。

## 每日上报流程

### 推荐方式：收集并上传当天日报

在任意工作仓库中向 agent 发起：

```text
/cawplan-coding-commit collect and submit today's coding sessions
```

agent 会先执行本地收集：

```bash
cawplan ai-session collect --date <YYYY-MM-DD>
```

然后展示完整 review，包括：

- 日期和作者
- 按 agent 拆分的 session 数量
- 总成本
- 当日整体工作总结
- 主要 session 的文字说明
- human input 重点，例如决策、方向调整、问题修正、规划讨论
- 变更文件统计
- 数据质量提示，例如成本估算、缺失模型、API warning

确认无误后回复“确认”，agent 才会上传到 CawPlan Cloud。

### 上传已有日报文件

如果已经有日报 JSON：

```text
/cawplan-coding-commit @ai-daily-2026-06-18.json 上传
```

多个文件也可以一次上传：

```text
/cawplan-coding-commit @ai-daily-2026-06-17.json @ai-daily-2026-06-18.json 上传
```

agent 会先读取每个文件并展示完整 review，确认后逐个执行：

```bash
cawplan ai-session report --file <path>
```

## 双写到 uid-team-skills

CawPlan Cloud 上传成功后，agent 会自动同步旧版日报。

`uid-team-skills` 路径解析顺序：

1. 当前目录如果就是 `uid-team-skills`，直接使用。
2. 如果设置了 `UID_TEAM_SKILLS_DIR`，使用该路径。
3. 尝试当前项目的兄弟目录，例如 `../uid-team-skills`、`../../uid-team-skills`。
4. 如果找不到，停止旧日报同步，并提示配置 `UID_TEAM_SKILLS_DIR`。

每个 distinct report date 会单独执行旧流程：

```bash
cd <resolved-uid-team-skills-dir>
python3 .agents/skills/ai-coding-reports/scripts/cli.py collect --date <YYYY-MM-DD>
python3 .agents/skills/ai-coding-reports/scripts/cli.py prepare chunks --date <YYYY-MM-DD>
python3 .agents/skills/ai-coding-reports/scripts/cli.py render --date <YYYY-MM-DD>
```

agent 会根据 `Outputs/reports/<date>/chunks/` 生成 session summaries 和 `_overall.json`，再渲染 `Reports/` 下的 Markdown 日报。`Outputs/` 是中间产物，不会提交。

## uid-team-skills 提交规则

旧日报生成后，agent 会在 `uid-team-skills` 中检查：

```bash
git status --short
```

只有当相关变更是目标日期的最终 Markdown 日报时，agent 才会自动提交：

```bash
git add <final-report.md>
git commit -m "daily report: <one-line summary>"
```

agent 不会提交 `Outputs/`、chunks、summaries、JSON 文件或其他中间产物。

如果存在非最终 Markdown 日报变更，或存在与目标日期/用户无关的 Markdown 变更，agent 会停止并报告状态，不会自动提交。

提交成功后，agent 会询问是否需要 push。只有用户明确确认后，agent 才会执行：

```bash
git push
```

如果 push 失败，agent 会提示失败原因，并说明本地 commit 已创建但尚未推送。

## 常见问题

### 找不到 uid-team-skills

设置：

```bash
export UID_TEAM_SKILLS_DIR=/path/to/uid-team-skills
```

然后重新执行 `/cawplan-coding-commit`。

### cawplan 认证过期

重新登录：

```bash
cawplan auth login
```

### Cursor 成本缺失

Cursor token/cost 依赖 Cursor Dashboard API。缺少 token 或网络不可用时，日报仍会生成，但 Cursor 成本可能为空或使用估算。

### 旧日报生成后没有自动提交

检查 `uid-team-skills` 的 `git status --short`。如果存在非最终 Markdown 日报变更，agent 会按规则停止，避免误提交开发中的文件或中间产物。

