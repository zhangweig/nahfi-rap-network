import {useEffect,useMemo,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {api,ownerToken,useDataset} from '../state/Dataset';
import type {ArtistNode,Relationship} from '../data/types';
import {PROVINCE_NAMES,UNKNOWN_PROVINCE,provinceLabel,provinceOf} from '../lib/province';
export type EditorTarget={kind:'artist';record?:ArtistNode}|{kind:'relationship';record?:Relationship;source?:string};
const relationNames:Record<string,string>={member:'组合成员',collaboration:'歌曲合作',production:'幕后制作',affiliation:'历史关联'};
/** 配置了飞书表单时，新增投稿走飞书；编辑已有记录仍用站内表单（需要比对修改前的版本）。 */
const FEISHU_FORM=String((import.meta as {env?:Record<string,string>}).env?.VITE_FEISHU_FORM_URL||'').trim();
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{
    ref.current?.showModal();
    // showModal() focuses the first focusable child (the close button); let a field opt in instead.
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  },[]);
  return <dialog ref={ref} className="pixel-dialog" onCancel={e=>{e.preventDefault();onClose();}}><header><h2>{title}</h2><button aria-label="关闭弹窗" onClick={onClose}>×</button></header>{children}</dialog>;
}
export function SubmissionEditor({target,onClose}:{target:EditorTarget;onClose:()=>void}){
  const [local,setLocal]=useState(false);
  if(FEISHU_FORM&&!target.record&&!local)return <FeishuSubmit kind={target.kind} onClose={onClose} onLocal={()=>setLocal(true)}/>;
  return <LocalEditor target={target} onClose={onClose}/>;
}
function FeishuSubmit({kind,onClose,onLocal}:{kind:'artist'|'relationship';onClose:()=>void;onLocal:()=>void}){
  const artist=kind==='artist';
  const open=()=>window.open(FEISHU_FORM,'_blank','noopener,noreferrer');
  return <Modal title={artist?'补充人物信息':'补充人物关系'} onClose={onClose}>
    <div className="feishu-submit">
      <p className="form-intro">投稿在飞书表单里填写。站长审核通过后，这条内容会自动出现在关系网上。</p>
      <div className="form-section">先准备好这些</div>
      <ul className="feishu-prepare">
        {artist?<>
          <li>艺名，以及常用别名</li>
          <li>所在城市 <small>只用于归入省份聚落</small></li>
          <li>一句话简介</li>
        </>:<>
          <li>两个人物名 <small>已收录的会直接认出来</small></li>
          <li>关系类型：组合成员 / 歌曲合作 / 幕后制作 / 历史关联</li>
          <li>作品名，或资料年份</li>
        </>}
        <li><b>能打开的来源链接</b>，不要填网站首页</li>
      </ul>
      <p className="field-help">表单在新窗口打开，填完回来不用刷新。</p>
      <footer className="form-actions">
        <button onClick={onLocal}>改用站内表单</button>
        <button className="primary" onClick={open}>打开飞书表单 →</button>
      </footer>
    </div>
  </Modal>;
}
/** 可搜索的人物输入：打字匹配名字或任意别名，选中后固定为正式 id。 */
function ArtistPicker({label,value,onChange,autoFocus}:{label:string;value:string;onChange:(id:string)=>void;autoFocus?:boolean}){
  const {data}=useDataset();
  const [text,setText]=useState(()=>data.nodes.find(node=>node.id===value)?.name||'');
  const [open,setOpen]=useState(false);
  const [cursor,setCursor]=useState(0);
  const needle=text.trim().toLowerCase();
  const matches=useMemo(()=>{
    if(!needle)return [];
    return data.nodes
      .filter(node=>node.name.toLowerCase().includes(needle)||(node.aliases||[]).some(alias=>alias.toLowerCase().includes(needle)))
      .slice(0,8);
  },[data.nodes,needle]);
  const choose=(id:string)=>{
    const node=data.nodes.find(item=>item.id===id);
    if(!node)return;
    setText(node.name);onChange(node.id);setOpen(false);setCursor(0);
  };
  return <label className="picker">{label}
    <input value={text} autoComplete="off" role="combobox" aria-expanded={open} aria-autocomplete="list"
      placeholder="输入名字或别名搜索" data-autofocus={autoFocus?'':undefined}
      onChange={event=>{setText(event.target.value);onChange('');setOpen(true);setCursor(0);}}
      onFocus={()=>setOpen(true)}
      onBlur={()=>{
        window.setTimeout(()=>{
          setOpen(false);
          if(value)return;
          // 手打了完整名字或别名但没点选：自动指定到正式名字。
          const typed=text.trim().toLowerCase();
          const exact=data.nodes.find(node=>
            node.name.toLowerCase()===typed||(node.aliases||[]).some(alias=>alias.toLowerCase()===typed));
          if(exact)choose(exact.id);
        },140);
      }}
      onKeyDown={event=>{
        if(event.key==='ArrowDown'&&matches.length){event.preventDefault();setOpen(true);setCursor(index=>(index+1)%matches.length);}
        else if(event.key==='ArrowUp'&&matches.length){event.preventDefault();setCursor(index=>(index-1+matches.length)%matches.length);}
        else if(event.key==='Enter'&&open&&matches[cursor]){event.preventDefault();choose(matches[cursor].id);}
        else if(event.key==='Escape'){setOpen(false);}
      }}/>
    {open&&needle&&<div className="picker-menu" role="listbox">
      {matches.length?matches.map((node,index)=><button type="button" key={node.id} role="option" aria-selected={index===cursor}
        className={index===cursor?'active':''} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(node.id)}>
        <b>{node.name}</b>
        <small>{node.aliases?.length?`别名 ${node.aliases.join('、')} · `:''}{provinceLabel(provinceOf(node.city))}</small>
      </button>):<p>没有找到。先在「添加人物」里提交他。</p>}
    </div>}
  </label>;
}

function LocalEditor({target,onClose}:{target:EditorTarget;onClose:()=>void}){
  const {data,online}=useDataset();const record=target.record;
  const [baseRevision]=useState(()=>record?data.revisions[record.id]:undefined);
  const artist=target.kind==='artist'?target.record:undefined,relation=target.kind==='relationship'?target.record:undefined;
  const seedSource=target.kind==='relationship'?target.source:undefined;
  const prefilled=!!seedSource&&!relation;
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState(''),[type,setType]=useState(relation?.type||'collaboration');
  const [source,setSource]=useState(relation?.source||seedSource||''),[target2,setTarget2]=useState(relation?.target||'');
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError('');const values=Object.fromEntries(new FormData(event.currentTarget));
    if(target.kind==='relationship'){
      if(!source||!target2){setError('请从搜索结果里选中起点和终点人物');setBusy(false);return;}
      if(source===target2){setError('起点和终点不能是同一个人');setBusy(false);return;}
      values.source=source;values.target=target2;
    }
    try{const result=await api('/submissions',{kind:target.kind,targetId:record?.id,baseRevision,payload:values,contributor:values.contributor,message:values.message,website:values.website});setReceipt(result.id);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <Modal title={`${record?'编辑':'添加'}${target.kind==='artist'?'人物信息':'人物关系'}`} onClose={onClose}>
    {receipt?<div className="submission-success"><span className="success-record">✓</span><h3>投稿已进入审核队列</h3><p>站长审核通过后，所有访客都能看到这条内容。</p><p className="receipt">投稿编号：{receipt}</p><button className="primary" onClick={onClose}>返回地图</button></div>:<form onSubmit={submit} className="editor-form">
      <p className="form-intro">{target.kind==='artist'?'填名字、省份和一句简介就够了，其余交给站长补。'
        :prefilled?<>起点已填好 <b>{data.nodes.find(node=>node.id===seedSource)?.name||'当前人物'}</b>，选另一个人、说清关系即可。</>
        :'选两个人、说清关系，作品和年份能把关系连得更准。'}</p>
      {!online&&<p role="alert" className="notice error">投稿服务未连接。请启动完整开发服务后重试，填写内容不会被清空。</p>}
      <div className="form-grid">
        {target.kind==='artist'?<>
          <label>名字 *<input name="name" maxLength={80} required defaultValue={artist?.name} placeholder="艺名或团体名"/></label>
          <label>类型<select name="kind" defaultValue={artist?.kind||'artist'}><option value="artist">说唱音乐人</option><option value="group">团体 / 组合</option></select></label>
          <label className="wide">别名<input name="aliases" maxLength={250} defaultValue={artist?.aliases?.join('、')} placeholder="多个别名用顿号隔开，方便别人搜到他"/></label>
          <label>省份<select name="city" defaultValue={artist&&provinceOf(artist.city)!==UNKNOWN_PROVINCE?provinceOf(artist.city):UNKNOWN_PROVINCE}>
            <option value={UNKNOWN_PROVINCE}>暂不确定（待考据）</option>
            {PROVINCE_NAMES.map(name=><option key={name} value={name}>{name}</option>)}
          </select><small>只按 34 个省级行政区归档，不填城市。</small></label>
          <label className="wide">简介 *<textarea name="description" required maxLength={2000} rows={3} defaultValue={artist?.description} placeholder="一句话说清他是谁、在哪做音乐"/></label>
        </>:<>
          <ArtistPicker label="起点人物 *" value={source} onChange={setSource}/>
          <ArtistPicker label="终点人物 *" value={target2} onChange={setTarget2} autoFocus={prefilled}/>
          <label>关系类型<select name="type" value={type} onChange={e=>setType(e.target.value as typeof type)}>{Object.entries(relationNames).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>
          <label>{type==='collaboration'||type==='production'?'作品版本年份':'资料年份'} *<input name="year" type="number" min={1900} max={new Date().getFullYear()} required defaultValue={relation?.track?.year||relation?.observedYear||''}/></label>
          <label className="wide">关系说明 *<input name="label" maxLength={200} required defaultValue={relation?.label} placeholder="例如：《作品名》录音室合作 / 2022 年资料中的组合成员"/></label>
          {(type==='collaboration'||type==='production')&&<><label>具体作品名称 *<input name="trackTitle" required maxLength={180} defaultValue={relation?.track?.title}/></label><label>作品版本<select name="version" defaultValue={relation?.track?.version||'发行版'}>{['发行版','录音室版','现场版','混音版'].map(v=><option key={v}>{v}</option>)}</select></label></>}
        </>}
        <label>投稿昵称<input name="contributor" maxLength={60} placeholder="匿名乐迷"/></label>
        <div className="honey" aria-hidden="true"><label>网站<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
      </div>
      {error&&<p role="alert" className="notice error">{error}</p>}
      <footer className="form-actions"><span>提交后等待站长审核</span><button type="submit" className="primary" disabled={busy||!online}>{busy?'正在提交…':'提交审核 →'}</button></footer>
    </form>}
  </Modal>;
}

type ReviewItem={id:string;kind:string;target_id:string|null;payload:any;original:any;contributor:string;message:string;status:string;created_at:string;review_note:string};
const labels:Record<string,string>={name:'名字',aliases:'别名',city:'省份',description:'简介',kind:'类型',source:'起点',target:'终点',type:'关系类型',label:'关系说明',observedYear:'资料年份',track:'作品',sources:'来源',evidence:'证据'};
export function ReviewPanel({onClose}:{onClose:()=>void}){
  const {data,refresh}=useDataset(),[owner,setOwner]=useState(false),[checking,setChecking]=useState(true),[items,setItems]=useState<ReviewItem[]>([]),[filter,setFilter]=useState('pending'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState<string|null>(null),[note,setNote]=useState(''),[audit,setAudit]=useState<any[]>([]);
  const load=async()=>{const result=await api('/review');setItems(result.items);setAudit(result.audit);};
  useEffect(()=>{let active=true;api('/session').then(async result=>{if(!active)return;setOwner(result.owner);if(result.owner)await load();}).catch(e=>active&&setError(e.message)).finally(()=>active&&setChecking(false));return()=>{active=false;};},[]);
  async function login(event:FormEvent<HTMLFormElement>){event.preventDefault();setBusy(true);setError('');const password=new FormData(event.currentTarget).get('password');try{const result=await api('/login',{password});ownerToken.set(result.token);setOwner(true);await load();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function decide(id:string,action:string){setBusy(true);setError('');try{await api(`/review/${id}`,{action,note});setActive(null);setNote('');await load();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const selected=items.find(i=>i.id===active);
  const display=(key:string,value:any)=>{if(value===undefined||value==='')return '—';if(key==='source'||key==='target')return data.nodes.find(n=>n.id===value)?.name||value;if(key==='type')return relationNames[value]||value;if(key==='kind')return value==='artist'?'说唱音乐人':'团体 / 组合';if(key==='city')return value==='未定'?'待考据':value;if(key==='aliases')return value.length?value.join('、'):'无';if(key==='track')return `${value.title} · ${value.year} · ${value.version}`;if(typeof value==='object')return JSON.stringify(value,null,2);return String(value);};
  return <Modal title="站长审核台" onClose={onClose}>
    {checking?<p className="empty">正在确认登录状态…</p>:!owner?<form className="login-form" onSubmit={login}><div className="record-icon">◆</div><h3>只有你能决定哪些内容公开</h3><p>输入站长审核密钥。普通访客可以投稿，无法访问审核队列。</p><label>审核密钥<input name="password" type="password" required autoComplete="current-password"/></label><p className="field-help">密钥由站长保管，只用于审核队列；普通访客可以投稿，无需登录。</p><button className="primary" disabled={busy}>{busy?'登录中…':'进入审核台 →'}</button></form>:<div className="review-body">
      <div className="review-toolbar"><div className="segmented">{[['pending','待审核'],['approved','已通过'],['rejected','已退回']].map(([key,label])=><button key={key} className={filter===key?'active':''} onClick={()=>{setFilter(key);setActive(null);setNote('');}}>{label} {items.filter(i=>i.status===key).length}</button>)}</div><button disabled={busy} onClick={async()=>{try{await api('/logout',{});}catch{/* 服务端已失效也要能退出 */}ownerToken.clear();setOwner(false);setItems([]);}}>退出登录</button></div>
      <div className="review-grid"><div className="review-list">{items.filter(i=>i.status===filter).length===0&&<p className="empty">这里暂时没有投稿。</p>}{items.filter(i=>i.status===filter).map(item=><button className={`review-item ${item.id===active?'selected':''}`} key={item.id} onClick={()=>{setActive(item.id);setNote('');setError('');}}><span>{item.target_id?'修改':'新增'} · {item.kind==='artist'?'人物':'关系'}</span><strong>{item.payload.name||item.payload.label}</strong><small>{item.contributor} · {new Date(item.created_at).toLocaleDateString('zh-CN')}</small></button>)}</div>
      <div className="review-detail">{selected?<><h3>{selected.payload.name||selected.payload.label}</h3><p>{selected.message||'投稿者没有额外备注'}</p><p className="field-help">请打开来源核对人物身份、城市和具体关系后再批准。</p>
        {Object.keys(labels).filter(key=>selected.payload[key]!==undefined&&!(Array.isArray(selected.payload[key])&&!selected.payload[key].length)).map(key=><div className="review-field" key={key}><b>{labels[key]}</b>{selected.original&&JSON.stringify(selected.original[key])!==JSON.stringify(selected.payload[key])&&<div className="before-value"><small>当前</small><pre>{display(key,selected.original[key])}</pre></div>}{['sources','evidence'].includes(key)?selected.payload[key].map((source:any,i:number)=><div key={i}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a><p>{source.note}</p></div>):<pre>{display(key,selected.payload[key])}</pre>}</div>)}
        {selected.status==='pending'?<><label>审核意见<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={1500} rows={2} placeholder="退回时必填；可写明需要补充的证据"/></label><div className="review-actions"><button disabled={busy||!note.trim()} onClick={()=>decide(selected.id,'reject')}>退回修改</button><button className="primary" disabled={busy} onClick={()=>decide(selected.id,'approve')}>{busy?'正在处理…':'批准并公开'}</button></div></>:<p className="notice">审核意见：{selected.review_note||'已核对'}</p>}
      </>:<p className="empty">选择一条投稿，查看完整内容和修改对比。</p>}</div></div>
      <details className="audit-log"><summary>最近审核记录（{audit.length}）</summary>{audit.map(entry=><p key={entry.id}>{new Date(entry.created_at).toLocaleString('zh-CN')} · {entry.action==='approve'?'批准':'退回'} · {entry.submission_id.slice(0,8)} {entry.note}</p>)}</details>
    </div>}
    {error&&<p role="alert" className="notice error">{error}</p>}
  </Modal>;
}
