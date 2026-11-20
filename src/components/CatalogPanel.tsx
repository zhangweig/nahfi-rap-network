import {lazy, Suspense, useEffect, useMemo, useState} from 'react';
import {Search, Music2} from 'lucide-react';
import {artistMatches} from '../lib/catalog';
import {heatWeight} from '../lib/heat';
import {useDatasetData, useDatasetStatus} from '../state/Dataset';
import {ALL_PROVINCES,provinceLabel,provinceOf} from '../lib/province';
import type {HoloCardData} from './HoloCards';
import {RapperDetail} from './RapperDetail';
import {allBeefs, loadLocalBeefs, beefNodeIds} from '../data/beefs';

// three.js 只在进入人物页时才下载，地图页首屏不受影响
const HoloCardStage = lazy(() => import('./HoloCards').then(m => ({default: m.HoloCardStage})));

/** Rapper 名录：以 3D 球星卡阵列展示，点击弹出大卡打分，大卡里可回到地图定位。 */
export function CatalogPanel({query,onQuery,onPick,province}:{query:string;onQuery:(query:string)=>void;onPick:(id:string)=>void;province:string}) {
  const {nodes,works,relations,beefs,ratings}=useDatasetData();
  const {refresh}=useDatasetStatus();
  // 单次遍历建索引，替代原先「每个 node 各 filter 一遍 works / relations」的 O(n²)。
  const {worksByArtist,relationCounts}=useMemo(()=>{
    const w=new Map<string,typeof works>();
    const r=new Map<string,number>();
    for(const work of works)for(const id of work.artistIds){const list=w.get(id);if(list)list.push(work);else w.set(id,[work]);}
    for(const rel of relations){
      r.set(rel.source,(r.get(rel.source)||0)+1);
      r.set(rel.target,(r.get(rel.target)||0)+1);
    }
    return {worksByArtist:w,relationCounts:r};
  },[works,relations]);
  const beefIds=useMemo(()=>beefNodeIds(allBeefs(beefs,loadLocalBeefs())),[beefs]);
  const nodeById=useMemo(()=>new Map(nodes.map(n=>[n.id,n])),[nodes]);
  // 档案号 = 该人物在全局 nodes 里的固定位置 + 1，不随筛选/排序/分页变化。
  // 与今日卡片页的 NO. 口径一致，也和卡面印的编号一致。
  const serialById=useMemo(()=>new Map(nodes.map((n,i)=>[n.id,i+1])),[nodes]);
  const [page,setPage]=useState(1);
  const [detailId,setDetailId]=useState<string|null>(null);
  // 窄屏每页少放几张：WebGL 画布高度随网格行数增长，单列 24 张会让画布高达
  // 上万像素，相机被推到极远导致卡片全被裁掉（首屏全黑）。小页配合两列网格，
  // 把画布高度压回可视范围。
  const [pageSize,setPageSize]=useState(()=>typeof window!=='undefined'&&window.innerWidth<=600?12:24);
  useEffect(()=>{
    const onResize=()=>setPageSize(window.innerWidth<=600?12:24);
    window.addEventListener('resize',onResize);
    return ()=>window.removeEventListener('resize',onResize);
  },[]);
  // 展示顺序按热度从高到低；热度相同用档案号兜底，保证排序稳定不抖动。
  // 卡面编号（serial）另算，与这里的展示顺序互不干扰。
  const artists=useMemo(()=>{
    const filtered=nodes.filter(node=>(province===ALL_PROVINCES||provinceOf(node.city)===province)&&artistMatches(node,query));
    return filtered.sort((a,b)=>{
      const ha=heatWeight(relationCounts.get(a.id)||0,worksByArtist.get(a.id)?.length||0,ratings[a.id]);
      const hb=heatWeight(relationCounts.get(b.id)||0,worksByArtist.get(b.id)?.length||0,ratings[b.id]);
      return hb-ha || (serialById.get(a.id)||0)-(serialById.get(b.id)||0);
    });
  },[nodes,province,query,relationCounts,worksByArtist,ratings,serialById]);
  const total=artists.length;
  const pageCount=Math.max(1,Math.ceil(total/pageSize));
  const currentPage=Math.min(page,pageCount);
  const offset=(currentPage-1)*pageSize;
  // 当前页卡片数据：useMemo 让 HoloCardStage 的 WebGL 场景只在换页/筛选时重建。
  // serial 取全局档案号，不是这里 slice 之后的展示序号。
  const cards:HoloCardData[]=useMemo(()=>artists.slice(offset,offset+pageSize).map(node=>({
    node,serial:serialById.get(node.id)||0,
    workCount:worksByArtist.get(node.id)?.length||0,
    relationCount:relationCounts.get(node.id)||0,
    inBeef:beefIds.has(node.id),
  })),[artists,offset,serialById,worksByArtist,relationCounts,beefIds]);

  const detail = detailId ? nodeById.get(detailId) || null : null;

  return <section className="catalog-panel" aria-label="Rapper 名录">
    <div className="catalog-controls">
      <label className="catalog-search"><Search size={16}/><input aria-label="搜索目录" placeholder="搜索艺名或别名" value={query} onChange={e=>{onQuery(e.target.value);setPage(1)}}/></label>
    </div>
    <div className="catalog-summary"><span>找到 <strong>{total}</strong> 位艺人 / 团体 · {province===ALL_PROVINCES?'全部省份':provinceLabel(province)}</span><span>点击球星卡查看档案并打分</span></div>
    {total===0
      ? <div className="catalog-empty"><Music2 size={32}/><h3>没有匹配的艺人</h3><p>试试艺人别名，或清除筛选条件。</p><button onClick={()=>{onQuery('');setPage(1)}}>清除目录筛选</button></div>
      : <Suspense fallback={<div className="catalog-loading">正在装载 3D 卡阵…</div>}><HoloCardStage cards={cards} onPick={setDetailId} /></Suspense>}
    {total>pageSize&&<nav className="catalog-pagination" aria-label="目录分页">
      <button disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>上一页</button>
      <span>第 {currentPage} / {pageCount} 页</span>
      <button disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>下一页</button>
    </nav>}
    {detail && <RapperDetail node={detail} stat={ratings[detail.id]}
      workCount={worksByArtist.get(detail.id)?.length||0}
      relationCount={relationCounts.get(detail.id)||0}
      inBeef={beefIds.has(detail.id)}
      onClose={() => setDetailId(null)}
      onLocate={() => onPick(detail.id)}
      onRated={() => void refresh()} />}
  </section>;
}
