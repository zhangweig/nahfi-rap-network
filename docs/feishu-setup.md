# 把投稿审核搬到飞书

配好之后：网友在飞书表单投稿 → 你在手机上把「状态」改成`已通过` → 跑一条命令，内容就上线。
网站不再需要 7×24 开着的投稿接口，服务挂了也不会丢投稿。

整个流程只有一条命令要记：`npm run feishu:pull`。

---

## 一、建一个自建应用（约 5 分钟）

1. 打开 <https://open.feishu.cn/app>，右上角 **创建企业自建应用**，名字随意（例如 `说唱关系网审核台`）。
2. 进入应用 → 左侧 **权限管理** → 搜索 `多维表格` → 开通 **查看、评论、编辑和管理多维表格**（权限码 `bitable:app`）。
3. 左侧 **版本管理与发布** → 创建版本 → 申请发布。个人版飞书你自己就是管理员，直接通过即可。
4. 回到 **凭证与基础信息**，复制 `App ID` 和 `App Secret`。

> 没发布过的应用拿不到 token，第 4 步的密钥也是发布后才生效。

## 二、建多维表格并授权给应用（最容易漏的一步）

1. 飞书里新建一个空的多维表格，命名例如 `说唱关系网 · 数据`。
2. 看地址栏：`https://xxx.feishu.cn/base/`**`bascnABCDEFG`**`?table=tblxxxx`
   中间这段 `bascn...` 就是 **app_token**。
3. 右上角 **···** → **添加文档应用** → 选第一步那个应用 → 权限给 **可编辑**。

漏掉第 3 步会报 `1254040：应用没有这张多维表格的权限`。

## 三、填 .env

```bash
cp .env.example .env
```

```ini
FEISHU_APP_ID=cli_xxxxxxxx
FEISHU_APP_SECRET=xxxxxxxx
FEISHU_APP_TOKEN=bascnxxxxxxxx
FEISHU_TABLE_SUBMISSIONS=      # 下一步自动生成
VITE_FEISHU_FORM_URL=          # 第五步填
```

`.env` 已在 `.gitignore` 里，不会被提交。

## 四、建表

```bash
npm run feishu:init
```

它会列出你表格里现有的数据表，没有就创建一张「投稿审核」，20 列全部建好（文本 / 单选 / 数字 / 日期 / 超链接都按语义设好类型），最后打印：

```
FEISHU_TABLE_SUBMISSIONS=tblxxxxxxxx
```

复制这一行到 `.env`。之后如果改过表结构，用 `npm run feishu:init -- --ensure-fields` 补齐缺的列。

## 五、做表单视图

在「投稿审核」表里：

1. 右上 **+ 添加视图** → 选 **表单**，命名「投稿」。
2. 表单里只保留这些字段：
   `类型` `标题` `城市` `别名` `简介` `头像` `起点` `终点` `关系类型` `年份` `来源标题` `来源链接` `证据说明` `投稿人` `备注`
3. 在表单设置里把 **状态** 的默认值设为 `待审核`（状态列本身不要在表单里显示）。
4. 右上 **分享** → 打开 **分享表单** → 复制链接，填进 `.env` 的 `VITE_FEISHU_FORM_URL`。

配了这个链接后，网站上的「投稿」按钮会打开飞书表单；没配则继续用站内表单，不会报错。

## 六、验证

```bash
npm run feishu:check
```

逐项检查凭证、表格权限、字段完整性、每行 JSON 是否可解析：

```
✓ 应用凭证已配置（app_id: cli_ab12…）
✓ tenant_access_token 获取成功
✓ 可访问多维表格，共 1 张数据表
✓ 数据表「投稿审核」 tblxxxxxxxx
✓ 字段完整（20 列）
✓ 共 12 行投稿：待审核 3 · 已通过 8 · 已退回 1
✓ 每行「数据」列都是合法 JSON
✓ 表单链接已配置，网友投稿直接进飞书
```

## 七、日常使用

| 你要做的事 | 怎么做 |
|---|---|
| 审核 | 打开飞书（手机也行）→「投稿审核」→ 把 `状态` 改成 `已通过` |
| 退回 | 改成 `已退回`，在 `审核意见` 写原因 |
| 上线 | `npm run feishu:pull && npm run build` |
| 先看看会写什么 | `npm run feishu:pull -- --dry-run` |
| 有坏数据就想让命令失败 | `npm run feishu:pull -- --strict` |

`feishu:pull` 会：

1. 只取 `状态 = 已通过` 的行；
2. 写入 `src/data/community-approved.json`；
3. 重建 `server/generated/base-data.json`，让本地 `npm run dev` 立刻看到。

## 八、表里怎么填

**一列两用**：`标题` 在人物投稿里是艺名，在关系投稿里是关系说明。

**起点 / 终点**：填艺人名就行（`马思唯`），拉取时会自动换成 id；填 id 也认。名字在人物库里找不到时会跳过并在终端说明。

**每条都必须有来源**：`来源标题` + `来源链接` 缺一不可，链接不能是网站首页。这是唯一一条硬性要求。

**`数据` 列不要手改**。它是完整 JSON，程序以它为准；这一列为空时才回退去读拆开的列。表单里建议直接隐藏它。

## 九、定时自动拉取（可选）

不想每天手动跑，就交给 GitHub Actions。在仓库 Secrets 里配好四个 `FEISHU_*`，加一个 `.github/workflows/pull-feishu.yml`：

```yaml
name: pull-feishu
on:
  schedule: [{cron: '0 1 * * *'}]
  workflow_dispatch:
jobs:
  pull:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {node-version: '24'}
      - run: npm ci
      - run: npm run feishu:pull
        env:
          FEISHU_APP_ID: ${{ secrets.FEISHU_APP_ID }}
          FEISHU_APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
          FEISHU_APP_TOKEN: ${{ secrets.FEISHU_APP_TOKEN }}
          FEISHU_TABLE_SUBMISSIONS: ${{ secrets.FEISHU_TABLE_SUBMISSIONS }}
      - run: npm run build
      - uses: stefanzweifel/git-auto-commit-action@v5
        with:
          commit_message: 'chore: sync approved submissions from feishu'
```

## 十、报错对照

| 报错 | 原因 |
|---|---|
| `1254040` | 应用没被加为多维表格协作者，回第二步第 3 点 |
| `1254005` | `FEISHU_APP_TOKEN` 填错，它来自 `/base/` 后面那段 |
| `1254302` | 表不存在，重跑 `npm run feishu:init` |
| `99991663` | `APP_ID` 与 `APP_SECRET` 不配对 |
| `1254060` | 缺列，跑 `npm run feishu:init -- --ensure-fields` |
| 行被跳过：「起点…找不到」 | 起点写的是名字但库里没这个人，先通过该人物的投稿 |
