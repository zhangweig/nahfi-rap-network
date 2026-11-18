import {useRef} from 'react';
import type {ArtistNode} from '../data/types';
import {avatarPath} from './PixelAvatar';
import {provinceLabel,provinceOf} from '../lib/province';

/**
 * Rapper 球星卡。
 * 全息/倾斜效果移植自 simeydotme/pokemon-cards-css (MIT) 的思路：
 * pointermove 直接把坐标写进卡片 DOM 的 CSS 变量，不触发 React 重渲染，
 * 用 rAF 合帧；默认静态，仅 hover/focus 时激活，移动端与 4K 高 DPR 自动关闭，
 * 避免重演画布卡顿。所有数字都是真实统计，没有编造字段。
 */
export function RapperCard({node,index,workCount,relationCount,inBeef,onPick}:{
  node:ArtistNode; index:number; workCount:number; relationCount:number; inBeef?:boolean; onPick:(id:string)=>void;
}) {
  const ref=useRef<HTMLButtonElement>(null);
  const frame=useRef<number|null>(null);
  const last=useRef<{x:number;y:number}>({x:0,y:0});

  const apply=()=>{
    frame.current=null;
    const el=ref.current; if(!el) return;
    const {x,y}=last.current;
    el.style.setProperty('--px',`${x}%`);
    el.style.setProperty('--py',`${y}%`);
    el.style.setProperty('--rx',`${(0.5-y/100)*10}deg`);
    el.style.setProperty('--ry',`${(x/100-0.5)*10}deg`);
    // 图像与字符纹理以不同幅度反向视差，形成层次；文字层始终不动。
    el.style.setProperty('--ax',`${(x/100-0.5)*-16}px`);
    el.style.setProperty('--ay',`${(y/100-0.5)*-12}px`);
    el.style.setProperty('--tx',`${(x/100-0.5)*20}px`);
    el.style.setProperty('--ty',`${(y/100-0.5)*14}px`);
  };

  const onMove=(e:React.PointerEvent)=>{
    if(e.pointerType!=='mouse') return;
    const el=ref.current; if(!el) return;
    const r=el.getBoundingClientRect();
    last.current={x:(e.clientX-r.left)/r.width*100, y:(e.clientY-r.top)/r.height*100};
    if(frame.current===null) frame.current=requestAnimationFrame(apply);
  };

  const onLeave=()=>{
    if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}
    const el=ref.current; if(!el) return;
    el.style.setProperty('--px','50%');
    el.style.setProperty('--py','50%');
    el.style.setProperty('--rx','0deg');
    el.style.setProperty('--ry','0deg');
    el.style.setProperty('--ax','0px');
    el.style.setProperty('--ay','0px');
    el.style.setProperty('--tx','0px');
    el.style.setProperty('--ty','0px');
  };

  const path=avatarPath(node);
  const province=provinceLabel(provinceOf(node.city));
  const serial=String(index+1).padStart(3,'0');

  return <button ref={ref} className="rapper-card" onPointerMove={onMove} onPointerLeave={onLeave}
    onClick={()=>onPick(node.id)} aria-label={`${node.name}，${province}，查看档案`}>
    <span className="rc-foil" aria-hidden="true" />
    <span className="rc-glare" aria-hidden="true" />
    {inBeef && <span className="rc-beef-flag" title="卷入 BEEF 冲突">⚡ BEEF</span>}
    <span className="rc-inner">
      <span className="rc-top">
        <span className="rc-no">NO.{serial}</span>
        <span className="rc-kind">{node.kind==='group'?'CREW':'RAPPER'}</span>
      </span>
      <span className="rc-art">
        {path ? <img src={path} alt="" draggable={false} loading="lazy" /> : <span className="rc-art-ph">{node.name.slice(0,1)}</span>}
        <span className="rc-art-ascii" aria-hidden="true" />
        <span className="rc-art-reticle" aria-hidden="true" />
        <span className="rc-art-shade" aria-hidden="true" />
      </span>
      <span className="rc-info">
        <span className="rc-name" title={node.name}>{node.name}</span>
        <span className="rc-prov">{province}</span>
      </span>
      <span className="rc-stats">
        <span><b>{workCount}</b><small>作品</small></span>
        <span><b>{relationCount}</b><small>关系</small></span>
        <span><b>{node.kind==='group'?'CREW':'MC'}</b><small>类型</small></span>
      </span>
      <span className="rc-foot"><span>FLOWLINE ARCHIVE</span><span>{serial}</span></span>
    </span>
  </button>;
}
