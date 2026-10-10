# CawPlan 知识库使用指南

`cawplan knowledge` 是命令行下的 CawPlan 知识库工具，可以搜索、浏览、上传/管理知识库里的资料。
这份文档按"你想做什么"来组织，不需要先记住所有参数——照着你要做的事找到对应的命令就行。

## 开始之前

先确认自己能正常访问：

```bash
cawplan skill check
```

如果这一步报错，说明还没登录或没有权限，先联系管理员或按提示登录。

## 最简单的用法：交互式浏览

不想记命令的话，直接跑：

```bash
cawplan knowledge browse
```

会依次出现：选数据集 → 选文档（选中时能看到开头内容预览）→ 浏览这份文档的目录。用方向键选、回车
看内容、Esc 返回上一级；看完一节想换另一节，Esc 回到目录接着选。

如果已经知道要看哪份文档，也可以跳过前两步，直接进它的目录（数据集/文档 ID 怎么查见下文）：

```bash
cawplan knowledge documents get --dataset <数据集ID> --document <文档ID> -i
```

## 我想搜索知识库里的内容

```bash
cawplan knowledge search --query "你想找的内容"
```

默认会搜你能访问的全部数据集。如果已经知道要在哪个数据集里找，加上：

```bash
cawplan knowledge search --query "你想找的内容" --dataset <数据集ID>
```

注意：搜索返回的是匹配到的片段，不是整篇文档——如果你确定某份文档里有你要的内容，但搜索总是找不
到，直接去看那份文档的完整内容或目录（见下面两节），比反复换搜索词更管用。

## 我想看某个数据集里有哪些文档

先查有哪些数据集：

```bash
cawplan knowledge datasets list
```

再看某个数据集下的文档列表：

```bash
cawplan knowledge documents list --dataset <数据集ID>
```

文档比较多的话可以加关键词过滤：`--keyword "文档名里的关键词"`。

## 我想看一份文档的完整内容

```bash
cawplan knowledge documents get --dataset <数据集ID> --document <文档ID>
```

文档很长、只想看其中一节的话，先看目录：

```bash
cawplan knowledge documents get --dataset <数据集ID> --document <文档ID> --outline
```

找到想看的标题后：

```bash
cawplan knowledge documents get --dataset <数据集ID> --document <文档ID> --section "标题关键字"
```

也可以把整份内容存成本地文件，加上 `--output 文件路径` 即可。

## 我想新建一个知识库/上传资料

新建数据集：

```bash
cawplan knowledge datasets create --name "数据集名称"
```

数据集和 CawPlan 产品有两种关系：

- **归属（owner）**：建库时加 `--owner-product <产品ID>`，数据集直接归这个产品所有。只有归属了产品
  的数据集，它里面的文档才能放进该产品 module tree（`product_modules`）下的模块里。
- **关联（link）**：建库时加 `--product <产品ID>`（可重复传多个），把数据集关联到这些产品（限定该
  产品可见/可被产品范围内的知识搜索检索到）。关联不等于归属。

两者可以同时用，例如既归属又关联同一个产品：

```bash
cawplan knowledge datasets create --name "数据集名称" --owner-product <产品ID> --product <产品ID>
```

也可以不记 ID，直接加 `-i`（`--interactive`）走交互模式：没传 `--owner-product`/`--product` 时
让你从菜单里选一个产品，选中的产品既作为归属产品、也会被关联：

```bash
cawplan knowledge datasets create --name "数据集名称" -i
```

模块不再挂在数据集上，而是挂在**文档**上（见下文上传时的 `--module` 和 `documents set-module`）。

给已存在的数据集补充/修改关联的产品，用：

```bash
cawplan knowledge datasets products get --dataset <数据集ID>
cawplan knowledge datasets products set --dataset <数据集ID> --product <产品ID>
```

`products set` 是整体覆盖（不是追加），不传 `--product` 就是解绑所有关联产品。

查看某个产品的模块树和按产品/模块筛选数据集：

```bash
cawplan knowledge datasets modules --product <产品ID>          # 列出该产品的模块树（id/parent_id/name/knowledge）
cawplan knowledge datasets modules --product <产品ID> -i        # 交互式从菜单里选一个
cawplan knowledge datasets list --product <产品ID>              # 该产品归属 + 关联的全部数据集
cawplan knowledge datasets list --product <产品ID> --module <模块ID>   # 只看该产品归属的、且在这个模块下至少有一篇文档的数据集
```

模块树里每个节点的 `knowledge` 列出的是在该节点下至少有一篇文档的数据集。

新建模块（可以用 `--parent` 挂到某个已有模块下面做子模块，不传则是顶层模块；模块树最多 5 层）：

```bash
cawplan knowledge modules create --product <产品ID> --name "模块名称"
cawplan knowledge modules create --product <产品ID> --name "子模块名称" --parent <上级模块ID>
cawplan knowledge modules list --product <产品ID>               # 与 datasets modules 输出相同
```

返回的 `data.id` 就是新模块的 ID，可以直接用在 `documents upload --module` 上。

上传文件（PDF/Word/Markdown 等）：

```bash
cawplan knowledge documents upload --dataset <数据集ID> --file 文件路径
```

可以多次加 `--file` 一次上传多份文件。上传前会先按文件名查一下数据集里是否已有同名文档，如果有
就默认跳过（提示改用 `documents update`），避免建出重复文档；确实要建一份同名的重复文档，加
`--force`。上传文件是异步处理的（服务端要转换格式、建索引），命令会等处理完再返回，文件大一点会
久一些，属于正常现象。不想等的话加 `--no-wait`，之后用返回的任务 ID 查进度：

```bash
cawplan knowledge documents job-status --dataset <数据集ID> --job <任务ID>
```

如果只是想把一段文字/笔记存进去而不是上传文件，用 `--text-file 本地文本文件路径` 代替 `--file`，
这种方式立即完成，不用等待。

想把上传的文档直接放进某个模块，加 `--module <模块ID>`（`--file` 和 `--text-file` 都支持，本次上传
的每份文档都会放进这个模块）。模块必须属于该数据集的归属产品（即建库时用了 `--owner-product`），
否则接口会返回 `BAD_REQUEST`：

```bash
cawplan knowledge documents upload --dataset <数据集ID> --file 文件路径 --module <模块ID>
```

已经上传的文档想换模块或移出模块，用 `documents set-module`（`--module` 和 `--clear` 二选一）：

```bash
cawplan knowledge documents set-module --dataset <数据集ID> --document <文档ID> --module <模块ID>
cawplan knowledge documents set-module --dataset <数据集ID> --document <文档ID> --clear   # 移出模块
```

`documents list` 返回的每份文档也会带上 `display_id`（如 `KBD-00001`）、`module_id`、`module_name`。

## 我想编辑一份已经上传的文档

已知数据集 ID 和文档 ID（`documents list` 能查到）时，用 `documents update` 代替
`documents upload`——语义和上传一致（`--file` 走文件、`--text-file` 走纯文本），区别是它更新的是
已有文档而不是新建一份：

```bash
cawplan knowledge documents update --dataset <数据集ID> --document <文档ID> --text-file 本地文件路径
```

`--file` 方式和上传一样是异步的，默认会等处理完；不想等就加 `--no-wait`。

## 我想把整个仓库的 Markdown 文档批量同步到知识库

单份上传适合零散资料；如果是把一个仓库里所有 `.md` 文件整体同步成一个数据集（新文件自动新建、
改过的文件自动更新、没改的跳过），用仓库自带的 `scripts/sync-knowledge.sh`：

```bash
scripts/sync-knowledge.sh            # 正式同步
scripts/sync-knowledge.sh --dry-run  # 先看会发生什么，不真正调用 API
```

数据集名称默认用仓库目录名；想指定别的名字，用 `KNOWLEDGE_DATASET_NAME` 环境变量：

```bash
KNOWLEDGE_DATASET_NAME="自定义数据集名" scripts/sync-knowledge.sh
```

解析数据集时会优先按 `KNOWLEDGE_DATASET_NAME` 指定的名字查；如果查不到，且这个名字跟仓库目录名
不一样，会再按仓库目录名查一次，两个都查不到才会新建数据集——这样即使之前是按仓库名建的库，后来
才开始传自定义名字，也不会因为查不到而重复建库。

首次同步、需要新建数据集时，可以加 `KNOWLEDGE_DATASET_PRODUCT_ID`：新库会以该 CawPlan 产品为
**归属产品**创建（对应 `datasets create --owner-product`），同时也**关联**到这个产品（对应
`--product`，保持原来产品范围内知识搜索的行为），见上文。再加 `KNOWLEDGE_DATASET_MODULE_ID`，脚本
每次上传新文档（`documents upload`）时都会带上 `--module`，把新文档放进该模块（模块 ID 怎么查见上
文 `datasets modules --product <产品ID>`）。模块必须属于数据集的归属产品，所以通常要和
`KNOWLEDGE_DATASET_PRODUCT_ID` 一起用：

```bash
KNOWLEDGE_DATASET_PRODUCT_ID=<产品ID> scripts/sync-knowledge.sh
KNOWLEDGE_DATASET_PRODUCT_ID=<产品ID> KNOWLEDGE_DATASET_MODULE_ID=<模块ID> scripts/sync-knowledge.sh
```

`KNOWLEDGE_DATASET_PRODUCT_ID` 只在新建数据集那一刻生效，对已经存在的数据集不会自动改归属/关联；
已存在的库想改关联产品，用上文的 `cawplan knowledge datasets products set`。
`KNOWLEDGE_DATASET_MODULE_ID` 只作用于新上传的文档，已同步过的文档在更新（`documents update`）时
不会被移动；想调整已有文档的模块，用上文的 `cawplan knowledge documents set-module`。

给脚本本身传 `-i`/`--interactive`（只在数据集还不存在时生效，已存在则忽略）即可在建库时交互式
选产品（选中的产品作为归属产品并同时关联），不用手动设 `KNOWLEDGE_DATASET_PRODUCT_ID`：

```bash
scripts/sync-knowledge.sh -i
```

这会不捕获输出地跑一次 `cawplan knowledge datasets create --name "<数据集名称>" -i`（CLI 自带的
选择器需要一个真正的终端），你会看到产品菜单（没有模块菜单，模块请用 `KNOWLEDGE_DATASET_MODULE_ID`
指定）；脚本随后用一次单独、可捕获的按名字查询来
拿到新数据集的 id。脚本其余的调用都保持非交互；后续自动化/CI 运行跳过 `-i`，改用上面的环境变量。

同步进度和数据集 ID/文档 ID 的映射记在仓库根目录的 `.knowledge-sync-state.json` 里，建议提交进
版本库，这样其他人或 CI 跑同一个脚本时不会重复上传。这个脚本不处理删除——本地删掉某份 `.md` 不
会连带删除/归档知识库里对应的文档，需要的话手动处理。

## 常见问题

- **上传或搜索报错、没反应**：先跑一遍 `cawplan skill check` 确认权限正常。
- **一次只能选一种方式看文档**：`--outline`、`--section`、`--grep`、`-i`（交互模式）不能混用，选
  一种就好；什么都不加就是看全文。
- **交互式浏览（`-i` 或 `browse`）必须在真正的终端里用**——通过脚本或自动化调用这个命令时，交互
  模式没法工作，改用 `--outline`/`--section` 换取同样的信息。

## 更多参考

- 完整参数、返回格式、缓存行为等实现细节：底层 HTTP API 见 `references/CAWPLAN_OPEN_API.md` 第
  12 节。
- 如果你是通过 Claude Code 这类 AI 助手使用知识库（而不是自己敲命令），助手内部遵循的浏览/展示
  规则见 `SKILL.md`，不需要你了解这些细节。
