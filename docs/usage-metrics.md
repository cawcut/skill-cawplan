# CawPlan Metrics 使用指南

`cawplan metrics` 是命令行下的通用业务指标工具：订阅、CawPlan ticket、QA、workflow 执行、
token 消耗、API 用量等，全部按 `domain`/`metric` 组织，共用同一套 `query`/`ingest` 命令。
这份文档按"你想做什么"来组织，照着你要做的事找到对应的命令就行。

对应的 Claude Code skill 是 `cawplan-metrics`（`/cawplan-metrics`）；这份文档是给直接用
终端敲命令的人看的。

> 之前这里还有一套"设备/App 指标"（安装量、崩溃率等）；对应的公开 Open API
> （`GET /api/v1/public/openapi/product/{product_id}/metrics`）和 `cawplan metrics get`
> 命令已经下线，不再对外暴露。设备指标本身还在跑（内部路由/Web 端不受影响），只是不再通过
> CLI/公开 API 提供。

## 开始之前

先确认自己能正常访问：

```bash
cawplan skill check
```

如果这一步报错，说明还没登录或没有权限，先联系管理员或按提示登录。

## `query`/`ingest` 对接的是哪个后端接口

`cawplan metrics query`/`cawplan metrics ingest` 分别就是薄薄一层包装，直接转发到
`uid.core-product` 的两个公开 Open API：

| CLI 命令 | 后端接口 |
|---|---|
| `metrics query` | `GET /api/v1/public/openapi/key-metrics/query` |
| `metrics ingest` | `POST /api/v1/public/openapi/key-metrics/ingest` |

CLI 登录用的是 OAuth Bearer token（`cawplan auth login`），不是共享的静态 API Key——请求会带着
`Authorization: Bearer <token>`，后端按你自己的用户身份解析出你所在的 workspace 和 RBAC 权限，
不需要也不能自己传 workspace_id。这一点对 `query`/`ingest` 都成立：

- **query**：无论你在 `--tag`/`--group_by` 里怎么传 `workspace_id`，最终只会查到你自己
  workspace 的数据——后端会强制把 `workspace_id` 加进查询条件，不认调用方传的值。
- **ingest**：同理，写入的每一条事件都会被强制打上你自己的 `workspace_id`，`--dimensions`/
  `--tags` 里传的 `workspace_id` 会被忽略——这也是为什么 `--dimensions` 允许的字段里根本没有
  `workspace_id`（见下面"我想写入一条业务指标事件"）。

两边各自还有一套独立的硬上限，命中了不是"这段时间/这批数据没有"，是请求本身被拒绝：

| | 限制 | 命中后的表现 |
|---|---|---|
| `ingest` | 按调用凭证（整个 `Authorization` 头做哈希，Bearer token 和普通 API Key 一视同仁）限流，目前每分钟 180 次 | HTTP 429，`{"code":"RATE_LIMITED","msg":"Too many attempts. Try again later."}`——不是走 `CommonResp` 平时那套业务错误码 |
| `query` | 单次查询的 `--start`~`--end` 跨度上限 186 天（约 6 个月）；单次最多返回 5000 行 | 跨度超限：请求直接报错（`FAILURE_INVALID_INPUT`），不是"只返回一部分"；行数超限：正常返回，但 `data.truncated` 是 `true`，说明这只是命中行数上限后的一部分 |

`ingest` 的限流是全新加的（之前没有任何频率限制）；`query` 的跨度上限之前是 90 天，最近放宽到了
186 天，所以 `--start`/`--end` 跨度在 3~6 个月之间的查询现在能过了。注意这个 `--start`/`--end`
是这个通用 `key-metrics/query` 接口自己的参数，跟 `uid.core-product` 内部另一套产品设备指标接口
（`GET /product/{unique_id}/metrics/*`）支持的 `time_range=6m` 这种简写不是一回事——`cawplan
metrics query` 没有 `--time_range` 这个 flag，必须显式给完整的 `--start`/`--end` RFC3339 时间戳。

## 我想查一个业务指标的趋势（订阅、ticket、QA、workflow、token...）

所有业务指标共用同一个 `metrics query` 命令，靠 `--domain`/`--metric` 区分是哪一类。
domain 现在统一带 `cawplan_` 前缀。常见的 `domain`/`metric` 组合，**以及哪些指标真的有数据在写、
哪些只是定义了还没接生产者**（查一个还没接的会一直是空结果，跟"这个时间范围没数据"看起来一样，
遇到列表以外的说法先问，别猜）：

| domain | metric | 含义 | 状态 |
|---|---|---|---|
| `cawplan_ticket` | `ticket_created` / `ticket_updated` / `ticket_status_changed` | CawPlan ticket 新增/更新/状态变化（见 `docs/cawplan-ticket-metrics-collection.md`） | 已接 |
| `cawplan_qa_insight` | `test_point_created` / `test_point_updated` / `report_created` / `execution` | QA 测试点新增/更新、测试报告新增、测试执行结果 | 已接 |
| `cawplan_subscription` | `new` / `renew` | 从 Stripe `invoice.paid` 按 `billing_reason` 区分首次订阅/续订 | 已接 |
| `cawplan_subscription` | `cancel` | 用户主动取消（降级回 Free）生效那一刻 | 已接 |
| `cawplan_subscription` | `winback` / `upgrade` / `downgrade` | 订阅生命周期事件 | 未接——查询永远是空的 |
| `cawplan_api` | `throttled` | 每次返回 429 打一条 | 已接 |
| `cawplan_api` | `request` | API 请求量 | 未接——查询永远是空的 |
| `cawplan_ai_session_usage` | `usage_reported` | AI 编程工具每日用量报告上传（token 数/session 数/USD 成本，按 workspace）——这是内部工程成本统计，不是面向客户的 token/credit 账本，别跟 `cawplan_token` 混 | 已接 |
| `cawplan_workflow` | `execution` | workflow/node 执行（`status` tag 区分 success/failure/exception） | 未接——查询永远是空的 |
| `cawplan_token` | `consumed` / `recharged` / `refunded` / `cost` | token/credit 台账事件（面向客户的额度账本） | 未接——查询永远是空的 |
| `cawplan_user` | `signup` / `active` | 用户新增/活跃 | 未接——查询永远是空的 |
| `cawplan_csm` / `cawplan_purchase` | — | CSM ticket、购买 | 未接——查询永远是空的 |

标准维度（`--dimensions` 里的字段，或者查询时按同名 tag 过滤）现在是七个：
`app`/`platform`/`product`/`workspace_id`/`plan`/`region`/`environment`。
`workspace_id` 是租户归属维度——所有这些指标本质上都是按 workspace 隔离的数据，
只是很多指标（比如 QA、ticket）目前只打了 `product`，没有额外打其他标准维度。

除了标准维度，有些 domain 还会打一些只对自己有意义的动态 tag（走 `--tags`，不是
`--dimensions`），常见的几个：

| domain | tag | 说明 |
|---|---|---|
| `cawplan_ticket` | `ticket_id` | 这个 ticket 自己的 `unique_id`，三个 ticket 指标都有。没有它的话分不清"半秒内十个 ticket_updated"是十个不同 ticket 的祖先状态上推（正常），还是同一个 ticket 被重复写了十次（bug）——用 `--tag ticket_id:<xxx>` 或者 `--group_by ticket_id` 来区分。 |
| `cawplan_ticket` | `from_status`/`to_status` | 只有 `ticket_status_changed` 才有。 |
| `cawplan_qa_insight` | `qa_result` | 只有 `execution` 才有：原始的 `pass`/`pass_with_issues`/`failed` 三态值。标准的 `result` tag 只有 `passed`/`failed` 两态（`pass_with_issues` 在那边会被并到 `passed`），`qa_result` 保留了完整的三态信息。 |
| `cawplan_subscription` | `from_plan`/`to_plan` | 只有 `upgrade`/`downgrade` 才有——但这两个 metric 本身还没接生产者（见上表），所以这个 tag 目前也查不到数据。 |
| `cawplan_api` | `route` | `throttled`/`request` 都有——被限流/被请求的具体路径，比如 `/api/v1/public/openapi/key-metrics/ingest`。 |
| `cawplan_api` | `status_code` | 只有 `request` 才有（还没接生产者，见上表）。 |

不是每个 domain 都有动态 tag，具体以后端实际打了什么为准——查不到就说明这个调用点
目前没打这个 tag，不代表接口不支持。

`cawplan_api`/`throttled` 有个容易踩的坑：现在打点的几个限流器（IP、API 凭证）传的
`dimensions` 是空的，所以这些 `throttled` 点**没有 `workspace_id` 标准维度**——按
`--tag workspace_id:<xxx>` 过滤会查不到任何东西，不代表没有节流事件，只是这批点还没打
workspace 归属。想看某条路径的节流情况，只能按 `route` 过滤/`--group_by route`，暂时不能
按 workspace 拆开看。

```bash
cawplan metrics query \
  --domain cawplan_ticket --metric ticket_created \
  --start 2026-09-01T00:00:00Z --end 2026-09-10T00:00:00Z \
  --granularity day
```

- `--start`/`--end` **必须**是完整的 RFC3339 时间戳（比如 `2026-09-01T00:00:00Z`）。
- 不传 `--granularity` 默认是 `raw`（每个原始点都返回，不聚合）。想看"每天/每小时汇总"要显式加
  `--granularity day` 或 `--granularity hour`。
- 想按某个 tag 过滤，用 `--tag key:value`，可以传多个：
  ```bash
  cawplan metrics query --domain cawplan_workflow --metric execution \
    --start ... --end ... --tag status:failure
  ```
  `product` 是标准维度，同样可以当 tag 过滤，比如只看某个产品的数据：
  `--tag product:<product_unique_id>`。排查"同一个 ticket 是不是被重复写了"就用
  `--tag ticket_id:<ticket_unique_id>`。**`workspace_id` 是个例外**——它也是标准维度，
  但传 `--tag workspace_id:<xxx>` 不会有实际效果：后端总是把它强制覆盖成你自己登录后解析出来
  的 workspace（见上面"`query`/`ingest` 对接的是哪个后端接口"），传别的值会被忽略，不会报错，
  也查不到别的 workspace 的数据。
- 想按某个 tag 拆分成多条 series（而不是合并成一条汇总线），用 `--group_by`：
  ```bash
  cawplan metrics query --domain cawplan_subscription --metric upgrade \
    --start ... --end ... --granularity day --group_by from_plan,to_plan
  ```
- 只想看某个字段（默认四个字段 `value`/`count`/`cost`/`credit` 都返回），用 `--fields`：
  ```bash
  --fields value,count
  ```
- 返回结果里如果 `data.truncated` 是 `true`，说明命中的行数超过了上限（默认 5000 行），
  只返回了一部分——缩小时间范围或者加过滤条件，而不是把这部分结果当成完整答案。

## 我想把查询结果画成图表

`query` 命令默认只输出 JSON（完整的结构化 `data.rows`）。如果只是想在这次对话里看一眼趋势，
不需要额外加任何图表 flag——把 `data.rows` 原样带回去，图表由拿到数据的一方（比如 Claude Code
对话本身）直接根据这份结构化数据画/描述出来，不需要 CLI 再单独生成、也不需要落地成文件。

只有明确需要一个**独立文件**或**终端内嵌图片**时，才用下面这几个可选 flag：

`--chart <path>.svg` 把结果渲染成一个 SVG 折线图文件：

```bash
cawplan metrics query \
  --domain cawplan_subscription --metric upgrade \
  --start 2026-08-01T00:00:00Z --end 2026-09-01T00:00:00Z \
  --granularity day \
  --group_by from_plan,to_plan \
  --chart ./subscription-upgrade.svg \
  --chart-title "Subscription upgrades by plan"
```

- 每一种 tag 组合（比如每个 `from_plan`→`to_plan` 组合）会变成图上的一条线，跟 `--group_by`
  分组方式一致。`--chart-field` 指定画哪个字段，默认是 `value`（可选
  `value`/`count`/`cost`/`credit`）。
- 这个 SVG 是纯 JS 生成的（基于 d3-scale/d3-shape，没有走浏览器/canvas），在任何能跑 Node 的
  地方都能生成，生成后可以直接用浏览器或者任意图片查看器打开。
- 如果是在 Claude Code 会话里、想要一个内嵌的/可交互的图，而不是一个独立文件，改用
  `cawplan-metrics` skill 里说的 `dataviz` skill 交接方式，不要用 `--chart`。

如果想在 Claude Code 聊天里直接把图渲染出来看（`Read` 工具只认光栅格式，SVG 会被当成纯文本），
加 `--png <path>`：

```bash
cawplan metrics query \
  --domain cawplan_ticket --metric ticket_created \
  --start ... --end ... --granularity day \
  --png ./tickets.png --chart-title "Tickets created per day"
```

- SVG 始终是存储/可编辑的那份（矢量、体积小、方便再处理）；PNG 只是从同一份 SVG 现取现转的一次性
  展示产物，两者内容一致，不用分别维护两份图。
- 转换靠环境里已有的工具（macOS 用系统自带的 `qlmanage`，其他平台找 `rsvg-convert`），没有额外
  打包一个光栅化依赖进 CLI。如果两者都不可用，命令会报错退出并提示改用 `--chart` 拿 SVG，不会
  静默生成一个空/坏文件。
- macOS 的 `qlmanage` 缩略图固定是正方形画布，宽高比不是 1:1 的图会被留白（信封状），这是已知的
  外观限制，不影响图内容本身的正确性。
- 只在真正的终端里有意义的参数（见下面的 `--preview`）**在 Claude Code 聊天里不生效**：那是靠
  终端图片转义协议实现的，Claude Code 的 Bash 工具是把 stdout 当纯文本捕获、回显的，不是一个真
  终端在解码，所以会显示成一坨转义字符的乱码——在聊天里展示图表用 `--png` + 让对方读取那个文件。
- 实测发现：即使终端本身支持内联图片（比如 iTerm2，手动 `imgcat <path>.png` 能正常显示），
  Claude Code 用 `Read` 工具读同一个 PNG 文件也不一定能把图渲染到你的界面上——这是 Claude Code
  客户端这一层的显示问题，不是这个 CLI 生成的文件有问题。如果 `Read` 没能把图显示出来，退回到
  手动跑 `imgcat <path>.png`（或者你终端支持的其他图片查看方式）直接看这个文件，这条路径已验证
  是可靠的。

如果终端支持内嵌图片（iTerm2、Kitty，或者装了 `chafa`），加 `--preview` 可以直接在终端里看到
跟 `--chart` 生成的一样的矢量图，不用另外开文件（**只在真终端里有用，见上面的提示**）：

```bash
cawplan metrics query \
  --domain cawplan_ticket --metric ticket_created \
  --start ... --end ... --granularity day --preview
```

- 会按顺序尝试：iTerm2 自带的 `imgcat`（已验证直接支持 SVG，不需要先转成 PNG）→ Kitty 的
  `icat` → 系统里装了的 `chafa`（chafa 会自动识别当前终端支持哪种图片协议）。这几个都是
  外部工具，CLI 本身不内置任何图片渲染/转码逻辑——所有这些协议本质上都要栅格图，SVG 是没法
  直接塞进去的，chafa/imgcat 自己知道怎么转，CLI 不用再重复实现一遍、更不用因为这个引入原生
  依赖（跟当初选 SVG 而不是 PNG 的理由是一样的）。
- 如果这几个都没有（比如普通 xterm/tmux 里没装任何相关工具），会打印一句提示，改用 `--chart`
  或 `--png` 拿文件。

## 我想写入一条业务指标事件

```bash
# 单条事件的简写形式
cawplan metrics ingest \
  --domain cawplan_subscription --metric upgrade --value 1 \
  --dimensions '{"product":"<product_unique_id>"}' \
  --tags '{"from_plan":"basic","to_plan":"pro"}'

# 批量写入，一次传一个 JSON 数组
cawplan metrics ingest --items '[
  {"domain":"cawplan_subscription","metric":"upgrade","value":1,"tags":{"from_plan":"basic","to_plan":"pro"}},
  {"domain":"cawplan_subscription","metric":"renew","value":1}
]'
```

- `domain`/`metric` 必填，且只能是小写字母、数字、下划线（`^[a-z][a-z0-9_]*$`）。
- `value`/`count`/`cost`/`credit` 至少要传一个，不然这条事件没有意义会被拒绝。
- `--dimensions` 只认 `app`/`platform`/`product`/`plan`/`region`/`environment` 这六个标准字段，
  其余自定义标签放 `--tags` 里。**没有 `workspace_id`**——每条事件的 workspace 归属是后端从你的
  登录身份强制写入的，`--dimensions`/`--tags` 里传了也不认（见上面"`query`/`ingest` 对接的是哪个
  后端接口"）。
- 批量写入是"整批校验、要么都过要么都不写"——只要数组里有一条不合法，整批都会被拒绝，不会出现
  部分写入的情况。所以不适合拿来做历史数据批量补录/纠错，只适合"这一批确实同时发生的事件"。
- 这套存储是给报表/看板用的，**不是**权威数据源——像 token/credit 这种有财务含义的数据，真正
  的台账在别处，这里写的东西不能反过来当作对账依据。
- 写得太快会被限流（每分钟 180 次，按你的登录凭证算，见上面的对接说明）——批量导入大量历史事件
  时优先用 `--items` 一次传一个数组，而不是循环调用单条写入的简写形式。

## 常见问题

**为什么查出来是空的？** 最常见的原因是 `domain`/`metric` 拼错了——比如写成
`subscriptions`/`Upgrade` 之类，跟实际写入时用的字符串对不上，服务端不会报错，只会返回空结果，
看起来跟"这段时间确实没数据"一模一样。先确认拼写，再怀疑时间范围。

**`--group_by`/`--fields`/`--tag` 到底是逗号分隔还是重复传？** `--tag` 是重复传
（`--tag a:1 --tag b:2`）；`--group_by`/`--fields` 是逗号分隔的一个字符串
（`--group_by a,b`），CLI 内部会自动转换成后端要的重复参数格式，不用自己拼 URL。

**图表里横轴标签看起来很奇怪/挤在一起？** 时间跨度很短（几小时到几天）时，横轴会自动带上
具体时刻（比如 `9/1 04:00`）而不是只显示日期，避免同一天出现好几个刻度看起来像是重复的。

**`query` 报 `FAILURE_INVALID_INPUT`，说时间范围超限？** `--start`/`--end` 跨度超过了 186 天
（约 6 个月）的硬上限——这是请求本身被拒绝，不是"只返回部分结果"，缩小跨度重试，或者分成多次
按月/按季度查询再自己拼起来。

**`ingest` 突然收到 HTTP 429？** 触发了按调用凭证算的限流（每分钟 180 次），不是数据本身有问题。
等一分钟再重试；如果是批量导入场景，检查是不是在循环调用单条写入而不是用 `--items` 一次传数组。

## 更多参考

- `references/CAWPLAN_OPEN_API.md` §7 —— 完整接口字段说明
- `skills/cawplan-metrics/SKILL.md` —— 给 AI/skill 用的决策流程版本
- `docs/cawplan-ticket-metrics-collection.md`（另一个仓库 `uid.core-product`，非本仓库路径）
  —— `cawplan_ticket` 这个 domain 具体在什么时机写入、哪些情况会被抑制不写
