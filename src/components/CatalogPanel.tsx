import {useState} from 'react';
import {Search, Music2, ArrowRight, ExternalLink} from 'lucide-react';
import {nodes, works, nodeById, type Work} from '../data/rap-data';
import {artistMatches, workMatches, worksByArtist, relationCounts} from '../lib/catalog';

export function WorkCard({work, onPick, compact=false}:{work:Work;onPick:(id:string)=>void;compact?:boolean}) {
  return <article className={`work-card ${compact?'compact':''}`}>
    <div className="work-card-top"><span className="work-icon"><Music2 size={19}/></span><div><h3 title={work.title}>{work.title}</h3><p>{work.year} · {work.version}</p></div></div>
    {work.album && <p className="work-album">{work.album}</p>}
    <div className="work-artists">{work.artistIds.map(id=><button key={id} onClick={()=>onPick(id)}>{nodeById.get(id)!.name}</button>)}</div>
    <details className="work-source"><summary>署名与来源</summary><p>平台署名：{work.creditedAs}</p>{work.evidence.map((e,i)=><div key={i}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title}<ExternalLink size={12}/></a><p>{e.note}</p></div>)}</details>
  </article>;
}

export function CatalogPanel({mode,query,onQuery,onPick,city}:{mode:'artists'|'works';query:string;onQuery:(query:string)=>void;onPick:(id:string)=>void;city:string}) {
  const [version,setVersion]=useState('全部版本');
  const [collabsOnly,setCollabsOnly]=useState(false);
  const [sort,setSort]=useState('相关顺序');
  const [page,setPage]=useState(1);
  const pageSize=24;
  const artists=nodes.filter(node=>(city==='全部城市'||node.city===city)&&artistMatches(node,query));
  const cityIds=new Set(nodes.filter(node=>city==='全部城市'||node.city===city).map(node=>node.id));
  const matchingWorks=works.filter(work=>workMatches(work,query)&&work.artistIds.some(id=>cityIds.has(id))&&(version==='全部版本'||work.version===version)&&(!collabsOnly||work.artistIds.length>1));
  if(sort==='最新在前') matchingWorks.sort((a,b)=>b.year-a.year||a.title.localeCompare(b.title,'zh-CN'));
  else if(sort==='最早在前') matchingWorks.sort((a,b)=>a.year-b.year||a.title.localeCompare(b.title,'zh-CN'));
  const total=mode==='artists'?artists.length:matchingWorks.length;
  const pageCount=Math.max(1,Math.ceil(total/pageSize));
  const currentPage=Math.min(page,pageCount);
  const offset=(currentPage-1)*pageSize;
  return <section className="catalog-panel" aria-label={mode==='artists'?'Rapper 名录':'作品库'}>
    <div className="catalog-controls">
      <label className="catalog-search"><Search size={16}/><input aria-label="搜索目录" placeholder={mode==='artists'?'搜索艺名或别名':'搜索作品、专辑或艺人'} value={query} onChange={e=>{onQuery(e.target.value);setPage(1)}}/></label>
      {mode==='works'&&<><select aria-label="作品版本" value={version} onChange={e=>{setVersion(e.target.value);setPage(1)}}>{['全部版本','发行版','现场版','混音版','录音室版'].map(value=><option key={value}>{value}</option>)}</select><select aria-label="作品排序" value={sort} onChange={e=>{setSort(e.target.value);setPage(1)}}>{['相关顺序','最新在前','最早在前'].map(value=><option key={value}>{value}</option>)}</select><label className="catalog-check"><input type="checkbox" checked={collabsOnly} onChange={e=>{setCollabsOnly(e.target.checked);setPage(1)}}/>仅图内合作</label></>}
    </div>
    <div className="catalog-summary"><span>找到 <strong>{total}</strong> {mode==='artists'?'位艺人 / 团体':'个作品版本'} · {city}</span><span>{mode==='artists'?'点击卡片定位图谱':'同名作品按发行版本分别收录'}</span></div>
    {total===0?<div className="catalog-empty"><Music2 size={32}/><h3>没有匹配的{mode==='artists'?'艺人':'作品'}</h3><p>试试艺人别名，或清除筛选条件。</p><button onClick={()=>{onQuery('');setVersion('全部版本');setCollabsOnly(false);setPage(1)}}>清除目录筛选</button></div>:
    mode==='artists'?<div className="artist-grid">{artists.slice(offset,offset+pageSize).map(node=><button key={node.id} className="artist-card" onClick={()=>onPick(node.id)}><span className="avatar" style={{background:node.color}}>{node.initials}</span><span className="artist-card-name"><strong>{node.name}</strong><small>{node.city==='未标注'?'地域待补充':node.city} · {node.kind==='group'?'团体':'Rapper'}</small><span>{worksByArtist.get(node.id)?.length||0} 首作品 · {relationCounts.get(node.id)||0} 条关系</span></span><ArrowRight size={14}/></button>)}</div>:
    <div className="works-grid">{matchingWorks.slice(offset,offset+pageSize).map(work=><WorkCard key={work.id} work={work} onPick={onPick}/>)}</div>}
    {total>pageSize&&<nav className="catalog-pagination" aria-label="目录分页"><button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button><span>第 {currentPage} / {pageCount} 页</span><button disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}
  </section>;
}
