# AI 日报上报说明

本文档面向开发人员，说明如何每天提交 AI Coding 日报。
日报会上传到 CawPlan Cloud，用于统计 AI session、token、成本和 prompt 使用情况。

## 首次准备

1. 安装 Skill：
```bash
# 方式 1: https clone
npx skills add Ubiquiti-UID/flow-cawplan-skill \
  --skill "*" \
  --agent cursor claude-code codex \
  -g -y

# 方式 2: ssh clone
npx skills add git@github.com:Ubiquiti-UID/flow-cawplan-skill.git \
  --skill "*" \
  --agent cursor claude-code codex \
  -g -y
```

安装完成后重启 agent，让 skill 生效。

2. 安装 `cawplan` CLI：

```bash
npm install -g cawplan@0.0.5
cawplan --version
```

3. 登录 CawPlan：

```bash
cawplan auth login
cawplan auth status
```

首次在某个仓库上报前，建议在该仓库中执行一次：

```text
/cawplan-coding-init
```

它会帮助配置当前 GitHub 仓库和 CawPlan Product 的默认映射。

## 每日上报

每天在 agent 中执行：

```text
/cawplan-coding-commit
```

不需要额外提示词，也不需要二次确认上传。Agent 会自动收集当天 AI session，展示摘要后上传日报。

上传成功后，CLI 会检查当月云端缺失的日报，并自动补齐可收集的历史日期。

## 常见问题

### 认证过期

重新登录：

```bash
cawplan auth login
```

### Cursor 成本缺失

Cursor token/cost 依赖 Cursor Dashboard API。缺少 token 或网络不可用时，日报仍可生成，但 Cursor 成本可能为空或不完整。