# 头像补全工作流

全库 327 位人物只有 24 张真实头像，其余用程序化丝网印剪影占位（`src/lib/portrait.ts`）。
补图的目标不是"抓得快"，而是"认得准"——一张认错人的合影比一张体面的剪影难看得多。
所以整套流程的核心不是抓取，而是**用联络表一次性肉眼验收**。

## 数据源

`--source` 控制，默认 `auto`：

| 源 | 说明 | 许可 |
|---|---|---|
| `ncm` | 网易云艺人页头像位，宣传照居多，但最容易被 406 限流 | 无开放许可，需标注来源 |
| `qq` / `qqmusic` | 搜索结果拿 `singer.mid`，按官方规则拼 `T001R800x800M000<mid>.jpg` | 无开放许可 |
| `kugou` | 歌手搜索拿 `singerid`，`singer/info` 直接返回头像 URL | 无开放许可 |
| `wiki` | Wikimedia Commons，可追溯性最好 | 有明确许可 |
| `deezer` | 兜底；`picture` 大量是厂牌封面/logo，误判率高 | 无开放许可 |

`auto` 会按顺序尝试：`ncm → qq → kugou → wiki → deezer`。网易云限流后只禁用 `ncm` 一个源，不会挡住后面的平台。

三个源都按"名字规范化一致 + 专辑名交叉验证"判置信度：`high`=专辑能对上，`medium`=只有名字对上，需人工确认。

## 不要联络表：全自动落盘

如果确定不要肉眼验收，直接跑：

```bash
node scripts/fetch-avatars.mjs --write --source ncm --auto --retry
```

`--auto` 会让网易云 `medium` 命中也直接下载到 `src/assets/avatars/<id>.jpg`，不再写进“需人工确认”。代价是同名艺人/宣传照/合影可能认错人；网易云限流时未命中的人会保留原占位，稍后重跑同一条命令即可续抓。

## 补齐全站 327 个节点（--pool）

抓取脚本默认只跑 `src/data/catalog.json` 的 51 位，但网站实际渲染 `server/generated/base-data.json` 的 327 个节点。补漏用：

```bash
# 只补 base-data 里本地还没有头像的真实艺人（跳过厂牌/组合节点）
node scripts/fetch-avatars.mjs --write --pool missing --source auto --auto
```

- `--pool catalog`（默认）：旧的 51 位；`--pool base`：全部 327 节点；`--pool missing`：只补没头像的。
- `missing` 会跳过 `kind=group` 的厂牌/组合——它们没有“艺人头像”，搜到的多是 logo。
- 网易云限流后只禁用 ncm 一个源，QQ/酷狗继续；若整批卡在限流窗口，等一会儿重跑即可。
- QQ 对冷门歌手会返回 mid 但图片 404，脚本用 HEAD 校验后自动放弃、转酷狗兜底。
- 网宿代理对酷狗域名返回错配证书，脚本已从 env 读代理并关闭证书校验；酷狗 JSON 被 `<!--KG_TAG-->` 包裹，解析时已剥离。
- 实测结果：艺人头像覆盖 263/282；剩余十几位是平台方无图/下架（QQ 有艺人条目但头像全 404），不是脚本问题。

## 三步走

### 1. 抓候选 + 生成联络表（预演，不落盘）

```bash
node scripts/fetch-avatars.mjs --retry --source ncm --sheet
```

- `--retry`：忽略台账里的旧图与被否决记录，用当前数据源重新抓（换源时必须加）。
- `--sheet`：把候选图缩到 200px 存到 `research/avatars-candidates/`，生成 `research/avatars-sheet.html`。
- 网易云对高频请求返回 406「操作频繁」，脚本已内置 1.5s 节流 + 指数退避重试，跑 51 位约 2-4 分钟。

### 2. 扫联络表，标出错图

用浏览器打开 `research/avatars-sheet.html`：8 列网格，每格是大号序号 + 名字 + 置信度 + 来源链接。

- **单击**格子 = ✓ 采用（中置信候选也允许落盘）
- **右键**格子 = ✗ 否决（写进台账，以后不再抓这个人）
- **Shift+单击**或点 `1:1` = 改用网易云 1:1 头像位（`picUrl` 常是横图时不合适）
- 底部实时生成命令，点「复制命令」

宁缺毋滥：只要是**多人合影、专辑封面、logo、插画、亮度不足**，一律右键否决，退回剪影占位。

### 3. 按生成的命令落盘

```bash
# 命令由联络表底部生成，形如：
node scripts/fetch-avatars.mjs --write --source ncm --accept=ma,bridge --skip=gai --alt=psyp
```

高置信 + 被 `--accept` 认可的会下载到 `src/assets/avatars/<id>.jpg`；被 `--skip` 的写进台账永久记住。
最后重建缩略图（首屏走廊飞卡用的是 160px 缩略图，避免拉原图）：

```bash
npm run thumbs
```

## 人工补图（完全不用改代码）

`PixelAvatar.tsx` 的绑定规则只有一条：**文件名 = node.id**。
所以手动补一张图只要三步：下载 → 改名成 `<id>.jpg` → 丢进 `src/assets/avatars/`。
不改 JSON、不改数据管线、不需要审核。最后跑一次 `npm run thumbs`。

只有想用**外部 URL** 而不是本地文件时，才走 xlsx / 飞书的「头像」列（那条管线也已通）。

## 溯源与版权

`research/avatars.json` 逐条记录 `source` / `imageUrl` / `pageUrl` / `fetchedAt`，被否决的还记 `review` 和 `reviewNote`。
网易云、Deezer 的艺人图是平台或厂牌上传的宣传照，**没有开放许可**。存档规模从 24 张扩到 200 张时性质会变，
至少要保持"只存缩略图、标注来源、不做二次分发"。团体/厂牌节点建议走几何标识，不要硬塞人脸照。
