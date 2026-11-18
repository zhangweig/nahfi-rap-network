import {lazy, Suspense, useMemo, useState} from 'react';
import {Search, Music2} from 'lucide-react';
import {artistMatches} from '../lib/catalog';
import {useDataset} from '../state/Dataset';
import {ALL_PROVINCES,provinceLabel,provinceOf} from '../lib/province';
import type {HoloCardData} from './HoloCards';
import {RapperDetail} from './RapperDetail';
import {allBeefs, loadLocalBeefs, beefNodeIds} from '../data/beefs';

// three.js 只在进入人物页时才下载，地图页首屏不受影响
const HoloCardStage = lazy(() => import('./HoloCards').then(m => ({default: m.HoloCardStage})));

/** Rapper 名录：以 3D 球星卡阵列展示，点击弹出大卡打分，大卡里可回到地图定位。 */
export function CatalogPanel({query,onQuery,onPick,province}:{query:string;onQuery:(query:string)=>void;onPick:(id:string)=>void;province:string}) {
  const {data:{nodes,works,relations,beefs,ratings},refresh}=useDataset();
  const worksByArtist=new Map(nodes.map(n=>[n.id,works.filter(w=>w.artistIds.includes(n.id))]));
  const relationCounts=new Map(nodes.map(n=>[n.id,relations.filter(r=>r.source===n.id||r.target===n.id).length]));
  const beefIds=beefNodeIds(allBeefs(beefs,loadLocalBeefs()));
  const [page,setPage]=useState(1);
  const [detailId,setDetailId]=useState<string|null>(null);
  const pageSize=24;
  const inScope=(node:{city:string})=>province===ALL_PROVINCES||provinceOf(node.city)===province;
  const artists=nodes.filter(node=>inScope(node)&&artistMatches(node,query));
  const total=artists.length;
  const pageCount=Math.max(1,Math.ceil(total/pageSize));
  const currentPage=Math.min(page,pageCount);
  const offset=(currentPage-1)*pageSize;
  // 当前页卡片数据：useMemo 让 HoloCardStage 的 WebGL 场景只在换页/筛选时重建
  const cards:HoloCardData[]=useMemo(()=>artists.slice(offset,offset+pageSize).map((node,index)=>({
    node,index:offset+index,
    workCount:worksByArtist.get(node.id)?.length||0,
    relationCount:relationCounts.get(node.id)||0,
    inBeef:beefIds.has(node.id),
  })),[artists,offset,worksByArtist,relationCounts,beefIds]);

  const detail = detailId ? nodes.find(n => n.id === detailId) : null;

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
