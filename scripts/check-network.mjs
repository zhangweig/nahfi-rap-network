import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readdirSync,readFileSync} from 'node:fs';

// Use the already-installed Vite toolchain; no additional test dependency.
const result = await build({
  stdin: {contents: "export * from './src/data/rap-data'; export * from './src/lib/network'; export * from './src/lib/catalog';", resolveDir: process.cwd()},
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const {nodes, works, relations, trackCount, makeGraph, shortestRoute, makeRenderData, workMatches, artistMatches} = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
);
const ids = new Set(nodes.map(node => node.id));
assert.ok(nodes.filter(node=>node.kind==='artist').length>=50, '本次目录应包含至少 50 位艺人');
assert.ok(works.length>=300, '本次目录应包含至少 300 个作品版本');
assert.equal(ids.size, nodes.length, '节点 ID 必须唯一');
assert.equal(new Set(relations.map(edge => edge.id)).size, relations.length, '关系 ID 必须唯一');
for (const edge of relations) {
  assert.ok(ids.has(edge.source) && ids.has(edge.target), `关系端点不存在：${edge.id}`);
  assert.notEqual(edge.source, edge.target);
  assert.ok(edge.evidence.length > 0);
  for (const source of edge.evidence) {
    const url = new URL(source.url);
    assert.equal(url.protocol, 'https:');
    assert.notEqual(url.pathname, '/', '证据不能指向网站首页');
    assert.ok(source.title && source.note);
  }
  if (edge.type === 'collaboration') assert.ok(edge.track?.id && edge.track.year && edge.track.version);
}
const types = ['member', 'collaboration', 'production', 'affiliation'];
const graph = makeGraph(types, []);
assert.equal(graph.size, relations.length, '同一对艺人的不同合作必须全部保留');
assert.ok(graph.edges('yitai', 'air').length >= 3, '王以太和艾热的多个作品版本应共存');
assert.deepEqual(shortestRoute('yitai', 'air', ['collaboration'], []), ['yitai', 'air']);
const route = shortestRoute('ma', 'shengyu', types, []);
assert.ok(route && route.length > 2, '成都与长沙之间应存在有据可查的路径');
for (let i = 1; i < route.length; i++) assert.ok(graph.hasEdge(route[i - 1], route[i]));
assert.equal(shortestRoute('ma', 'shengyu', ['member'], []), null, '成员筛选不能借用合作关系');
assert.equal(shortestRoute('ma', 'shengyu', types, ['成都']), null, '城市筛选必须约束路径');
assert.equal(shortestRoute('ma', 'air', [], []), null);
assert.equal(shortestRoute('missing', 'air', types, []), null);
assert.deepEqual(shortestRoute('ma', 'ma', types, []), ['ma']);
// 只看历史关联时应只剩这一类边，数量随资料扩充增长，所以断言「有」而不是写死条数。
assert.ok(makeGraph(['affiliation'], []).size >= 2, '历史关联应能被单独筛选出来');

const workIds=new Set(works.map(work=>work.id));
assert.equal(workIds.size,works.length,'作品 ID 必须唯一');
assert.equal(trackCount,works.length);
const catalogIds=new Set(nodes.flatMap(node=>node.catalogArtistIds||[]));
const rawRecords=new Map();
for(const file of readdirSync('research/catalog').filter(name=>name.endsWith('.json'))){
  for(const row of JSON.parse(readFileSync(`research/catalog/${file}`,'utf8')).results){
    if(!rawRecords.has(row.trackId))rawRecords.set(row.trackId,row);
  }
}
for(const work of works){
  assert.ok(work.artistIds.length>0&&work.artistIds.every(id=>ids.has(id)));
  assert.equal(new Set(work.artistIds).size,work.artistIds.length);
  assert.ok(work.evidence.length&&work.title&&work.creditedAs);
  assert.ok(work.year>=1990&&work.year<=2026);
  if(work.catalogTrackId){
    const original=rawRecords.get(work.catalogTrackId);
    assert.ok(original,`作品必须有原始目录证据：${work.id}`);
    assert.equal(work.title,original.trackName,'保留平台原始作品名');
    assert.equal(work.releaseDate,original.releaseDate.slice(0,10));
    assert.ok(work.releaseDate<='2026-11-13','不导入未来发行项');
    assert.ok(catalogIds.has(work.catalogArtistId),'拒绝不在身份白名单中的同名艺人');
    assert.equal(work.catalogArtistId,original.artistId);
    assert.equal(new URL(work.evidence[0].url).searchParams.get('i'),String(work.catalogTrackId));
  }
  const trackEdges=relations.filter(edge=>edge.track?.id===work.id);
  assert.equal(trackEdges.length,work.artistIds.length*(work.artistIds.length-1)/2,'同曲多人关系只生成一次');
  const pairs=new Set();
  for(const edge of trackEdges){
    assert.ok(work.artistIds.includes(edge.source)&&work.artistIds.includes(edge.target));
    pairs.add([edge.source,edge.target].sort().join('|'));
  }
  assert.equal(pairs.size,trackEdges.length);
}
for(const edge of relations.filter(edge=>edge.track))assert.ok(workIds.has(edge.track.id));
for(const node of nodes.filter(node=>node.kind==='artist')){
  assert.ok(works.some(work=>work.artistIds.includes(node.id)),`艺人必须有作品：${node.id}`);
}
assert.ok(!nodes.some(node=>node.name==='TFBOYS'),'拒绝搜索“小精灵”产生的无关艺人');
assert.ok(artistMatches(nodes.find(node=>node.id==='pharaoh'),'Pharaoh'));
assert.ok(works.some(work=>workMatches(work,'发光弹')),'简体搜索应命中繁体曲名');
assert.ok(works.some(work=>workMatches(work,'發光彈')));
assert.ok(works.some(work=>workMatches(work,'Bombshell')),'支持专辑检索');
const solo=works.find(work=>work.title==='R&B All Night');
assert.ok(solo);
assert.deepEqual(solo.artistIds,['knowknow'],'团体署名不能推定全部成员参与');
const render=makeRenderData(types,'全部城市');
assert.ok(render.links.length<relations.length,'画布合并多次合作');
assert.equal(render.links.reduce((total,edge)=>total+edge.count,0),relations.length,'合并绘制不能丢失记录');
assert.equal(makeRenderData([],'全部城市').links.length,0);
const cityRender=makeRenderData(types,'成都');
assert.ok(cityRender.nodes.every(node=>node.city==='成都'));
assert.ok(cityRender.links.every(edge=>cityRender.nodes.some(node=>node.id===edge.source)&&cityRender.nodes.some(node=>node.id===edge.target)));
console.log(`通过：${nodes.length} 个节点、${relations.length} 条关系、${trackCount} 个作品版本；多重边、跨城路径、关系与城市筛选均正常。`);
console.log('通过：原始曲目证据、艺人 ID、发行日期、同曲署名、图谱聚合、简繁体/艺名/专辑搜索。');
