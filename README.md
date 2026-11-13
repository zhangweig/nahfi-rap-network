# NAHFI RAP NETWORK · React Alpha 0.4

中文说唱人物、作品与关系档案。使用 **react-force-graph** 渲染 2D / 3D 图谱，使用 **Graphology** 计算关系路径。

## 本地运行

需要 Node.js 20.19+ 或 22.12+。

```bash
npm ci
npm run dev
npm run check:data
npm run build
```

打开 Vite 输出的本地地址。图谱与作品数据均随项目提供，浏览不需要 API Key，也不需要实时调用外部音乐服务。

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
- `scripts/check-network.mjs`：身份、作品来源、关系、搜索与路径检查。
- `research/`：只读来源缓存、曲目清单与核对说明。

## 验证

`npm run check:data` 验证唯一 ID、作品端点、艺人身份白名单、原始曲名与日期、同曲关系数量、城市/类型路径约束、简繁体搜索与画布聚合。

`npm run build` 执行 TypeScript 检查及生产构建。当前仍有单个产物超过 500 kB 的 Vite 提示，主要来自 3D 渲染依赖；构建可以完成。

本次未新增运行时依赖；目录采集使用 Python 标准库，简体检索别名使用 Windows 内置中文映射。继续沿用现有图谱与算法库：

- [react-force-graph](https://github.com/vasturiano/react-force-graph)：MIT。
- [Graphology](https://github.com/graphology/graphology)：MIT。
