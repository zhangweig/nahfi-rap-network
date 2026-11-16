/**
 * 把用户名单（按省份）里的籍贯省份落成「节点 id → 省份」的分配表。
 * 只生成映射，不改节点；rap-data.ts 会在 provinceOf(city) 与表不一致时应用。
 * 可重复运行：基线与 dedupe-xlsx-roster.cjs 一致，不读自身产物。
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const TMP = path.resolve(__dirname, '.data-bundle.cjs');
esbuild.buildSync({
  entryPoints: [path.resolve(ROOT, 'src/data/rap-data.ts')],
  bundle: true, platform: 'node', format: 'cjs', loader: {'.json': 'json'}, outfile: TMP,
});
const data = require(TMP);
fs.unlinkSync(TMP);
const P = path.resolve(__dirname, '.province-bundle.cjs');
esbuild.buildSync({entryPoints: [path.resolve(ROOT, 'src/lib/province.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: P});
const {provinceOf, PROVINCE_NAMES} = require(P);
fs.unlinkSync(P);

const TRAD = {'馬':'马','劉':'刘','楊':'杨','熱':'热','萬':'万','歐':'欧','陽':'阳','錫':'锡','亞':'亚','張':'张','樂':'乐','鳳':'凤','穩':'稳','豐':'丰','鑽':'钻','龍':'龙','蘭':'兰','貝':'贝','凱':'凯','倫':'伦','爾':'尔','誌':'志'};
const norm = text => String(text || '').toLowerCase()
  .replace(/[\u4e00-\u9fa5]/g, c => TRAD[c] || c)
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\·]/g, '');
const identity = new Map();
for (const n of data.nodes) {
  for (const label of [n.name, ...(n.aliases || [])]) {
    const key = norm(label);
    if (key && !identity.has(key)) identity.set(key, n);
  }
}
function namesOf(row) {
  const raw = row.stageName.replace(/[（）()]/g, ' / ');
  const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
  const names = [];
  for (const part of parts) {
    const split = part.replace(/^([\u4e00-\u9fa5]+)\s+([A-Za-z][A-Za-z .'-]*)$/, '$1|$2').split('|');
    names.push(...split.map(s => s.trim()).filter(Boolean));
  }
  if (row.realName && row.realName !== '—' && row.realName !== '-') names.push(row.realName.trim());
  names.push(row.stageName);
  return [...new Set(names)];
}
const primaryOf = row => {
  const candidates = namesOf(row).filter(n => !/^(—|-)$/.test(n));
  return candidates.find(n => /[\u4e00-\u9fa5]/.test(n) && !/（/.test(n)) || candidates[0];
};

const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'xlsx-roster-raw.json'), 'utf8'));
const exactOffers = [], looseOffers = [];
raw.rows.forEach((row, rowIndex) => {
  const exacts = [], loose = [];
  for (const label of namesOf(row)) {
    const key = norm(label);
    if (!key) continue;
    const exact = identity.get(key);
    if (exact) { exacts.push({node: exact, via: label}); continue; }
    const han = /[\u4e00-\u9fa5]/.test(key);
    if (key.length < (han ? 2 : 4)) continue;
    for (const [stored, node] of identity) {
      const storedHan = /[\u4e00-\u9fa5]/.test(stored);
      if (storedHan !== han || stored.length < (han ? 2 : 4)) continue;
      if (stored.includes(key) || key.includes(stored)) {
        loose.push({node, via: label, score: 10 + Math.min(stored.length, key.length) / 100});
      }
    }
  }
  if (exacts.length) exactOffers.push({rowIndex, candidate: exacts[0]});
  else if (loose.length) {
    loose.sort((a, b) => b.score - a.score);
    looseOffers.push({rowIndex, candidate: loose[0]});
  }
});
const assigned = new Map(), exactTaken = new Set();
for (const offer of exactOffers) {
  assigned.set(offer.rowIndex, offer.candidate);
  exactTaken.add(offer.candidate.node.id);
}
for (const offer of looseOffers) {
  if (!exactTaken.has(offer.candidate.node.id)) assigned.set(offer.rowIndex, offer.candidate);
}

const clean = value => String(value || '').replace(/（.*?）|\(.*?\)/g, '').trim();
const assignments = [];
const unmatched = [];
raw.rows.forEach((row, rowIndex) => {
  const hit = assigned.get(rowIndex);
  if (!hit) { unmatched.push(primaryOf(row)); return; }
  const province = clean(row.province);
  if (!PROVINCE_NAMES.includes(province)) { unmatched.push(`${primaryOf(row)} (未知省份 ${province})`); return; }
  assignments.push({
    id: hit.node.id,
    name: primaryOf(row),
    province,
    row: row.no,
    via: hit.via,
    verify: row.verify || '',
    origin: row.origin || '',
    note: row.note || '',
  });
});
const changed = assignments.filter(a => provinceOf(data.nodes.find(n => n.id === a.id)?.city) !== a.province);
const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: '用户名单（按省份）xlsx',
  totalRows: raw.rows.length,
  assignments,
};
fs.writeFileSync(path.resolve(ROOT, 'src/data/xlsx-province.json'), JSON.stringify(out, null, 2) + '\n');
console.log('写入', assignments.length, '条省份分配；其中需覆盖', changed.length, '条；未匹配', unmatched.length);
console.log('需覆盖：');
for (const a of changed) console.log(`  ${a.name} → ${a.province} (${a.id}, 原 ${provinceOf(data.nodes.find(n => n.id === a.id)?.city)})`);
if (unmatched.length) console.log('未匹配：', unmatched.join(', '));
