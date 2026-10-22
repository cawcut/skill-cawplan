# cawplan-metrics 上报与查询

这份文档只讲 `cawplan-metrics` skill（`cawplan metrics ingest` / `query`）的上报和查询。命令的完整
flag 和画图用法见 `docs/usage-metrics.md`，接口字段见 `references/CAWPLAN_OPEN_API.md` §7。

## 一、上报

```bash
cawplan metrics ingest \
  --domain <domain> --metric <metric> --value 1 \
  --dimensions '{"product":"<product_unique_id>"}' \
  --tags '{"key":"value"}'

# 批量
cawplan metrics ingest --items '[{"domain":"...","metric":"...","value":1}, ...]'
```

接口：`POST /api/v1/public/openapi/key-metrics/ingest`

规则（任何一条不满足，整批被拒绝，不会部分写入）：

- `domain`、`metric`、tag 的 key 必须匹配 `^[a-z][a-z0-9_]*$`；domain 统一 `cawplan_` 前缀。
- 每条至少有 `value` / `count` / `cost` / `credit` 之一；没传的字段不会补 0。
- `--dimensions` 只认 `app`、`platform`、`product`、`plan`、`region`、`environment`，**没有
  `workspace_id`**（后端从登录身份强制写入）。其他自定义标签放 `--tags`。
- `timestamp` 不传则取收到请求的时间。补录历史数据必须显式给，重试时用**原样**的时间戳。
- 成功响应 `data.accepted` 是接收条数。
- 限流：每个凭证每分钟 180 次，超出返回 HTTP 429 `{"code":"RATE_LIMITED"}`。多条用一个 `items`
  数组一次发，不要循环发单条。

注意：

1. **ingest 不能纠错。** 没有删除和覆盖接口，重复写入会重复计数。修正只能写一条补差值的增量点，
   并先得到负责人确认。
2. **这是看板存储，不是账本。** 有财务含义的数据（token/credit 等）不要拿这里的数字对账。
3. 只在用户明确要求记录时才写，不要拿它做历史数据的批量补录。写之前要和用户确认
   `domain`/`metric` 和 dimensions/tags。

## 二、查询

```bash
cawplan metrics query \
  --domain <domain> [--metric <metric>] \
  --start <RFC3339> --end <RFC3339> \
  --granularity day [--tag key:value ...] [--group_by k1,k2] [--fields value,count]
```

接口：`GET /api/v1/public/openapi/key-metrics/query`

- `--start`/`--end` 必填，完整 RFC3339，跨度不能超过 186 天，否则请求被拒绝
  （`FAILURE_INVALID_INPUT`）。
- 默认 `--granularity raw` 不聚合；看趋势要显式用 `day` / `hour` / `minute`。
- `--tag` 重复传；`--group_by`、`--fields` 用逗号分隔。
- `data.truncated` 为 `true`（单次最多 5000 行）说明结果不完整，不能当总数，要缩小范围。
- 可选 `--chart <svg>` / `--png <png>` 输出图表文件，详见 `docs/usage-metrics.md`。

### 确认 domain / metric 是否真有数据

`query` 对拼错的 domain 和没有数据的 domain 都返回空结果，无法区分。用 `domains` 接口确认：

```bash
curl "$CAWPLAN_BASE/api/v1/public/openapi/key-metrics/domains" \
  -H "Authorization: Bearer $TOKEN"
```

- `start`、`end` 都可选；默认 `end` 是现在，`start` 是 `end` 前 30 天，最宽 186 天。
- 返回 `data.domains[]`（每个 domain 下实际出现过的 `metrics[]`）、实际扫描的
  `data.start`/`data.end`，以及 `data.truncated`（命中扫描上限时只是按字母序的前一部分）。
- 目前 CLI 没有对应命令，需要直接调接口。`$TOKEN` 用 `cawplan auth login` 得到的 Bearer token，
  不要写进脚本或提交到仓库。

## 三、写入后核对

1. 用 `domains` 确认 domain/metric 拼写和时间窗口。
2. 用 `metrics query` 查回刚写的范围，和来源数据对账，并检查 `truncated`。
3. 查不到先排查拼写和时间窗口，**不要直接重发**，重发会重复计数。
