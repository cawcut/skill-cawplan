# AI 日志上报使用文档

本文档面向开发人员，说明如何使用当前项目的 `cawplan-coding-commit` skill 统一提交每日 AI Coding 日报。

## 上报目标

每天的上报会上传 `ai-daily-*.json` 到 CawPlan Cloud，用于成本、token、session、prompt quality 等统计。

开发人员统一在 agent 调用 `/cawplan-coding-commit`。

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

## 常见问题


### cawplan 认证过期

重新登录：

```bash
cawplan auth login
```

### Cursor 成本缺失

Cursor token/cost 依赖 Cursor Dashboard API。缺少 token 或网络不可用时，日报仍会生成，但 Cursor 成本可能为空或使用估算。