/**
 * 把当前网站数据导出成一份可编辑的 xlsx。
 * 数据源是 build 产物（含所有人工编辑），所以导出看到的就是线上真实状态。
 */
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import XLSX from 'xlsx';
import {buildData} from './build-data.mjs';
import {
  ARTIST_COLUMNS, RELATION_COLUMNS, KIND_LABEL, RELATION_LABEL, RELATION_SOURCE_DERIVED,
  STATUS_ACTIVE, SHEET_README,
} from './sheet-schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = resolve(ROOT, process.env.SHEET_FILE || 'data/nahfi-rap-data.xlsx');
const SNAPSHOT = resolve(ROOT, 'server/generated/base-data.json');

await buildData();

const {nodes, relations} = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const nameById = new Map(nodes.map(node => [node.id, node.name]));

/** 自动派生的合作边不进表：改不了，而且每次目录变动都会变。 */
const catalogPath = resolve(ROOT, 'src/data/catalog.json');
const derived = new Set();
if (existsSync(catalogPath)) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  for (const work of catalog.works) {
    work.artistIds.forEach((source, index) => {
      for (const target of work.artistIds.slice(index + 1)) derived.add(`${work.id}-${source}-${target}`);
    });
  }
}

const geo = JSON.parse(readFileSync(resolve(ROOT, '.data/provinces.json'), 'utf8'));
/** 历史数据里存的是城市，导出统一折算成省级行政区。 */
const provinceOfCity = city => (geo.names.includes(city) ? city : (geo.cities[city] || geo.unknown));

const artistRows = [...nodes]
  .sort((a, b) => (provinceOfCity(a.city) === provinceOfCity(b.city)
    ? a.name.localeCompare(b.name, 'zh-CN')
    : provinceOfCity(a.city).localeCompare(provinceOfCity(b.city), 'zh-CN')))
  .map(node => ({
    id: node.id,
    名字: node.name,
    别名: (node.aliases || []).join('、'),
    类型: KIND_LABEL[node.kind] || '音乐人',
    省份: provinceOfCity(node.city),
    简介: node.description,
    头像: node.avatarUrl || '',
    状态: STATUS_ACTIVE,
  }));

const manual = relations.filter(relation => !derived.has(relation.id));
const relationRows = [...manual]
  .sort((a, b) => (a.type === b.type ? a.id.localeCompare(b.id) : a.type.localeCompare(b.type)))
  .map(relation => ({
    id: relation.id,
    起点: nameById.get(relation.source) || relation.source,
    终点: nameById.get(relation.target) || relation.target,
    类型: RELATION_LABEL[relation.type] || relation.type,
    说明: relation.label,
    年份: relation.observedYear ?? relation.startYear ?? '',
    作品名: relation.track?.title || '',
    作品年份: relation.track?.year ?? '',
    版本: relation.track?.version || '',
    证据标题: relation.evidence?.[0]?.title || '',
    证据链接: relation.evidence?.[0]?.url || '',
    证据说明: relation.evidence?.[0]?.note || '',
    来源: relation.evidence?.length ? '人工' : '无证据',
    状态: STATUS_ACTIVE,
  }));

const workbook = XLSX.utils.book_new();
const widths = (columns, extra = {}) => columns.map(column => ({wch: extra[column] ?? (column.length > 4 ? 18 : 12)}));

const readme = XLSX.utils.aoa_to_sheet(SHEET_README);
readme['!cols'] = [{wch: 108}];
XLSX.utils.book_append_sheet(workbook, readme, '说明');

const artistSheet = XLSX.utils.json_to_sheet(artistRows, {header: ARTIST_COLUMNS});
artistSheet['!cols'] = widths(ARTIST_COLUMNS, {id: 22, 名字: 14, 别名: 24, 省份: 10, 简介: 60, 头像: 28, 状态: 8});
artistSheet['!autofilter'] = {ref: `A1:${XLSX.utils.encode_col(ARTIST_COLUMNS.length - 1)}${artistRows.length + 1}`};
XLSX.utils.book_append_sheet(workbook, artistSheet, '人物');

const relationSheet = XLSX.utils.json_to_sheet(relationRows, {header: RELATION_COLUMNS});
relationSheet['!cols'] = widths(RELATION_COLUMNS, {id: 26, 说明: 40, 证据链接: 34, 证据说明: 32, 作品名: 26});
relationSheet['!autofilter'] = {ref: `A1:${XLSX.utils.encode_col(RELATION_COLUMNS.length - 1)}${relationRows.length + 1}`};
XLSX.utils.book_append_sheet(workbook, relationSheet, '关系');

mkdirSync(dirname(OUTPUT), {recursive: true});
// Excel / WPS 打开着文件时会锁住，不要因此白干一次导出。
let target = OUTPUT;
try {
  XLSX.writeFile(workbook, target);
} catch (error) {
  if (error.code !== 'EBUSY') throw error;
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  target = OUTPUT.replace(/\.xlsx$/i, `-${stamp}.xlsx`);
  XLSX.writeFile(workbook, target);
  console.warn(`! ${OUTPUT} 正被 Excel / WPS 占用，已改写到 ${target}`);
  console.warn('  关掉表格后重新导出，或直接编辑这个新文件（把 SHEET_FILE 指向它）。');
}

console.log(`✓ 已导出 ${target}`);
console.log(`  人物 ${artistRows.length} 行 · 人工关系 ${relationRows.length} 行`);
console.log(`  另有 ${derived.size} 条歌曲合作由作品署名自动生成，不放进表格`);
console.log('  改完运行 npm run sheet:import');
