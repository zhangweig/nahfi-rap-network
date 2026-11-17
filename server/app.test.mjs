import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from './app.mjs';
const base={nodes:[{id:'one',name:'艺人甲',kind:'artist',city:'成都',color:'#efaa50',initials:'甲',category:'说唱音乐人',description:'原简介'},{id:'two',name:'艺人乙',kind:'artist',city:'上海',color:'#efaa50',initials:'乙',category:'说唱音乐人',description:'原简介'}],relations:[],works:[]};
const password='test-only-long-owner-password';
const proof={sourceTitle:'官方档案',sourceUrl:'https://example.com/artist',sourceNote:'测试数据：官方资料提供关联城市和艺名'};
const artist=(name='新艺人')=>({kind:'artist',payload:{name,city:'成都',description:'测试人物简介',...proof},contributor:'测试乐迷'});
async function setup(t,options={}){
  const folder=mkdtempSync(join(tmpdir(),'nahfi-test-'));const dbPath=join(folder,'test.sqlite');
  let app=createApplication({base,dbPath,adminPassword:password,rateLimit:false,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  let origin=`http://127.0.0.1:${app.server.address().port}`;
  const request=async(path,body,cookie,extra={})=>{const response=await fetch(origin+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin}),...(cookie?{Cookie:cookie}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const login=async()=>{const r=await request('/login',{password});assert.equal(r.status,200);return r.cookie;};
  const restart=async()=>{await app.close();app=createApplication({base,dbPath,adminPassword:password,rateLimit:false,...options});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${app.server.address().port}`;};
  t.after(async()=>{await app.close();rmSync(folder,{recursive:true,force:true});});return {request,login,restart};
}
test('匿名投稿在批准之前完全不公开，只有站长能审核',async t=>{
  const {request,login}=await setup(t);const r=await request('/submissions',artist());assert.equal(r.status,201);
  assert.equal((await request('/data')).data.nodes.length,2);
  assert.equal((await request('/review')).status,401);
  assert.equal((await request(`/review/${r.data.id}`,{action:'approve'})).status,401);
  const cookie=await login();const queue=await request('/review',undefined,cookie);assert.equal(queue.data.items.length,1);assert.equal(queue.data.items[0].contributor,'测试乐迷');
  assert.equal((await request(`/review/${r.data.id}`,{action:'approve'},cookie)).status,200);
  const publicData=(await request('/data')).data;assert.equal(publicData.nodes.length,3);assert.ok(!JSON.stringify(publicData).includes('测试乐迷'));assert.ok(publicData.nodes.find(n=>n.name==='新艺人'));
  assert.equal((await request(`/review/${r.data.id}`,{action:'approve'},cookie)).status,409);
});
test('退回不会发布，审核和已通过内容持久化到磁盘',async t=>{
  const {request,login,restart}=await setup(t);let cookie=await login();const rejected=await request('/submissions',artist('退回人物'));
  assert.equal((await request(`/review/${rejected.data.id}`,{action:'reject'},cookie)).status,400);
  assert.equal((await request(`/review/${rejected.data.id}`,{action:'reject',note:'请补充证据'},cookie)).status,200);
  const accepted=await request('/submissions',artist('保留人物'));await request(`/review/${accepted.data.id}`,{action:'approve'},cookie);await restart();
  const data=(await request('/data')).data;assert.ok(data.nodes.some(n=>n.name==='保留人物'));assert.ok(!data.nodes.some(n=>n.name==='退回人物'));
  cookie=await login();const review=await request('/review',undefined,cookie);assert.equal(review.data.audit.length,2);assert.equal(review.data.items.find(i=>i.id===rejected.data.id).review_note,'请补充证据');
});
test('编辑需要当前版本，冲突投稿不能覆盖已审核更改',async t=>{
  const {request,login}=await setup(t),cookie=await login();const revision=(await request('/data')).data.revisions.one;
  const edit={...artist('艺人甲'),targetId:'one',baseRevision:revision};
  const first=await request('/submissions',edit),second=await request('/submissions',{...edit,payload:{...edit.payload,description:'另一份修改'}});
  assert.equal(first.status,201);assert.equal(second.status,201);await request(`/review/${first.data.id}`,{action:'approve'},cookie);
  assert.equal((await request(`/review/${second.data.id}`,{action:'approve'},cookie)).status,409);
  assert.equal((await request('/submissions',edit)).status,409);
  assert.equal((await request('/data')).data.nodes.find(n=>n.id==='one').description,'测试人物简介');
});
test('合作关系审核后生成对应作品，成员关系不伪造合作',async t=>{
  const {request,login}=await setup(t),cookie=await login();
  const payload={source:'one',target:'two',type:'collaboration',year:2024,label:'测试合作',trackTitle:'测试作品',version:'录音室版',...proof};
  const submission=await request('/submissions',{kind:'relationship',payload});assert.equal(submission.status,201);assert.equal((await request('/data')).data.works.length,0);
  await request(`/review/${submission.data.id}`,{action:'approve'},cookie);const data=(await request('/data')).data;assert.equal(data.relations.length,1);assert.equal(data.works.length,1);assert.deepEqual(data.works[0].artistIds,['one','two']);
  const member=await request('/submissions',{kind:'relationship',payload:{...payload,type:'member',label:'资料中的成员'}});await request(`/review/${member.data.id}`,{action:'approve'},cookie);assert.equal((await request('/data')).data.works.length,1);
});
test('拒绝伪造状态、自环、未知人物、不安全来源和头像路径',async t=>{
  const {request}=await setup(t);
  const input={...artist(),status:'approved',role:'owner'};await request('/submissions',input);assert.equal((await request('/data')).data.nodes.length,2);
  for(const patch of [{sourceUrl:'javascript:alert(1)'},{avatarUrl:'/avatars/../../.data/owner-key.png'},{avatarUrl:'data:image/svg+xml,test'},{name:'艺人甲'},{description:''}])assert.equal((await request('/submissions',{...artist('其他人物'),payload:{...artist('其他人物').payload,...patch}})).status,400);
  for(const target of ['one','missing'])assert.equal((await request('/submissions',{kind:'relationship',payload:{source:'one',target,type:'member',year:2024,label:'test',...proof}})).status,400);
});
test('跨站请求被阻止；错误登录无权限；登出立即撤销会话',async t=>{
  const {request,login}=await setup(t);assert.equal((await request('/submissions',artist(),undefined,{Origin:'https://evil.example'})).status,403);
  assert.equal((await request('/login',{password:'wrong'})).status,401);
  const cookie=await login();assert.equal((await request('/session',undefined,cookie)).data.owner,true);await request('/logout',{},cookie);assert.equal((await request('/review',undefined,cookie)).status,401);
});
test('待审同名人物并发提交只能批准一个',async t=>{
  const {request,login}=await setup(t),cookie=await login();const first=await request('/submissions',artist()),second=await request('/submissions',artist());
  await request(`/review/${first.data.id}`,{action:'approve'},cookie);assert.equal((await request(`/review/${second.data.id}`,{action:'approve'},cookie)).status,409);
});
test('限制登录尝试次数',async t=>{
  const {request}=await setup(t,{rateLimit:true});for(let i=0;i<10;i++)assert.equal((await request('/login',{password:'wrong'})).status,401);assert.equal((await request('/login',{password})).status,429);
});
test('待审重复关系只能发布一次，重启会撤销旧站长会话',async t=>{
  const {request,login,restart}=await setup(t),cookie=await login();
  const value={kind:'relationship',payload:{source:'one',target:'two',type:'affiliation',year:2020,label:'历史关联测试',...proof}};
  const first=await request('/submissions',value),second=await request('/submissions',value);
  await request(`/review/${first.data.id}`,{action:'approve'},cookie);
  assert.equal((await request(`/review/${second.data.id}`,{action:'approve'},cookie)).status,409);
  await restart();assert.equal((await request('/review',undefined,cookie)).status,401);
});

test('只填名字、省份、简介就能投稿，来源可以留空',async t=>{
  const {request,login}=await setup(t);
  const minimal=await request('/submissions',{kind:'artist',payload:{name:'极简人物',city:'新疆',description:'只填三项'},contributor:'匿名乐迷'});
  assert.equal(minimal.status,201);
  const cookie=await login();
  assert.equal((await request(`/review/${minimal.data.id}`,{action:'approve'},cookie)).status,200);
  const node=(await request('/data')).data.nodes.find(n=>n.name==='极简人物');
  assert.equal(node.city,'新疆');
  assert.deepEqual(node.sources,[]);
});

test('旧客户端提交城市名会折算成省级行政区',async t=>{
  const {request,login}=await setup(t);
  const r=await request('/submissions',{kind:'artist',payload:{name:'城市来的人',city:'乌鲁木齐',description:'用城市提交'},contributor:'匿名乐迷'});
  assert.equal(r.status,201);
  const cookie=await login();
  await request(`/review/${r.data.id}`,{action:'approve'},cookie);
  assert.equal((await request('/data')).data.nodes.find(n=>n.name==='城市来的人').city,'新疆');
});

test('关系投稿不再强制要求来源，证据为空也能通过',async t=>{
  const {request,login}=await setup(t);
  const r=await request('/submissions',{kind:'relationship',payload:{source:'one',target:'two',type:'member',year:2020,label:'同一组合'},contributor:'匿名乐迷'});
  assert.equal(r.status,201);
  const cookie=await login();
  assert.equal((await request(`/review/${r.data.id}`,{action:'approve'},cookie)).status,200);
  const rel=(await request('/data')).data.relations.find(x=>x.label==='同一组合');
  assert.deepEqual(rel.evidence,[]);
  assert.equal(rel.type,'member');
});

test('勘误只入队，不改公开数据，只有站长能处理',async t=>{
  const {request,login}=await setup(t);
  const report={targetType:'avatar',targetId:'one',issue:'wrong-person',message:'这张头像不是本人，是另一位歌手',contact:'路过的乐迷'};
  const created=await request('/reports',report);assert.equal(created.status,201);
  // 勘误绝不改动公开数据
  assert.equal((await request('/data')).data.nodes.length,2);
  assert.equal((await request('/reports')).status,401);
  const cookie=await login();
  const queue=await request('/reports',undefined,cookie);
  assert.equal(queue.data.items.length,1);assert.equal(queue.data.items[0].status,'open');
  assert.equal(queue.data.items[0].contact,'路过的乐迷');
  assert.equal((await request(`/reports/${created.data.id}`,{action:'resolve',note:'已换成官方宣传照'},cookie)).status,200);
  assert.equal((await request(`/reports/${created.data.id}`,{action:'resolve'},cookie)).status,409);
  assert.equal((await request('/reports',undefined,cookie)).data.items[0].status,'resolved');
});
test('勘误的对象必须真实存在，说明要具体，蜜罐拦机器人',async t=>{
  const {request}=await setup(t);
  assert.equal((await request('/reports',{targetType:'avatar',targetId:'nobody',message:'这条记录根本不存在'})).status,404);
  assert.equal((await request('/reports',{targetType:'avatar',targetId:'one',message:'错的'})).status,400);
  assert.equal((await request('/reports',{targetType:'unknown',targetId:'one',message:'类型不在白名单里'})).status,400);
  assert.equal((await request('/reports',{targetType:'artist',targetId:'one',message:'机器人填了蜜罐字段',website:'http://spam'})).status,400);
  assert.equal((await request('/reports',{targetType:'artist',targetId:'one',issue:'info',message:'简介里的城市写错了，应为重庆',sourceUrl:'https://example.com/profile'})).status,201);
});

// ---- BEEF 众包管线：与人物/关系共用投稿+审核，但独立成层 ----
const beefProof={sourceTitle:'公开采访',sourceUrl:'https://example.com/beef-report',sourceNote:'测试数据：双方公开采访'};
const beefPayload={sides:['one','two'],title:'艺人甲 vs 艺人乙',...beefProof,note:'待核实的冲突线索'};
test('BEEF 投稿审核前不公开，批准后带来源进入公开数据并标已核实',async t=>{
  const {request,login}=await setup(t);
  const created=await request('/submissions',{kind:'beef',payload:beefPayload,contributor:'线索提供者'});
  assert.equal(created.status,201);
  // 审核前：公开关系网里既没有 beef，也没有投稿者昵称
  const before=(await request('/data')).data;
  assert.deepEqual(before.beefs,[]);
  assert.ok(!JSON.stringify(before).includes('线索提供者'));
  const cookie=await login();
  const queue=await request('/review',undefined,cookie);
  assert.equal(queue.data.items.length,1);
  assert.equal(queue.data.items[0].kind,'beef');
  assert.equal((await request(`/review/${created.data.id}`,{action:'approve'},cookie)).status,200);
  const after=(await request('/data')).data;
  assert.equal(after.beefs.length,1);
  assert.equal(after.beefs[0].title,'艺人甲 vs 艺人乙');
  assert.equal(after.beefs[0].status,'verified');
  assert.equal(after.beefs[0].evidence[0].url,beefProof.sourceUrl);
  assert.ok(!JSON.stringify(after).includes('线索提供者'));
  assert.equal((await request(`/review/${created.data.id}`,{action:'approve'},cookie)).status,409);
});
test('BEEF 校验：必须有 HTTPS 来源、当事人须已公开、同事件去重、蜜罐拦截',async t=>{
  const {request,login}=await setup(t);
  assert.equal((await request('/submissions',{kind:'beef',payload:{...beefPayload,sourceUrl:'http://example.com/x'}})).status,400);
  assert.equal((await request('/submissions',{kind:'beef',payload:{...beefPayload,sourceUrl:''}})).status,400);
  assert.equal((await request('/submissions',{kind:'beef',payload:{...beefPayload,sides:['one','one']}})).status,400);
  assert.equal((await request('/submissions',{kind:'beef',payload:{...beefPayload,sides:['one','nobody']}})).status,400);
  assert.equal((await request('/submissions',{kind:'beef',payload:beefPayload,website:'http://spam'})).status,400);
  // 对手待补充：只给一方也接受
  assert.equal((await request('/submissions',{kind:'beef',payload:{...beefPayload,sides:['one'],title:'艺人甲 · 对手待补充'}})).status,201);
  // 重复投稿在入队时允许（与关系投稿一致），真正拦截发生在批准时，见下一条用例。
  assert.equal((await request('/submissions',{kind:'beef',payload:beefPayload})).status,201);
  assert.equal((await request('/submissions',{kind:'beef',payload:beefPayload})).status,201);
});
test('BEEF 审核时的重复检测：两条不同投稿指向同一事件，第二条通过后被拦下',async t=>{
  const {request,login}=await setup(t);
  const first=await request('/submissions',{kind:'beef',payload:beefPayload});
  const second=await request('/submissions',{kind:'beef',payload:{...beefPayload,contributor:'另一人'}});
  assert.equal(first.status,201);assert.equal(second.status,201);
  const cookie=await login();
  assert.equal((await request(`/review/${first.data.id}`,{action:'approve'},cookie)).status,200);
  const conflict=await request(`/review/${second.data.id}`,{action:'approve'},cookie);
  assert.equal(conflict.status,409);
  assert.equal((await request('/data')).data.beefs.length,1);
});
