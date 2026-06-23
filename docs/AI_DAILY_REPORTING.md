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

## Session 产品 / 仓库归属

`cawplan ai-session collect` 会尽量根据 cloud 中已有的 product-repo mapping 为每个 session 写入 `product_id` / `product_name`，并在选择 repo 时同步 `project` 和 repo 信息。

如果 agent shell 没有交互式 TTY，或需要一次性编辑多个 session，可以使用本地 Web 页面：

```bash
cawplan ai-session assign --file /absolute/path/to/ai-daily-2026-06-22.json --web
```

命令会启动只绑定 `127.0.0.1` 的本地 server，并输出带 token 的 URL。打开页面后，可在 `session / product / repo` 表格中逐 session 选择 product 和 repo；repo 可选择 product-only，也可输入 `https://github.com/owner/repo` 创建并关联新的 mapping。保存后会写回原 `ai-daily-*.json` 文件并关闭本地 server。

## 常见问题


### cawplan 认证过期

重新登录：

```bash
cawplan auth login
```

### Cursor 成本缺失

Cursor token/cost 依赖 Cursor Dashboard API。缺少 token 或网络不可用时，日报仍会生成，但 Cursor 成本可能为空或使用估算。