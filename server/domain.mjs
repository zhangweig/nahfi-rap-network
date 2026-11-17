import {createHash, randomUUID} from 'node:crypto';
import {resolveProvince} from './provinces.mjs';

export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class InputError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
const text=(value,label,max=200,required=true)=>{
  if(typeof value!=='string'||value.length>max|| (required&&!value.trim())) throw new InputError(`${label}不能为空且最多 ${max} 字`);
  return value.trim();
};
const url=(value,label)=>{const s=text(value,label,1000);try{if(new URL(s).protocol!=='https:')throw 0;}catch{throw new InputError(`${label}必须为 HTTPS 链接`);}return s;};
export function avatar(value='') {
  if(!value)return '';
  const s=text(value,'头像地址',500);
  if(/^\/avatars\/[a-zA-Z0-9_./-]+\.(png|webp|gif|jpg|jpeg)$/i.test(s)&&!s.includes('..'))return s;
  return url(s,'头像地址');
}
export function validateSubmission(input, data) {
  if(!input||typeof input!=='object')throw new InputError('投稿格式错误');
  if(input.website)throw new InputError('无法提交');
  const kind=input.kind;
  if(!['artist','relationship','beef'].includes(kind))throw new InputError('不支持的投稿类型');
  const payload=input.payload;
  if(!payload||typeof payload!=='object')throw new InputError('请填写投稿内容');
  // 来源已从投稿表单里移除，站长审核时补；填了就照旧校验。
  const evidenceUrl=String(payload.sourceUrl||'').trim();
  const evidence=evidenceUrl
    ? {title:text(payload.sourceTitle||'来源','来源标题',200),url:url(evidenceUrl,'来源链接'),note:text(payload.sourceNote||'','证据说明',1500)}
    : null;
  if(evidence&&new URL(evidence.url).pathname==='/')throw new InputError('请提供具体资料页面，不要填写网站首页');
  const targetId=input.targetId?text(input.targetId,'修改对象',100):null;
  const collection=kind==='artist'?data.nodes:kind==='beef'?(data.beefs||[]):data.relations;
  const original=targetId?collection.find(x=>x.id===targetId):null;
  if(targetId&&!original)throw new InputError('修改对象不存在',404);
  if(original&&input.baseRevision!==fingerprint(original))throw new InputError('该记录已更新，请刷新后重新编辑',409);
  let result;
  if(kind==='beef'){
    // BEEF 是事件对象：只收参与方 + 标题 + 来源，年份/经过/证据链正文一律不收，
    // 由站长核实后补。来源强制 HTTPS 且不能是首页——涉及真人指控，标准比其他投稿更严。
    if(!evidence)throw new InputError('beef 必须提供公开可查证的来源链接，不接受纯文字爆料');
    const sideIds=(Array.isArray(payload.sides)?payload.sides:[])
      .map(s=>typeof s==='string'?s:(s&&typeof s.nodeId==='string'?s.nodeId:''))
      .filter(Boolean);
    if(sideIds.length<1||sideIds.length>2)throw new InputError('请提供一到两方当事人');
    if(new Set(sideIds).size!==sideIds.length)throw new InputError('两方不能是同一个人');
    if(!sideIds.every(id=>data.nodes.some(n=>n.id===id)))throw new InputError('当事人必须是已公开的人物');
    const pairKey=sideIds.slice().sort().join('|');
    const title=text(payload.title,'事件标题',200);
    if((data.beefs||[]).some(b=>b.id!==targetId&&b.title===title&&b.sides.filter(Boolean).map(s=>s.nodeId).sort().join('|')===pairKey))throw new InputError('相同 BEEF 已收录');
    result={
      ...(original||{}),
      id:targetId||`community-beef-${randomUUID()}`,
      sides:[sideIds[0]?{nodeId:sideIds[0]}:(original?.sides?.[0]||{nodeId:sideIds[1]}),sideIds[1]?{nodeId:sideIds[1]}:null],
      title,
      status:'unverified',
      moments:[],
      evidence:evidence?[evidence]:[],
      note:text(payload.note||'','补充说明',1500,false),
    };
  } else if(kind==='artist'){
    const name=text(payload.name,'艺名',80);
    if(data.nodes.some(n=>n.id!==targetId&&n.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new InputError('已有同名人物，请通过人物档案提交编辑');
    const aliases=text(payload.aliases??'','别名',250,false).split(/[,，、\n]/).map(x=>x.trim()).filter(Boolean);
    // 新表单传省份，老客户端可能还传城市，统一折算成省级行政区。
    const city=resolveProvince(text(payload.city||'', '省份', 20, false));
    if(!city)throw new InputError('省份只能选 34 个省级行政区之一');
    result={...(original||{}),id:targetId||`community-${randomUUID()}`,name,aliases,kind:payload.kind==='group'?'group':'artist',city,category:text(payload.category||original?.category||'说唱音乐人','分类',60),color:original?.color||'#ed9d43',initials:original?.initials||name.slice(0,2),description:text(payload.description,'简介',2000),avatarUrl:avatar(payload.avatarUrl||original?.avatarUrl||''),sources:evidence?[evidence]:(original?.sources||[])};
  } else {
    const source=text(payload.source,'起点人物',100), target=text(payload.target,'终点人物',100);
    if(source===target||![source,target].every(id=>data.nodes.some(n=>n.id===id)))throw new InputError('请选择两个不同且已公开的人物');
    const type=payload.type;
    if(!['member','affiliation','collaboration','production'].includes(type))throw new InputError('关系类型不正确');
    const year=Number(payload.year);
    if(!Number.isInteger(year)||year<1900||year>new Date().getFullYear())throw new InputError('请填写有效的资料 / 作品年份');
    result={id:targetId||`community-rel-${randomUUID()}`,source,target,type,label:text(payload.label,'关系说明',200),observedYear:year,evidence:evidence?[evidence]:(original?.evidence||[]),status:'verified'};
    if(type==='collaboration'||type==='production'){
      const title=text(payload.trackTitle,'作品名称',180);
      if(!['录音室版','现场版','混音版','发行版'].includes(payload.version))throw new InputError('请选择作品版本');
      const trackId=original?.track?.id||`community-work-${randomUUID()}`;
      if(original?.track&&data.relations.filter(r=>r.track?.id===trackId).length>1)throw new InputError('多人作品关系请由维护者统一核对后修改');
      result.track={id:trackId,title,year,version:payload.version};
    }
    if(data.relations.some(r=>r.id!==targetId&&r.type===type&&[r.source,r.target].sort().join('|')===[source,target].sort().join('|')&&r.label===result.label))throw new InputError('相同关系已收录');
  }
  return {kind,targetId,baseRevision:original?fingerprint(original):null,payload:result,contributor:text(input.contributor||'匿名乐迷','投稿昵称',60),message:text(input.message||'','补充说明',1500,false)};
}

const REPORT_ISSUES = {
  artist: ['info', 'missing', 'source', 'other'],
  avatar: ['wrong-person', 'low-quality', 'missing', 'other'],
  relation: ['not-true', 'wrong-person', 'wrong-type', 'missing', 'other'],
  work: ['info', 'missing', 'source', 'other'],
};

/**
 * 勘误只入队，不改数据。
 *
 * 和 validateSubmission 的根本区别：勘误不需要给出「正确的值」，只需要指出哪里可疑。
 * 所以这里只校验「对象真实存在 + 说明具体 + 来源可选但必须站得住」，剩下的交给站长判断。
 */
export function validateReport(input, data) {
  if (!input || typeof input !== 'object') throw new InputError('勘误格式错误');
  if (input.website) throw new InputError('无法提交');
  const targetType = String(input.targetType || '');
  const allowed = REPORT_ISSUES[targetType];
  if (!allowed) throw new InputError('不支持的勘误类型');
  const targetId = text(input.targetId, '勘误对象', 120);
  const collection = targetType === 'work' ? data.works : targetType === 'relation' ? data.relations : data.nodes;
  if (!collection.some(item => item.id === targetId)) throw new InputError('找不到要勘误的记录', 404);
  const message = text(input.message, '勘误说明', 800);
  if (message.length < 6) throw new InputError('请把问题写具体一点（至少 6 个字）');
  const rawSource = String(input.sourceUrl || '').trim();
  const sourceUrl = rawSource ? url(rawSource, '来源链接') : '';
  if (sourceUrl && new URL(sourceUrl).pathname === '/') throw new InputError('请提供具体资料页面，不要填写网站首页');
  return {
    targetType,
    targetId,
    issue: allowed.includes(input.issue) ? input.issue : 'other',
    message,
    sourceUrl,
    contact: text(input.contact || '', '昵称', 60, false),
  };
}

/**
 * 审核通过时写入 approved 表的 payload。
 * BEEF 提交阶段一律 unverified；站长批准即表示来源已核实，此时才翻成 verified，
 * 否则公开档案会永远挂着一个「待核实」标记，与人物/关系投稿的语义不一致。
 */
export function publishPayload(kind, payloadJson) {
  if (kind !== 'beef') return payloadJson;
  return JSON.stringify({...JSON.parse(payloadJson), status: 'verified'});
}

export function compose(base, records) {
  const nodes=new Map(base.nodes.map(x=>[x.id,x]));
  const relations=new Map(base.relations.map(x=>[x.id,x]));
  const works=new Map(base.works.map(x=>[x.id,x]));
  // BEEF 与其他投稿共用 approved 表，但单独成一个数组：事件对象不进 relations，
  // 避免污染关系条数统计。种子条目放 base.beefs，审核通过后按 id 覆盖。
  const beefs=new Map((base.beefs||[]).map(x=>[x.id,x]));
  for(const row of records){
    const item=JSON.parse(row.payload);
    if(row.kind==='beef')beefs.set(item.id,item);
    else (row.kind==='artist'?nodes:relations).set(item.id,item);
  }
  // Rebuild community works from approved evidence only. Original music catalog stays intact.
  for(const edge of relations.values()){
    if(!edge.id.startsWith('community-rel-')&&!records.some(r=>r.kind==='relationship'&&r.entity_id===edge.id))continue;
    if(!edge.track)continue;
    const ids=[edge.source,edge.target];
    works.set(edge.track.id,{...edge.track,artistIds:ids,creditedAs:ids.map(id=>nodes.get(id)?.name||id).join(' / '),album:'',evidence:edge.evidence});
  }
  return {nodes:[...nodes.values()],relations:[...relations.values()],works:[...works.values()],beefs:[...beefs.values()]};
}
