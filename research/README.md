# 曲目目录核对记录

核对日期：2026-11-13。当前版本合计 51 位音乐人、3 个团体、337 个作品版本、427 条关系记录。

## 来源与取舍

- `catalog/`：Apple 公开 Search API 的只读查询缓存，记录查询 URL、时间、曲目 ID、主艺人 ID、完整艺人字段、曲名、专辑与版本日期；未下载音频、歌词或封面。
- `catalog-manifest.json`：本批导入的 329 个平台曲目 ID。另 8 个原有人工核对版本保留在 `src/data/seed.ts`。
- `catalog-review.txt`：按人物整理的可审阅清单；一个多人作品会出现在多位艺人下，但作品统计只计算一次。
- `scripts/curate-catalog.py`：明确的艺人 ID 与别名白名单。只接受主艺人 ID 已确认的记录，再对具体作品中的主艺人及 feat. 署名做精确匹配。未知客串保留原始署名，不猜测身份。

搜索会混入同名歌手、标题或古典音乐。例如“小精灵”会检索到 TFBOYS 的同名歌曲，“Pharaoh”会检索到无关角色和海外艺人。身份白名单与原始记录测试会排除这些结果。孟子、于意和福克斯的本批搜索结果未完成可靠身份匹配，因此没有直接导入。

若歌曲只署名一个团体，不将团体全部成员扩展为合作方。Higher Brothers 与单个成员共同出现在平台艺人字段时，人物合作图只连接明确的个人署名。节目 cypher 与多人合唱按同一版本的共同署名建立两两关系；这不等于两人单独合唱，更不代表私交或厂牌成员身份。画布按人物对与关系类型聚合，原始作品关系全部保留。

`year` / `releaseDate` 是所引用平台版本的日期，可能为重新发行日期；不宣称是歌曲首次发表年份。只在题名或专辑明确标注 Live / 现场、节目现场专辑时标为现场版，明确标注 Remix 时标为混音版，其余标为“发行版”。原有人工核对的录音室版继续保留。

原文曲名保留平台字形；简体检索别名由 Windows 内置中文映射生成，避免为此增加运行时依赖。海外地区目录可能与中国大陆目录不同，用户点击来源时的可用性取决于平台地区。

## 可复现流程

```powershell
python scripts/fetch-catalog.py
python scripts/curate-catalog.py
npm run check:data
npm run build
```

抓取脚本使用 Python 标准库，限速低于 Apple 文档的约 20 次/分钟；已存在的缓存不会重新请求。刷新后必须审阅生成的清单，特别留意身份、同名作品、版本和异常日期。生成脚本在 Windows 上构建简体搜索别名，其他系统保留原文。

## 核对样例

- [Apple 官方 Search API 文档](https://performance-partners.apple.com/search-api)
- [《一代》多人署名](https://music.apple.com/tw/song/1644810471)
- [《發光彈》feat. 署名](https://music.apple.com/tw/song/1664653067)
- [《Uh》四人署名](https://music.apple.com/tw/song/1653065875)
- [杨和苏地域资料](https://music.apple.com/cn/playlist/杨和苏keyng代表作/pl.a4c935a139cc449aa2fd4718afec820f)
- [GALI 地域资料](https://music.apple.com/hk/playlist/gali-代表作/pl.b61bebde7d8a4f2d9f40cf669741016a)

每首作品与人物的直接来源链接也保存在应用数据中。未取得可靠地域来源的艺人标为“未标注”，不从合作圈层推断城市。成员关系仍仅使用原有的有年份访谈资料，没有由发行作品推断新的厂牌归属。
