#!/usr/bin/env node
/** 从缺口候选池 + 用户提供的按省份名单生成「只有名字」的节点：不建关系、不配头像、不写作品。 */
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async p => JSON.parse(await readFile(resolve(ROOT, p), 'utf8'));
const pool = await readJson('research/candidate-pool.json');
const dedupe = await readJson('research/xlsx-dedupe.json');
const base = await readJson('research/gap-baseline.json');
const requested = await readJson('research/name-request.json');

/** 用户表先按 dedupe-xlsx-roster.cjs 去重，这里只消费去重后的 freshRows。 */
const xlsx = dedupe.freshRows.map(f => ({
  name: f.name,
  aliases: f.aliases,
  city: f.row.province === '台湾（活动参考）' ? '台湾' : f.row.province,
  tier: 2,
  note: `用户名单（按省份）· ${f.row.crew === '—' ? '无厂牌标注' : f.row.crew} · ${f.row.verify}`,
  meta: {origin: f.row.origin, crew: f.row.crew, verify: f.row.verify, note: f.row.note},
}));
/** 用户临时点名的姓名：不带省份，先落在「地域待考据」，等有可靠来源再补。 */
const extra = requested.names.map(item => ({
  name: item.name, aliases: item.aliases || [], city: '未标注', tier: 3,
  note: `${requested.source} · ${item.name}`,
}));
const entries = [
  ...pool.items.map(([name, aliasText, city, tier, note]) => ({name, aliases: String(aliasText).split('/'), city, tier, note})),
  ...xlsx,
  ...extra,
];

const GROUPS = new Set(['顽童MJ116', '玖壹壹', '24Herbs廿四味', '农夫', '阴三儿in3', 'OBi&M03', '双胞胎', '深蓝儿童', '草屯囝仔', '龙井说唱', '龙胆紫', '隐藏']);
const PLACEHOLDER_COLOR = '#8ea8bd';
const takenIds = new Set(base.artists.map(a => a.id));
const takenNames = new Set(base.artists.map(a => a.name));
const seenNames = new Set();

const artists = entries.map(({name, aliases: aliasList, city, tier, note, meta}, index) => {
  if (takenNames.has(name) || seenNames.has(name)) throw new Error(`重名：${name}`);
  seenNames.add(name);
  const id = `pending-${String(index + 1).padStart(3, '0')}`;
  if (takenIds.has(id)) throw new Error(`ID 冲突：${id}`);
  const aliases = [...new Set(aliasList.map(s => String(s).trim()).filter(Boolean)
    .filter(alias => alias !== name && alias !== '—' && alias !== '-'))];
  const initials = /^[\x20-\x7e]+$/.test(name) ? name.slice(0, 2).toUpperCase() : name.slice(0, 2);
  return {
    id, name, aliases,
    kind: GROUPS.has(name) ? 'group' : 'artist',
    city: city || '未标注',
    category: GROUPS.has(name) ? '说唱 / 团体' : '说唱 / 音乐人',
    color: PLACEHOLDER_COLOR,
    initials,
    description: '仅收录姓名，关系、作品与头像待补充。',
    // 仅在本地数据里留痕，方便以后按缺口清单逐项补齐；不影响界面。
    _pending: {tier, source: note, ...(meta || {})},
  };
});

await writeFile(
  resolve(ROOT, 'src/data/name-only.json'),
  JSON.stringify({artists}, null, 2) + '\n',
  'utf8',
);
console.log(`写出 ${artists.length} 个仅名字节点 → src/data/name-only.json`);
console.log('其中团体', artists.filter(a => a.kind === 'group').length, '｜无地域', artists.filter(a => a.city === '未标注').length);
