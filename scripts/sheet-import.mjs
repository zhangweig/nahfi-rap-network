/**
 * 读回表格，把改动覆盖到网站数据上。
 * 只写「真的改过的行」，所以代码侧新增的数据不会被一张旧表挡掉。
 * 校验不通过时一行都不写。
 */
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import XLSX from 'xlsx';
import {buildData} from './build-data.mjs';
import {
  ARTIST_COLUMNS, RELATION_COLUMNS, KIND_BY_LABEL, RELATION_BY_LABEL,
  STATUS_RETIRED, cell, year, splitAliases,
} from './sheet-schema.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, process.env.SHEET_FILE || 'data/nahfi-rap-data.xlsx');
const OUTPUT = resolve(ROOT, 'src/data/sheet-overrides.json');
const BASELINE = resolve(ROOT, '.data/baseline-data.json');
const SNAPSHOT = resolve(ROOT, 'server/generated/base-data.json');

const dryRun = process.argv.includes('--dry-run');
const explain = process.argv.includes('--explain');

const errors = [];
const warnings = [];
const fail = (sheet, row, message) => errors.push(`${sheet} 第 ${row} 行：${message}`);
const warn = message => warnings.push(message);

/** 键序无关的序列化，用来判断一行有没有被改过。 */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function keyOf(prefix, text) {
  return `${prefix}-${createHash('sha1').update(text).digest('hex').slice(0, 8)}`;
}

const text = value => (value === undefined || value === null ? '' : String(value));

/** 找出两个对象里值不同的键，配合 --explain 用来看「这行为什么算改动」。 */
function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(keys => stable(a[keys]) !== stable(b[keys]));
}

if (!existsSync(SOURCE)) {
  console.error(`✗ 找不到表格 ${SOURCE}\n  先运行 npm run sheet:export 导出一份。`);
  process.exit(1);
}

// 基线与快照每次重建：否则旧基线会把没改的行误判成改动。
await buildData();
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const baseNodeById = new Map(baseline.nodes.map(node => [node.id, node]));
// 已叠加人工编辑的当前状态，用来判断「这一行到底改没改」。
const snapshot = existsSync(SNAPSHOT)
  ? JSON.parse(readFileSync(SNAPSHOT, 'utf8'))
  : {nodes: []};
const currentNodeById = new Map(snapshot.nodes.map(node => [node.id, node]));
const baseRelationById = new Map(baseline.relations.map(relation => [relation.id, relation]));
const geo = JSON.parse(readFileSync(resolve(ROOT, '.data/provinces.json'), 'utf8'));

const workbook = XLSX.readFile(SOURCE);
const read = name => {
  const sheet = workbook.Sheets[name];
  if (!sheet) {
    console.error(`✗ 表格里缺少「${name}」页，请用 npm run sheet:export 重新导出。`);
    process.exit(1);
  }
  return XLSX.utils.sheet_to_json(sheet, {defval: '', raw: false});
};

const artistRows = read('人物');
const relationRows = read('关系');

// ---- 人物 ----
const artists = [];
const seenArtistIds = new Set();
artistRows.forEach((row, index) => {
  const at = index + 2;
  const name = cell(row['名字']);
  if (!name) {
    fail('人物', at, '「名字」不能为空');
    return;
  }
  const kindLabel = cell(row['类型']) || '音乐人';
  const kind = KIND_BY_LABEL[kindLabel];
  if (!kind) {
    fail('人物', at, `类型「${kindLabel}」不认识，只能是 音乐人 / 组合`);
    return;
  }
  const provinceCell = cell(row['省份']) || cell(row['城市']);
  const province = geo.names.includes(provinceCell)
    ? provinceCell
    : (geo.cities[provinceCell] || (provinceCell === geo.unknown || !provinceCell ? geo.unknown : ''));
  if (!province) {
    fail('人物', at, `省份「${provinceCell}」不认识，只认 34 个省级行政区（四川、新疆、北京…）`);
    return;
  }
  const id = cell(row['id']) || keyOf('n', name);
  if (seenArtistIds.has(id)) {
    fail('人物', at, `id「${id}」在表里重复出现`);
    return;
  }
  seenArtistIds.add(id);

  const base = baseNodeById.get(id);
  const live = currentNodeById.get(id);
  // 老数据存的是城市（成都 / 乌鲁木齐），省份等价时保留原值，避免一导入就把全表冻结成省级。
  const currentCity = (live || base)?.city;
  const baseProvince = currentCity
    ? (geo.names.includes(currentCity) ? currentCity : (geo.cities[currentCity] || geo.unknown))
    : '';
  const retired = cell(row['状态']) === STATUS_RETIRED;
  artists.push({
    at, id, retired,
    patch: {
      id, name, kind, city: currentCity && baseProvince === province ? currentCity : province,
      aliases: splitAliases(row['别名']),
      // 这几列已从表格里移除，编辑时沿用当前值，不会被默认值覆盖。
      category: (live || base)?.category || '说唱音乐人',
      color: (live || base)?.color || '#7c93a8',
      initials: (live || base)?.initials || name.slice(0, 2),
      description: cell(row['简介']),
      avatarUrl: cell(row['头像']) || (live || base)?.avatarUrl || '',
      sources: (live || base)?.sources || [],
    },
  });
});

// 名字 / 别名 → id，供关系页引用
const idByName = new Map();
for (const artist of artists) {
  if (artist.retired) continue;
  idByName.set(artist.patch.name, artist.id);
  for (const alias of artist.patch.aliases) if (!idByName.has(alias)) idByName.set(alias, artist.id);
}
const resolveId = text => {
  const value = cell(text);
  if (!value) return '';
  if (seenArtistIds.has(value)) return value;
  if (idByName.has(value)) return idByName.get(value);
  return baseNodeById.has(value) ? value : '';
};

// ---- 关系 ----
const relations = [];
const seenRelationIds = new Set();
relationRows.forEach((row, index) => {
  const at = index + 2;
  const typeLabel = cell(row['类型']);
  const type = RELATION_BY_LABEL[typeLabel];
  if (!type) {
    fail('关系', at, `类型「${typeLabel || '(空)'}」不认识，只能是 组合成员 / 歌曲合作 / 幕后制作 / 历史关联`);
    return;
  }
  const source = resolveId(row['起点']);
  if (!source) {
    fail('关系', at, `起点「${cell(row['起点']) || '(空)'}」在人物页里找不到，检查名字是否写错`);
    return;
  }
  const target = resolveId(row['终点']);
  if (!target) {
    fail('关系', at, `终点「${cell(row['终点']) || '(空)'}」在人物页里找不到，检查名字是否写错`);
    return;
  }
  if (source === target) {
    fail('关系', at, '起点和终点是同一个人');
    return;
  }

  const url = cell(row['证据链接']);
  if (url && !/^https?:\/\//i.test(url)) fail('关系', at, `证据链接必须以 http:// 或 https:// 开头（现在是「${url}」）`);

  const label = cell(row['说明']) || `${typeLabel}`;
  const id = cell(row['id']) || keyOf('r', `${source}|${type}|${target}|${label}`);
  if (seenRelationIds.has(id)) {
    fail('关系', at, `id「${id}」在表里重复出现`);
    return;
  }
  seenRelationIds.add(id);

  const title = cell(row['作品名']);
  const trackId = baseRelationById.get(id)?.track?.id || (title ? keyOf('w', `${title}|${cell(row['作品年份'])}`) : '');
  // 「年份」只取本列：如果顺手回落到作品年份，导出再导入就会把 observedYear 填上，
  // 导致每次导入都判定成改动。
  const pickedYear = year(row['年份']);
  const trackYear = year(row['作品年份']) ?? pickedYear;

  relations.push({
    at, id,
    retired: cell(row['状态']) === STATUS_RETIRED,
    patch: {
      id, source, target, type, label,
      observedYear: pickedYear,
      ...(title && trackId
        ? {track: {id: trackId, title, year: trackYear ?? 0, version: cell(row['版本']) || '发行版'}}
        : {}),
      evidence: url || cell(row['证据标题'])
        ? [{title: cell(row['证据标题']) || label, url, note: cell(row['证据说明'])}]
        : [],
      status: 'verified',
    },
  });});

if (errors.length) {
  console.error(`\n✗ 表格有 ${errors.length} 处问题，没有写入任何数据：\n`);
  for (const message of errors.slice(0, 40)) console.error(`  · ${message}`);
  if (errors.length > 40) console.error(`  · 还有 ${errors.length - 40} 处，先修完上面这些再跑一次`);
  process.exit(1);
}

// ---- 与基线比对，只留改动 ----
const records = [];
const retired = [];
let unchanged = 0;

for (const artist of artists) {
  if (artist.retired) { retired.push(artist.id); continue; }
  const base = baseNodeById.get(artist.id);
  const live = currentNodeById.get(artist.id);
  const known = live || base;
  if (known) {
    const current = {
      id: known.id, name: known.name, kind: known.kind, city: known.city,
      aliases: known.aliases || [], category: known.category, color: known.color,
      initials: known.initials, description: known.description,
      avatarUrl: known.avatarUrl || '',
      // 来源列已从表格移除，两边都用原值比对，避免把历史来源覆盖掉。
      sources: known.sources || [],
    };
    if (stable(current) === stable(artist.patch)) { unchanged += 1; continue; }
    if (explain) console.log(`  ~ 人物 ${artist.id}：${diffKeys(current, artist.patch).join('、')}`);
  }
  records.push({entityId: artist.id, kind: 'artist', payload: {...(live || base || {}), ...artist.patch}});
}

for (const relation of relations) {
  if (relation.retired) { retired.push(relation.id); continue; }
  const base = baseRelationById.get(relation.id);
  if (base) {
    const current = {
      id: base.id, source: base.source, target: base.target, type: base.type, label: base.label,
      observedYear: base.observedYear,
      ...(base.track ? {track: base.track} : {}),
      evidence: base.evidence?.length
        ? [{
            title: text(base.evidence[0].title),
            url: text(base.evidence[0].url),
            note: text(base.evidence[0].note),
          }]
        : [],
      status: base.status,
    };
    const next = {...relation.patch, status: base.status };
    if (stable(current) === stable(next)) { unchanged += 1; continue; }
    if (explain) console.log(`  ~ 关系 ${relation.id}：${diffKeys(current, next).join('、')}`);
  }
  records.push({entityId: relation.id, kind: 'relationship', payload: {...(base || {}), ...relation.patch}});
}

// 表里没有行、但以前标记过下架的，保持下架（用户可能只改了一个单元格）
const previous = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, 'utf8')) : {retired: []};
const keptRetired = (previous.retired || []).filter(id => !seenArtistIds.has(id) && !seenRelationIds.has(id));

const output = {
  generatedAt: new Date().toISOString(),
  source: 'sheet',
  retired: [...new Set([...retired, ...keptRetired])],
  records,
};

if (dryRun) {
  console.log(`\n（--dry-run，未写入）`);
} else {
  writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
  await buildData();
}

console.log(`\n✓ ${dryRun ? '检查完成' : '导入完成'}`);
console.log(`  表内 人物 ${artists.length} 行 · 关系 ${relations.length} 行`);
console.log(`  未改动 ${unchanged} 行（不进覆盖文件）`);
console.log(`  改动 ${records.length} 行 · 下架 ${output.retired.length} 条`);
if (warnings.length) {
  console.log('');
  for (const message of warnings) console.log(`  ! ${message}`);
}
if (!dryRun) console.log('\n  快照已重建，运行 npm run dev 查看效果。');
