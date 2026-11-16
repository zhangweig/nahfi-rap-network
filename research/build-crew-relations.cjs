/**
 * 从用户提供的「按省份名单」生成明确的厂牌/团体关系。
 * 只读原始名单，输出 src/data/crew-relations.json；不新增作品、头像或合作关系。
 * 可重复运行：已有边会跳过，生成文件每次整体覆盖而不是累加。
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
const full = require(TMP);
fs.unlinkSync(TMP);
// 固定基线：排除本脚本自己生成的 crew-* 节点与关系，否则接入后重跑会把结果清空。
const built = {
  nodes: full.nodes.filter(n => !n.id.startsWith('crew-')),
  relations: full.relations.filter(r => !r.id.startsWith('crew-')),
};

const TRAD = {'馬':'马','劉':'刘','楊':'杨','熱':'热','萬':'万','歐':'欧','陽':'阳','錫':'锡','亞':'亚','張':'张','樂':'乐','鳳':'凤','穩':'稳','豐':'丰','鑽':'钻','龍':'龙','蘭':'兰','貝':'贝','凱':'凯','倫':'伦','爾':'尔','誌':'志'};
const norm = text => String(text || '').toLowerCase()
  .replace(/[\u4e00-\u9fa5]/g, c => TRAD[c] || c)
  .replace(/[\s\-_.·・'"’“”`()（）\[\]【】《》!！,，、/\\·]/g, '');

const identity = new Map();
for (const n of built.nodes) {
  for (const label of [n.name, ...(n.aliases || [])]) {
    const key = norm(label);
    if (key && !identity.has(key)) identity.set(key, n);
  }
}
function namesOf(row) {
  const parts = row.stageName.replace(/[（）()]/g, ' / ').split('/').map(s => s.trim()).filter(Boolean);
  const names = [];
  for (const part of parts) names.push(...part.replace(/^([\u4e00-\u9fa5]+)\s+([A-Za-z][A-Za-z .'-]*)$/, '$1|$2').split('|').map(s => s.trim()).filter(Boolean));
  if (row.realName && !['—', '-'].includes(row.realName)) names.push(row.realName.trim());
  names.push(row.stageName);
  return [...new Set(names)];
}
function resolvePerson(row) {
  for (const n of namesOf(row)) {
    const key = norm(n);
    if (!key) continue;
    const exact = identity.get(key);
    if (exact) return exact;
    const han = /[\u4e00-\u9fa5]/.test(key);
    if (key.length < (han ? 2 : 4)) continue;
    for (const [stored, found] of identity) {
      const sh = /[\u4e00-\u9fa5]/.test(stored);
      if (sh !== han || stored.length < (han ? 2 : 4)) continue;
      if (stored.includes(key) || key.includes(stored)) return found;
    }
  }
  return null;
}

/** 已有节点：直接复用 id；NEW：新建 group 节点；SKIP：跨界偶像组合，不属于说唱厂牌。 */
const CREW = {
  'cdc': 'cdc', 'cdc成都集团': 'cdc', 'cdc东风档案': 'cdc', 'cdcatm': 'cdc',
  'higherb brothers': 'higher', 'higherbrothers': 'higher',
  'gosh': 'gosh', '活死人': 'huosiren', '活死人主理人': 'huosiren',
  '原红花会': 'hhh', '红花会创始人': 'hhh', '原红花会已退出': 'hhh',
  'nousunderground': 'nous', '种梦音乐': 'dmg', 'w8ves': 'w8ves',
  'digighetto': 'digi', 'digighetto关联': 'digi',
  'cblock': 'cblock', 'csc': 'cblock', 'sup': 'crew-supmusic',
  'cdc早期关联': 'cdc',
  '顽童mj116': 'pending-045', '农夫fama': 'pending-141',
  '隐藏': 'pending-170', '龙井说唱': 'pending-171', '阴三儿': 'pending-047', '龙胆紫': 'pending-172',
  'the9跨界': 'SKIP', 'r1se跨界': 'SKIP', '旅行新蜜蜂跨界': 'SKIP',
};
/** 名单里明确写出、库里还没有的团体/厂牌。id 固定，便于深链与去重。 */
const NEW_CREW = {
  'panthepack': {id:'crew-panthepack', name:'PANTHEPACK', city:'四川', aliases:['熊猫工厂'], type:'member'},
  '天府事变': {id:'crew-tianfushibian', name:'天府事变', city:'四川', aliases:[], type:'member'},
  '东风档案': {id:'crew-dongfeng', name:'东风档案', city:'四川', aliases:[], type:'member'},
  'atm': {id:'crew-atm', name:'ATM', city:'四川', aliases:[], type:'member'},
  'supmusic': {id:'crew-supmusic', name:'SUP MUSIC', city:'湖南', aliases:['SUP'], type:'member'},
  '丹镇北京': {id:'crew-danzhen', name:'丹镇北京', city:'北京', aliases:[], type:'member'},
  '广顺社团': {id:'crew-guangshun', name:'广顺社团', city:'北京', aliases:[], type:'member'},
  '精气神': {id:'crew-jingshen', name:'精气神', city:'广东', aliases:[], type:'member'},
  '双赤组合': {id:'crew-shuangchi', name:'双赤组合', city:'广东', aliases:[], type:'member'},
  '天山四子': {id:'crew-tianshan', name:'天山四子', city:'新疆', aliases:[], type:'member'},
  'oho': {id:'crew-oho', name:'OHO', city:'新疆', aliases:[], type:'member'},
  '沙漠兄弟': {id:'crew-shamo', name:'沙漠兄弟', city:'新疆', aliases:[], type:'member'},
  '吾人文化': {id:'crew-wuren', name:'吾人文化', city:'吉林', aliases:[], type:'member'},
  '吾人族': {id:'crew-wurenzu', name:'吾人族', city:'吉林', aliases:[], type:'member'},
  '乱战门': {id:'crew-luanzhan', name:'乱战门', city:'山西', aliases:[], type:'member'},
  '第四音乐': {id:'crew-disiyinyue', name:'第四音乐', city:'安徽', aliases:[], type:'member'},
  '颜社': {id:'crew-yanshe', name:'颜社', city:'台湾', aliases:[], type:'member'},
  'lmf': {id:'crew-lmf', name:'LMF', city:'香港', aliases:['大懒堂'], type:'member'},
  '三角度': {id:'crew-sanjiaodu', name:'三角度', city:'香港', aliases:[], type:'member'},
};
for (const [key, def] of Object.entries(NEW_CREW)) CREW[key] = def.id;

// 这些措辞表示历史/经纪/角色，不是「现役成员」，一律降级为 affiliation，并在标签里保留原文。
const SOFT = new Set(['cdc早期关联', 'digighetto关联', '活死人主理人', '红花会创始人', '原红花会', '原红花会已退出']);
const SOFT_LABEL = {
  'cdc早期关联':'早期关联', 'digighetto关联':'关联', '活死人主理人':'主理人',
  '红花会创始人':'创始人', '原红花会':'历史成员', '原红花会已退出':'已退出',
};
const COLORS = ['#7fc7d9','#e2a06a','#b79af0','#8fc9a8','#e58fb8','#92a9e8'];

// 已有关系（两个方向都算）用于去重。
const linked = new Set();
for (const r of built.relations) {
  linked.add(r.source + '>' + r.target);
  linked.add(r.target + '>' + r.source);
}

const raw = require(path.resolve(__dirname, 'xlsx-roster-raw.json')).rows;
const addedGroups = new Map();
const addedRelations = [];
const skipped = [];
const seenPairs = new Set(linked);

for (const row of raw) {
  if (!row.crew || row.crew === '—') continue;
  const person = resolvePerson(row);
  if (!person) { skipped.push({no:row.no, name:row.stageName, crew:row.crew, why:'人未匹配到节点'}); continue; }

  // 一个格子可能写两个厂牌（Higher Brothers / CDC），逐个拆开。
  const parts = row.crew.split('/').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const key = norm(part);
    const target = CREW[key];
    if (!target) { skipped.push({no:row.no, name:row.stageName, crew:row.crew, part, why:'厂牌未识别'}); continue; }
    if (target === 'SKIP') { skipped.push({no:row.no, name:row.stageName, crew:row.crew, part, why:'跨界组合，非说唱厂牌'}); continue; }
    if (target === person.id) { skipped.push({no:row.no, name:row.stageName, crew:row.crew, part, why:'团体条目自身，避免自环'}); continue; }
    if (seenPairs.has(person.id + '>' + target) || seenPairs.has(target + '>' + person.id)) {
      skipped.push({no:row.no, name:row.stageName, crew:row.crew, part, why:'库中已有该关系'});
      continue;
    }
    seenPairs.add(person.id + '>' + target);

    let def = null;
    if (target.startsWith('crew-')) {
      def = Object.values(NEW_CREW).find(d => d.id === target);
      if (!addedGroups.has(target)) addedGroups.set(target, {
        id: target, name: def.name, aliases: def.aliases, kind:'group', city:def.city,
        category:'厂牌 / 团体', color:COLORS[addedGroups.size % COLORS.length],
        initials:def.name.replace(/[^A-Za-z\u4e00-\u9fa5]/g,'').slice(0,2).toUpperCase(),
        description:`${def.name}：由用户提供的按省份名单中的「厂牌」字段收录，成员/关联关系均来自该名单，地域按名单归属推定。`,
      });
    }
    const soft = SOFT.has(key);
    const label = soft ? `${def ? def.name : part} · ${SOFT_LABEL[key]}` : `${def ? def.name : part} · 名单标注成员`;
    addedRelations.push({
      id:`crew-${person.id}-${target}`, source:target, target:person.id,
      type: soft ? 'affiliation' : 'member', label,
      evidence:[{
        title:'用户名单（按省份）',
        url:'https://github.com/zhangweig/nahfi-rap-network',
        note:`名单第 ${row.no} 行「${row.stageName}」，厂牌字段原文：${part}；核实状态：${row.verify || '未标注'}。仅按名单显式标注建关系，不推断当前签约状态。`,
      }],
      status:'verified',
    });
  }
}

const out = {generatedFrom:'research/xlsx-roster-raw.json', groups:[...addedGroups.values()], relations:addedRelations};
fs.writeFileSync(path.resolve(ROOT, 'src/data/crew-relations.json'), JSON.stringify(out, null, 2) + '\n');
fs.writeFileSync(path.resolve(__dirname, 'crew-relations-report.json'), JSON.stringify({
  groups: out.groups.map(g => ({id:g.id,name:g.name,city:g.city})),
  relationCount: out.relations.length,
  member: out.relations.filter(r => r.type === 'member').length,
  affiliation: out.relations.filter(r => r.type === 'affiliation').length,
  skipped,
}, null, 2));
console.log('新增厂牌节点', out.groups.length, '新增关系', out.relations.length,
  '(member', out.relations.filter(r => r.type === 'member').length, '/ affiliation', out.relations.filter(r => r.type === 'affiliation').length + ')');
console.log('跳过', skipped.length, skipped.reduce((a,s)=>(a[s.why]=(a[s.why]||0)+1,a),{}));
console.log('未识别：', skipped.filter(s => s.why === '厂牌未识别').map(s => s.part).join('、') || '无');
