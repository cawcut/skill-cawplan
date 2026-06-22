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
    npx skills add Ubiquiti-UID/flow-cawplan-skill --skill cawplan-coding-commit --agent cursor claude-code codex  -g -y
    ```
    Skill 安装完成后需要重启 agent 完成 Skill 预加载
2. 安装 `cawplan`：
   ```bash
   npm install -g cawplan@0.0.3
   cawplan --version
   ```

3. 认证 `cawplan`：
   ```bash
   cawplan auth login
   cawplan auth status
   ```

4. 确认本机有 `uid-team-skills` 仓库。

   如果 `uid-team-skills` 不是当前项目的兄弟目录，请配置：

   ```bash
   export UID_TEAM_SKILLS_DIR=/path/to/uid-team-skills
   ```

   建议写入自己的 shell 配置文件，例如 `~/.zshrc`。

## 每日上报流程

在任意工作仓库中向 agent 发起：

```text
/cawplan-coding-commit collect and submit today's coding sessions
```
agent 才会上传到 CawPlan Cloud。

## 双写到 uid-team-skills

CawPlan Cloud 上传成功后，agent 会自动同步旧版日报。

`uid-team-skills` 路径解析顺序：

1. 当前目录如果就是 `uid-team-skills`，直接使用。
2. 如果设置了 `UID_TEAM_SKILLS_DIR`，使用该路径。
3. 尝试当前项目的兄弟目录，例如 `../uid-team-skills`、`../../uid-team-skills`。
4. 如果找不到，停止旧日报同步，并提示配置 `UID_TEAM_SKILLS_DIR`。

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