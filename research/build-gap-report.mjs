#!/usr/bin/env node
/** 把候选池 + 头像核查 + 基线快照合成一份可筛选的离线报告。 */
import {readFile, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = name => readFile(resolve(ROOT, `research/${name}`), 'utf8').then(JSON.parse);

const pool = await readJson('candidate-pool.json');
const base = await readJson('gap-baseline.json');
const t1 = await readJson('gap-avatar-check-t1.json');
const t2 = await readJson('gap-avatar-check-t2.json');
const avatar = new Map([...t1.results, ...t2.results].map(r => [r.name, r]));

const EDGE_PER_TIER = {1: 4, 2: 2, 3: 1};
const LABEL = {
  'wiki-image': '有图 · 可直接用',
  'wiki-page-no-image': '有词条 · 无图',
  'wiki-image-needs-review': '待人工确认',
  'no-page': '无维基词条',
};
const rows = pool.items.map(([name, aliases, city, tier, note]) => ({
  name, aliases: aliases.split('/').filter(Boolean), city: city || '未标注', tier, note,
  avatar: avatar.get(name)?.status || (tier === 3 ? 'not-checked' : 'no-page'),
  avatarUrl: avatar.get(name)?.pageUrl || '',
  edges: EDGE_PER_TIER[tier],
}));
const tierCount = t => rows.filter(r => r.tier === t).length;
const wikiHits = rows.filter(r => r.avatar === 'wiki-image').length;

const data = {rows, base, generatedAt: '2026-11-16', wikiHits};
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>中文说唱图谱 · 人物缺口盘点</title>
<style>
:root{--bg:#070d15;--panel:#0e1722;--line:#1c2b3b;--ink:#e8f2ff;--dim:#8fa4ba;--cyan:#5ee7ff;--pink:#ff5fa2;--gold:#ffd166;--green:#6ee7a8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;background:linear-gradient(#5ee7ff09 1px,transparent 1px),linear-gradient(90deg,#5ee7ff09 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(#000,transparent 70%)}
.wrap{max-width:1180px;margin:0 auto;padding:48px 24px 80px;position:relative}
h1{font-size:30px;margin:0 0 6px;letter-spacing:.5px}h1 span{color:var(--cyan)}
.sub{color:var(--dim);margin-bottom:30px}
.verdict{border:1px solid #2b4a5f;background:linear-gradient(120deg,#0d1b27,#0a121b);border-radius:14px;padding:22px 24px;margin-bottom:24px}
.verdict b{color:var(--gold)}.verdict p{margin:6px 0}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.card .n{font-size:28px;font-weight:700;color:var(--cyan);line-height:1.2}.card .t{color:var(--dim);font-size:12px;margin-top:4px}
.card.pink .n{color:var(--pink)}.card.gold .n{color:var(--gold)}.card.green .n{color:var(--green)}
.note{border-left:3px solid var(--pink);background:#ff5fa20d;padding:10px 14px;border-radius:0 8px 8px 0;margin:16px 0;color:#ffc9de}
h2{font-size:19px;margin:34px 0 12px;padding-left:10px;border-left:3px solid var(--cyan)}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th{text-align:left;color:var(--dim);font-weight:500;font-size:12px;padding:10px 12px;background:#111e2b;border-bottom:1px solid var(--line)}
td{padding:9px 12px;border-bottom:1px solid #162432;vertical-align:top}tr:last-child td{border-bottom:0}
tr:hover td{background:#142433}
.name{font-weight:600}.alias{color:var(--dim);font-size:12px}
.pill{display:inline-block;padding:1px 8px;border-radius:20px;font-size:11px;border:1px solid #35506a;color:#bcd4e8}
.t1{color:var(--gold);border-color:#7a6130}.t2{color:var(--cyan)}.t3{color:var(--dim)}
.av{font-size:12px}.av.good{color:var(--green)}.av.mid{color:var(--gold)}.av.bad{color:#6b7f92}
.ctrl{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
button,.search{background:#101d29;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:7px 13px;font:inherit}
button{cursor:pointer}button.on{border-color:var(--cyan);color:var(--cyan);background:#0d2833}
.search{flex:1;min-width:200px}
.phase{display:grid;grid-template-columns:110px 1fr 190px;gap:12px;align-items:start;padding:14px 0;border-bottom:1px solid var(--line)}
.phase:last-child{border:0}.phase .who{color:var(--gold);font-weight:600}.phase .hr{color:var(--pink);font-weight:600}
.small{color:var(--dim);font-size:12px}
a{color:var(--cyan)}.stat{font-variant-numeric:tabular-nums}
@media(max-width:760px){.cards{grid-template-columns:repeat(2,1fr)}.phase{grid-template-columns:1fr}.wrap{padding:28px 14px}.tblwrap{overflow:auto}}
</style></head><body><div class="wrap">
<h1>中文说唱图谱 · <span>人物缺口盘点</span></h1>
<div class="sub">生成于 2026-11-16 · 用途：判断「补到 200 人」的实际工作量，不动线上数据</div>

<div class="verdict">
<div style="font-size:17px;font-weight:600;margin-bottom:6px">结论</div>
<p>对标站赢在<b>覆盖度</b>，不是界面。我们离「200 人」差 <b>123 位</b>；候选池已备好 <b>${rows.length} 位</b>（全都确认不在现库里），分三档。但真正的瓶颈不是录节点，是<b>头像与关系证据</b>：一级候选 ${tierCount(1)} 人里，维基上能直接取图只有 5 人。</p>
</div>

<div class="cards">
<div class="card"><div class="n stat">${base.counts.artistNodes}<span style="font-size:14px"> / ${base.artists.length - 2}</span></div><div class="t">artist 节点 / 去重后人数</div></div>
<div class="card pink"><div class="n stat">${base.counts.allNodes}</div><div class="t">总节点（含 ${base.counts.groupNodes} 个厂牌）· ${base.counts.relations} 条关系</div></div>
<div class="card gold"><div class="n stat">24<span style="font-size:14px"> / 79</span></div><div class="t">有人像的艺人（30%）</div></div>
<div class="card green"><div class="n stat">${rows.length}</div><div class="t">候选缺口：一级 ${tierCount(1)} / 二级 ${tierCount(2)} / 三级 ${tierCount(3)}</div></div>
</div>

<div class="note"><b>先纠正一个数字：</b>上一轮说的「51 位艺人」只是 <code>catalog.json</code> 里的人工导入表。全库实际是 <b>79 个 artist 节点、14 个厂牌、93 个节点、471 条关系、337 首作品</b>；其中 2 组是重复录入，去重后 77 人。</div>

<h2>先做的四件小事（半天内）</h2>
<table><thead><tr><th style="width:160px">问题</th><th>现状</th><th>处理</th></tr></thead><tbody>
<tr><td>重复节点</td><td>万妮达 <code>vinida</code>/<code>wanida</code>；杨和苏 <code>keyng</code>/<code>yanghesu</code> —— 4 个节点其实只有 2 个人</td><td>按 id 合并，把边与作品迁到主 id，别名并入 <code>aliases</code></td></tr>
<tr><td>孤立节点</td><td>${base.isolated.length} 位艺人零关系：${base.isolated.map(x => x.name).join('、')}</td><td>李佳隆是新说唱 2020 冠军却是孤点，优先补；其余多为社区投稿节点</td></tr>
<tr><td>城市缺失</td><td>${base.artistNoCity}/79 位艺人标着「未标注」</td><td>省份框的叙事基础，补 16 个城市即可让地图完整</td></tr>
<tr><td>证据率</td><td>${base.counts.relationsWithTrack}/${base.counts.relations} 条关系挂到了具体曲目</td><td>这是我们的优势，别在扩库时丢掉；新边尽量带 <code>track</code></td></tr>
</tbody></table>

<h2>缺口名单</h2>
<div class="ctrl">
<button class="on" data-t="all">全部 ${rows.length}</button>
<button data-t="1">一级 ${tierCount(1)}</button>
<button data-t="2">二级 ${tierCount(2)}</button>
<button data-t="3">三级 ${tierCount(3)}</button>
<input class="search" id="q" placeholder="搜人名、城市或来源依据…">
</div>
<div class="tblwrap"><table><thead><tr><th style="width:180px">人物</th><th style="width:70px">层级</th><th style="width:80px">城市</th><th>入选依据</th><th style="width:130px">维基头像</th><th style="width:90px">预估新增边</th></tr></thead><tbody id="tb"></tbody></table></div>
<div class="small" style="margin-top:8px">「预估新增边」按层级粗估（一级 4 / 二级 2 / 三级 1），用于算工作量，不是承诺。头像一栏只核查了维基百科；Deezer 需人工复核，未计入。</div>

<h2>补到 200 人的路线与工作量</h2>
<div class="phase"><div class="who">阶段 0</div><div><b>数据体检</b><br><span class="small">合并 2 组重复、补 11 个孤点、填 16 个城市</span></div><div class="hr">0.5–1 天</div></div>
<div class="phase"><div class="who">阶段 1</div><div><b>一级 ${tierCount(1)} 人</b><br><span class="small">节目冠军/四强、厂牌核心、台港代表。补完艺人到 ${77 + tierCount(1)} 人，关系约 +${tierCount(1) * 4} 条</span></div><div class="hr">15–25 小时</div></div>
<div class="phase"><div class="who">阶段 2</div><div><b>二级挑 ${123 - tierCount(1)} 人</b><br><span class="small">凑够 200 人；优先选有节目/厂牌交集、能一次带来多条边的</span></div><div class="hr">25–40 小时</div></div>
<div class="phase"><div class="who">阶段 3</div><div><b>头像攻坚 + 三级人物</b><br><span class="small">维基严格命中 ${wikiHits}/${tierCount(1) + tierCount(2)}（${Math.round(wikiHits / (tierCount(1) + tierCount(2)) * 100)}%），其余走 Deezer 人工复核与用户投稿</span></div><div class="hr">按需</div></div>
<div class="small" style="margin-top:14px">单人成本：建节点 5–8 分钟 + 找证据建边 8–15 分钟 + 头像 5–30 分钟 + 复核 3–5 分钟 ≈ 20–60 分钟。所以「补到 200 人」是 <b>40–65 小时</b>的活，不是一次会话能做完的；先把一级 ${tierCount(1)} 人做完，性价比最高。</div>

<h2>来源</h2>
<div class="small">${pool.sources.map(s => '· ' + s).join('<br>')}</div>
</div>
<script>
const DATA=${JSON.stringify(data)};
let tier='all', query='';
const tb=document.getElementById('tb');
function render(){
  const list=DATA.rows.filter(r=>(tier==='all'||r.tier===+tier)&&(!query||(r.name+' '+r.aliases.join(' ')+' '+r.city+' '+r.note).toLowerCase().includes(query)));
  tb.innerHTML=list.map(r=>{
    const av=r.avatar==='wiki-image'?'<span class="av good">有图 · 可直接用</span>'
      :r.avatar==='wiki-page-no-image'?'<span class="av mid">有词条 · 无图</span>'
      :r.avatar==='wiki-image-needs-review'?'<span class="av mid">待人工确认</span>'
      :r.avatar==='not-checked'?'<span class="av bad">未核查</span>'
      :'<span class="av bad">无维基词条</span>';
    return '<tr><td><span class="name">'+r.name+'</span>'+(r.aliases.length?'<div class="alias">'+r.aliases.join(' / ')+'</div>':'')+'</td>'
      +'<td><span class="pill t'+r.tier+'">'+['','一级','二级','三级'][r.tier]+'</span></td><td>'+r.city+'</td><td>'+r.note+'</td><td>'+av+'</td><td class="stat">+'+r.edges+'</td></tr>';
  }).join('');
}
document.querySelectorAll('button[data-t]').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('button[data-t]').forEach(x=>x.classList.remove('on'));
  b.classList.add('on');tier=b.dataset.t;render();
});
document.getElementById('q').oninput=e=>{query=e.target.value.toLowerCase();render();};
render();
</script></body></html>`;

await writeFile(resolve(ROOT, 'research/gap-report.html'), html);
console.log('已生成 research/gap-report.html');
console.log('候选', rows.length, '维基可直接用头像', wikiHits, '缺口', 123);
