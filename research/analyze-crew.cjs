/** 只读：把名单里带厂牌的记录映射到当前节点，找出已有/缺失/重复。 */
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
fs.unlinkSync(TMP);

const TRAD = {'馬':'马','劉':'刘','楊':'杨','熱':'热','萬':'万','歐':'欧','陽':'阳','錫':'锡','亞':'亚','張':'张','樂':'乐','鳳':'凤','穩':'稳','豐':'丰','鑽':'钻','龍':'龙','蘭':'兰','貝':'贝','凱':'凯','倫':'伦','爾':'尔','誌':'志'};
const norm = text => String(text || '').toLowerCase()
  .replace(/[\u4e00-\u9fa5]/g, c => TRAD[c] || c)
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\]/g, '');

// 人 → 节点（全库，含 pending）
const identity = new Map();
for (const n of built.nodes) {
  for (const label of [n.name, ...(n.aliases || [])]) {
    const key = norm(label);
    if (key && !identity.has(key)) identity.set(key, {id: n.id, name: n.name, kind: n.kind});
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
function resolvePerson(row) {
  for (const n of namesOf(row)) {
    const key = norm(n);
    if (!key) continue;
    const exact = identity.get(key);
    if (exact) return {...exact, via: n};
    const han = /[\u4e00-\u9fa5]/.test(key);
    if (key.length < (han ? 2 : 4)) continue;
    for (const [stored, found] of identity) {
      const storedHan = /[\u4e00-\u9fa5]/.test(stored);
      if (storedHan !== han || stored.length < (han ? 2 : 4)) continue;
      if (stored.includes(key) || key.includes(stored)) return {...found, via: n};
    }
  }
  return null;
}

// 厂牌 → 已有 group 节点（按别名）
const crewAlias = {
  'cdc':'cdc','cdc成都集团':'cdc','cdc东风档案':'cdc','cdcatm':'cdc','cdc早期关联':'cdc',
  'higherb brothers':'higher','higherbrothers':'higher','higherbrothers':'higher',
  'gosh':'gosh','g$h':'gosh','活死人':'huosiren','原红花会':'hhh','红花会创始人':'hhh','原红花会（已退出）':'hhh',
  'nousunderground':'nous','种梦音乐':'dmg','w8ves':'w8ves','digighetto':'digi','digighetto关联':'digi',
  'cblock':'cblock','cblockcsc':'cblock','cbbtockcsc':'cblock','csc':'cblock',
  '顽童mj116':'pending-045','农夫fama':'pending-141','阴三儿':'pending-047','隐藏':'pending-170',
  '龙井说唱':'pending-171','龙胆紫':'pending-172',
  // 需要新建的明确厂牌/团体
  '丹镇北京':'NEW:丹镇北京','广顺社团':'NEW:广顺社团','天山四子':'NEW:天山四子','沙漠兄弟':'NEW:沙漠兄弟',
  '颜社':'NEW:颜社','吾人文化':'NEW:吾人文化','吾人族':'NEW:吾人族','第四音乐':'NEW:第四音乐',
  'lmf':'NEW:LMF','三角度':'NEW:三角度','精气神':'NEW:精气神','乱战门':'NEW:乱战门',
  '双赤组合':'NEW:双赤组合','supmusic':'NEW:SUP MUSIC','cscsupmusic':'NEW:SUP MUSIC',
  'cblockcscsup':'cblock','panthepack':'NEW:PANTHEPACK','oho':'NEW:OHO',
  '东风档案':'NEW:东风档案','atm':'NEW:ATM',
  // 应跳过（跨界/关联措辞不明确）
  'the9跨界':'SKIP:crossover','r1se跨界':'SKIP:crossover','旅行新蜜蜂跨界':'SKIP:crossover',
};
const groupById = new Map(built.nodes.filter(n => n.kind === 'group').map(n => [n.id, n]));
const crewTargets = {};
for (const x of require(path.resolve(__dirname, 'xlsx-roster-raw.json')).rows) {
  if (!x.crew || x.crew === '—') continue;
  const key = norm(x.crew);
  crewTargets[x.crew] = crewAlias[key] || 'UNKNOWN';
}

const pairs = new Set(built.relations.map(r => r.source + '>' + r.target));
const rows = require(path.resolve(__dirname, 'xlsx-roster-raw.json')).rows;
const out = [];
for (const row of rows) {
  if (!row.crew || row.crew === '—') continue;
  const person = resolvePerson(row);
  const target = crewTargets[row.crew];
  const dup = person && target && !target.startsWith('SKIP') && pairs.has(person.id + '>' + target.replace('NEW:', 'new:'));
  out.push({no: row.no, name: row.stageName, crew: row.crew, person: person && person.id + '(' + person.name + ')', target, dup: !!dup});
}
fs.writeFileSync(path.resolve(__dirname, 'crew-analysis.json'), JSON.stringify({crewTargets, out}, null, 2));
console.log('rows', out.length);
console.log('resolve failed', out.filter(x => !x.person).length);
console.log('unknown crew', out.filter(x => x.target === 'UNKNOWN').length);
console.log('skip', out.filter(x => x.target && x.target.startsWith('SKIP')).length);
console.log('already linked', out.filter(x => x.dup).length);
console.log('\n--- unresolved people ---');
for (const x of out.filter(x => !x.person)) console.log(' ', x.no, x.name, x.crew);
console.log('\n--- unknown crew ---');
for (const x of out.filter(x => x.target === 'UNKNOWN')) console.log(' ', x.no, x.name, x.crew);
console.log('\n--- mapping table ---');
for (const [crew, target] of Object.entries(crewTargets)) console.log(' ', crew, '=>', target);
