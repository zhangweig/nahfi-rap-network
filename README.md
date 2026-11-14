# NAHFI RAP NETWORK · 像素地图 Alpha 0.5

中文说唱人物、作品与关系档案。34 个省级行政区聚落组成的自绘 SVG 关系网，**Graphology** 负责关系路径计算。

在线浏览：**https://zhangweig.github.io/nahfi-rap-network/** —— GitHub Pages 静态托管。地图 / 人物 / 作品 / 路径查找不需要后端；投稿与站长审核依赖独立 API，配置 `VITE_API_BASE` 后自动启用，未配置时页面退回只读浏览并隐藏相关入口。部署步骤见 [投稿 API 部署](docs/api-deploy.md)。

## 本地运行

需要 Node.js 24+（服务端使用内置 SQLite）。

```bash
npm ci
npm run dev
npm run check:data
npm run test:server
npm run build
```

打开 Vite 输出的本地地址（通常为 http://localhost:5173）。`npm run dev` 同时启动前端和 8787 端口的数据服务。图谱与作品基础数据随项目提供，浏览不需要 API Key。开发时修改基础数据后需重启完整开发服务。

构建后可用 `npm start` 在 http://localhost:8787 同时预览页面与审核 API。仅运行 `npm run dev:web` 或静态部署只能浏览基础资料；没有服务端就不能提交或审核。


## 像素地图与投稿审核

- 地图、人物占位头像、导航、作品卡、表单与审核台采用统一像素风。地图人物位置固定，沿用 react-force-graph 渲染；Graphology 继续负责路径计算，没有自定义节点物理引擎。
- 已知城市人物以城市坐标固定排列；移动端选中人物后放大定位。未知城市或没有坐标的城市保留在“城市待补充”。组合档案在人物名录与关系网络中保留，地图展示个人音乐人。
- 顶部“添加人物”、工具栏“添加关系”、档案铅笔和关系铅笔均进入投稿流程。游客可新增或编辑人物、补充或编辑关系；所有投稿默认 `pending`。
- 页脚“站长审核”通过密钥登录。可查看来源、编辑前后差异、批准或填写原因退回。只有批准的内容进入公共 API、搜索、名录、地图、作品库和导出；访客每 30 秒或重新聚焦页面同步公开资料。
- 第一次本地启动自动生成 `.data/owner-key.txt`。打开文件、复制密钥、在审核台登录。密钥不会写进前端，队列和审核操作都由服务端鉴权；退出、过期或重启后需重新登录。
- 待审、批准、退回与审核日志存放在 `.data/community.sqlite`；经审核的记录覆盖基础数据，不改写原始 `seed.ts` / `catalog.json`。编辑版本冲突和重复审核会被拒绝，防止旧投稿覆盖新内容。
- 输入必须包含具体 HTTPS 资料页和证据说明；歌曲合作和幕后制作需具体作品名称、版本和年份。审核者需核对证据，系统不自动判断来源事实真假。

### 自己替换头像

把头像放入 `public/avatars/`，例如 `public/avatars/yitai.png`。在人物编辑表单里将“像素头像地址”填为 `/avatars/yitai.png`，提交并批准即可。建议 64×64 / 128×128 透明 PNG；同一地址同步用于地图、人物名录和详情，也支持 HTTPS 图片地址。留空或加载失败使用占位图。详见 [头像说明](public/avatars/README.md)。

### 数据备份与本地边界

运行 `npm run backup` 使用 SQLite 在线备份 API，把完整数据库快照保存到 `.data/backups/`。恢复时先停服务，将选定快照复制为 `community.sqlite`，移走旧库对应的 `-wal` / `-shm` 后再启动。先保留旧数据备份；头像文件也应单独备份。`.data/` 与 `.env` 均已加入 Git 忽略规则。

线上后端有两种形态：跑 `server/` 的 Node 服务，或部署 `worker/` 到 Cloudflare Workers + D1（见 [投稿 API 部署](docs/api-deploy.md)）。两者共用 `server/domain.mjs` 的校验规则，前端只需把 `VITE_API_BASE` 指过去。Node 方案需要持久化磁盘、HTTPS 反向代理、`NODE_ENV=production`、准确的 `PUBLIC_ORIGIN` 和独立 `ADMIN_PASSWORD`（至少 16 字符），参考 `.env.example`；是单进程 SQLite，多个实例不能各自使用独立数据文件。Workers 方案把存储换成 D1、鉴权换成 8 小时有效的 Bearer token（跨站请求带不住 SameSite cookie），其余行为一致。

内置同源 POST 检查、HttpOnly / SameSite 会话、生产 Secure cookie、输入和体积限制、投稿与登录频率限制。开发环境限速按直连 IP；反向代理上线时应配置边缘限流。审核列表展示最近 500 条，日志展示最近 100 条，完整历史保留在 SQLite；大规模运营时需扩展分页、账号与反滥用机制。

### 技术与许可

运行时没有新增依赖。现有 React、react-force-graph 与 Graphology 已满足界面和图算法需求；服务端使用 Node.js 内置 HTTP / Crypto / SQLite（Node 24 中 SQLite 仍有实验性提示）；Workers 版复用同一套 `node:crypto` 兼容接口。开发依赖里新增 `wrangler`，只用于部署 `worker/`。未引入 Express、外部 ORM 或第三方鉴权库。[Node SQLite 文档](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)。

地图陆地几何取自 [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/) 公共领域数据，许可允许复用；像素植被、山地、水系与建筑为装饰示意，不是测绘数据。处理说明见 [地图说明](public/map/README.md)。

## 本次验证

`npm run check:data` 检查原有资料、图谱和作品；`npm run test:server` 覆盖待审隔离、批准/退回、持久化、权限、CSRF、会话撤销、无效资料、重复审核和冲突。`npm run build` 执行类型检查、前端构建及服务端基础数据生成。3D 页面按需加载，较大的 3D 分块仍有 Vite 体积提示。

## 当前内容与功能

- **51 位音乐人、3 个团体、337 个作品版本、427 条关系记录**。
- 2D / 3D 图谱、城市与关系类型筛选、最短关系路径。
- Rapper 名录：艺名与别名检索，点击定位图谱。
- 作品库：歌名、专辑、艺人搜索；支持简体检索繁体曲名、版本筛选、年份排序和分页。
- 艺人档案：个人作品、关联记录、原始署名、可点击来源和证据说明。
- 同一对人物的多条关系在画布聚合为连线，原始作品与证据逐条保留；图谱默认显示 246 组连线。
- 支持桌面与手机布局，JSON 导出包含人物、作品与关系。

## 数据边界

资料核对日期：2026-11-13。`verified` 表示所引来源支持这条具体记录，不代表历史成员关系持续有效。

成员身份、历史归属与歌曲合作分别建模：Higher Brothers 的成员证据为 2018 年访谈；C-BLOCK 为 2022 年访谈；GO$H 为 2017 年历史关联资料。资料年份不是入团或离团年份，不从合作、同台或节目组队推定厂牌身份。尚无可靠制作署名的关系不填入“幕后制作”。

新增曲目来自 Apple 公开发行目录，按明确的艺人 ID 和别名核对。同名搜索结果、伴奏及无法匹配身份的条目不会直接导入。多人作品产生多个“同曲署名”关系，但作品统计只算一个版本；这不等于两位歌手单独合作，更不表示现实私交。团体署名不自动展开为全部成员。

作品年份是所引平台版本日期，可能是再版日期，不保证是歌曲首发年份。保留平台原始字形与完整署名；来源链接的可用性可能因地区不同而变化。城市表示有来源支持的关联地域，不必然是出生地或现居地；未核验的地域标为“未标注”。

详细来源、身份白名单、原始元数据和可复现导入流程见 [数据核对说明](research/README.md)。

## 项目结构

- `src/App.tsx`：图谱、导航、筛选、人物详情。
- `src/components/CatalogPanel.tsx`：人物名录、作品库与作品卡片。
- `src/data/types.ts`：人物、作品、关系与证据类型。
- `src/data/seed.ts`：原有人工核对的成员、历史关系和作品。
- `src/data/catalog.json`：本批整理的艺人与作品元数据。
- `src/data/rap-data.ts`：整合数据并生成同曲署名关系。
- `src/lib/catalog.ts`：搜索与画布连线聚合。
- `src/lib/network.ts`：Graphology 多重图与路径计算。
- `server/`：本地投稿审核服务（Node HTTP + SQLite），`domain.mjs` 是两端共用的校验与合成规则。
- `worker/`：Cloudflare Workers 版 API（D1 存储 + Bearer token），供线上页面调用。
- `scripts/check-network.mjs`：身份、作品来源、关系、搜索与路径检查。
- `research/`：只读来源缓存、曲目清单与核对说明。

## 验证

`npm run check:data` 验证唯一 ID、作品端点、艺人身份白名单、原始曲名与日期、同曲关系数量、城市/类型路径约束、简繁体搜索与画布聚合。

`npm run build` 执行 TypeScript 检查及生产构建。3D 已独立为按需加载分块；作品元数据主包和 3D 分块仍可能出现超过 500 kB 的 Vite 提示，构建可以完成。

本次未新增运行时依赖；目录采集使用 Python 标准库，简体检索别名使用 Windows 内置中文映射。继续沿用现有图谱与算法库：

- [react-force-graph](https://github.com/vasturiano/react-force-graph)：MIT。
- [Graphology](https://github.com/graphology/graphology)：MIT。
