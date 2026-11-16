/** 将用户名单与当前全库（含刚加的 159 个仅名字节点）按姓名/别名去重。只读，不写库。 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
const TMP = path.resolve(__dirname, '.data-bundle.cjs');
esbuild.buildSync({
  entryPoints: [path.resolve(ROOT, 'src/data/rap-data.ts')],
  bundle: true, platform: 'node', format: 'cjs', loader: {'.json': 'json'}, outfile: TMP,
});
const built = require(TMP);
// 基线固定为「原有 79 人 + 159 位缺口候选」，排除 pending-* 节点：
// 否则把名单并进去以后再跑，freshRows 会变成空，生成脚本就没有输入了。
const pool = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'candidate-pool.json'), 'utf8'));
const data = {nodes: [
  ...built.nodes.filter(n => !n.id.startsWith('pending-')),
  ...pool.items.map(([name, aliases], index) => ({id: `pool-${index}`, name, aliases: String(aliases).split('/')})),
]};
fs.unlinkSync(TMP);

const TRAD = {'馬':'马','劉':'刘','楊':'杨','熱':'热','萬':'万','歐':'欧','陽':'阳','錫':'锡','亞':'亚','張':'张','樂':'乐','鳳':'凤','穩':'稳','豐':'丰','鑽':'钻','龍':'龙','蘭':'兰','貝':'贝','凱':'凯','倫':'伦','爾':'尔','誌':'志','达到一定':'达到一定'};
const norm = text => String(text || '').toLowerCase()
  .replace(/[\u4e00-\u9fa5]/g, c => TRAD[c] || c)
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\·]/g, '');

const identity = new Map();
for (const n of data.nodes) {
  for (const label of [n.name, ...(n.aliases || [])]) {
    const key = norm(label);
    if (key && !identity.has(key)) identity.set(key, {id: n.id, name: n.name});
  }
}

/** 从「谢帝 / Fat Shady」「马思唯 MaSiWei」「陆永（农夫 FAMA）」里拆出候选称呼。 */
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

// 精确匹配不互斥（陆永、C君 都是「农夫」的别名，可以同指一个节点）；
// 但「包含匹配」不能抢已被精确占用的人，否则「邓典」会被「邓典果 DDG」吃掉。
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

const seen = new Set();
const fresh = [], dup = [];
for (let rowIndex = 0; rowIndex < raw.rows.length; rowIndex++) {
  const row = raw.rows[rowIndex];
  const names = namesOf(row);
  const hit = assigned.get(rowIndex);
  const key = norm(primaryOf(row));
  if (seen.has(key)) { dup.push({row, reason: '表内重复', matched: {name: primaryOf(row)}}); continue; }
  seen.add(key);
  if (hit) dup.push({row, reason: '库里已有', matched: hit.node, via: hit.via});
  else fresh.push({row, name: primaryOf(row), aliases: names.filter(n => n !== primaryOf(row))});
}

const out = {
  totalRows: raw.rows.length,
  existingIdentities: identity.size,
  duplicates: dup.length,
  fresh: fresh.length,
  dup,
  freshRows: fresh,
};
fs.writeFileSync(path.resolve(__dirname, 'xlsx-dedupe.json'), JSON.stringify(out, null, 2));
console.log('原始', out.totalRows, '重复', dup.length, '新增', fresh.length);
console.log('\n重复项（前 40）：');
for (const d of dup.slice(0, 40)) console.log(' ', d.row.stageName, '→', d.reason, d.matched?.name || '', d.via ? '(' + d.via + ')' : '');
console.log('\n新增（前 60）：');
for (const f of fresh.slice(0, 60)) console.log(' ', f.row.province, f.name, '|', f.aliases.join('/'));
