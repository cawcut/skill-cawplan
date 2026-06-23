# AI 日志上报使用文档

本文档面向开发人员，说明如何使用当前项目的 `cawplan-coding-commit` skill 统一提交每日 AI Coding 日报。

## 上报目标

每天的上报会上传 `ai-daily-*.json` 到 CawPlan Cloud，用于成本、token、session、prompt quality 等统计。

开发人员统一从当前项目调用 `/cawplan-coding-commit`。

## 首次准备

1. 安装 Skill
    ```bash
    // 方式 1: https clone
    npx skills add Ubiquiti-UID/flow-cawplan-skill \
      --skill cawplan-coding-commit \
      --agent cursor claude-code codex \
      -g -y
   
   // 方式 2: ssh clone
   npx skills add git@github.com:Ubiquiti-UID/flow-cawplan-skill.git \
    --skill cawplan-coding-commit \
    --agent cursor claude-code codex \
    -g -y
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

## 每日上报流程

在任意目录中唤起 agent 使用 skill 或发送提示词：

```text
/cawplan-coding-commit

/cawplan-coding-commit collect and submit today's coding sessions
```
agent 才会上传到 CawPlan Cloud。

### Cursor Terminal 中补全 Product / Repo

在 Cursor 聊天页面中调用 skill 时，agent 执行的 shell 通常不是交互式 TTY，所以 CLI 的 product/repo 选择器可能不会弹出。如果日志提示 product/repo assignment 被跳过，请在 Cursor 自己的 Terminal 中运行同一条收集命令，走原生选择器完成补全：

```bash
cawplan ai-session collect --date <YYYY-MM-DD>
```

Terminal 中会优先使用已有 cloud product-repo mapping；如果没有匹配项，会通过选择器让你选择 product 和 repository，或输入 GitHub repository URL（格式必须是 `https://github.com/owner/repo`）。

## 常见问题


### cawplan 认证过期

重新登录：

```bash
cawplan auth login
```

### Cursor 成本缺失

Cursor token/cost 依赖 Cursor Dashboard API。缺少 token 或网络不可用时，日报仍会生成，但 Cursor 成本可能为空或使用估算。