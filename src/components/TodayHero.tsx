import {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {useDatasetData, useDatasetStatus} from '../state/Dataset';
import {avatarPath} from './PixelAvatar';
import {HeroCard} from './HeroCard';
import {RapperDetail} from './RapperDetail';
import {allBeefs, loadLocalBeefs, beefNodeIds} from '../data/beefs';
import {cardTier, tierFoil} from '../lib/card-tier';
import {provinceLabel, provinceOf} from '../lib/province';

/** Shuffle once per visit; keep candidate order stable throughout that visit. */
export function TodayHero({onLocate}:{onLocate:(id:string)=>void}) {
  const {nodes, relations, works, beefs, ratings} = useDatasetData();
  const {refresh} = useDatasetStatus();
  const [shuffleSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const deck = useMemo(() => {
    const portraits = nodes.filter(node => !!avatarPath(node));
    const shuffled = [...(portraits.length ? portraits : nodes)];
    let seed = shuffleSeed;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [nodes, shuffleSeed]);
  const [heroId, setHeroId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{x:number;y:number} | null>(null);
  const swiped = useRef(false);
  const index = Math.max(0, deck.findIndex(node => node.id === heroId));
  const hero = deck[index];
  const tier = cardTier(hero ? ratings[hero.id] : undefined);
  const foilStyle = tierFoil(tier);
  const {workCounts, relationCounts, serials} = useMemo(() => {
    const workCounts = new Map<string, number>();
    const relationCounts = new Map<string, number>();
    for (const work of works) for (const id of work.artistIds) workCounts.set(id, (workCounts.get(id) || 0) + 1);
    for (const relation of relations) for (const id of [relation.source, relation.target]) relationCounts.set(id, (relationCounts.get(id) || 0) + 1);
    return {workCounts, relationCounts, serials:new Map(nodes.map((node, i) => [node.id, i]))};
  }, [nodes, works, relations]);
  const beefSet = useMemo(() => beefNodeIds(allBeefs(beefs, loadLocalBeefs())), [beefs]);
  const at = (offset:number) => deck[((index + offset) % deck.length + deck.length) % deck.length];
  // Small datasets retain a centred main card without duplicated React keys.
  const count = Math.min(15, deck.length);
  const slots = Array.from({length:count}, (_, i) => i - Math.floor((count - 1) / 2));
  const step = (direction:number) => {
    if(deck.length < 2)return;
    setHeroId(current => {
      const from=Math.max(0,deck.findIndex(node=>node.id===current));
      return deck[((from+direction)%deck.length+deck.length)%deck.length].id;
    });
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const wheelEnabled = useRef(deck.length > 1);
  wheelEnabled.current = deck.length > 1;
  useEffect(() => {
    const stage=stageRef.current;
    if(!stage)return;
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame=0, timer=0, last=0, position=0, velocity=0, target=0, accumulated=0, lastCommit=0;
    const tick=(now:number)=>{
      frame=0;
      const dt=Math.min((now-last)/1000 || .016,.032); last=now;
      velocity+=((target-position)*180-velocity*25)*dt;
      position+=velocity*dt;
      if(Math.abs(target-position)<.1 && Math.abs(velocity)<.4){position=target;velocity=0;}
      stage.style.setProperty('--dragX',`${position}px`);
      if(position!==target || velocity!==0)frame=requestAnimationFrame(tick);
    };
    const animate=()=>{if(reduced.matches){stage.style.setProperty('--dragX','0px');return;}if(!frame){last=performance.now();frame=requestAnimationFrame(tick);}};
    const wheel=(event:WheelEvent)=>{
      if(event.ctrlKey || !wheelEnabled.current)return;
      event.preventDefault();
      const raw=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;
      const delta=raw*(event.deltaMode===1 ? 16 : event.deltaMode===2 ? stage.clientHeight : 1);
      accumulated=Math.max(-500,Math.min(500,accumulated+delta));
      target=-Math.tanh(accumulated/160)*Math.min(90,stage.clientWidth*.12);
      if(Math.abs(accumulated)>=180 && performance.now()-lastCommit>220){
        stepRef.current(accumulated>0 ? 1 : -1); accumulated=0; target=0; lastCommit=performance.now();
      }
      animate();window.clearTimeout(timer);
      timer=window.setTimeout(()=>{
        if(Math.abs(accumulated)>=35 && performance.now()-lastCommit>180)stepRef.current(accumulated>0 ? 1 : -1);
        accumulated=0;target=0;animate();
      },130);
    };
    stage.addEventListener('wheel',wheel,{passive:false});
    return ()=>{stage.removeEventListener('wheel',wheel);cancelAnimationFrame(frame);window.clearTimeout(timer);};
  }, []);
  const resetPointer = () => {
    stageRef.current?.style.setProperty('--fx', '0');
    stageRef.current?.style.setProperty('--fy', '0');
  };
  return <section className="today-hero immersive-hero" data-foil={foilStyle} aria-label="人物卡牌展厅">
    <div className="hero-atmosphere" aria-hidden="true">
      <svg className="hero-contours" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs><path id="contour-left" d="M-80 340 C 30 300 50 220 170 225 S 270 135 405 145 S 480 100 540 76" />
          <path id="contour-bottom" d="M-100 730 C 20 710 50 640 122 645 S 214 748 306 714 S 411 715 500 798" /></defs>
        <g className="contour-group"><use href="#contour-left"/><use href="#contour-left" transform="translate(0 9)"/><use href="#contour-left" transform="translate(0 18)"/><use href="#contour-left" transform="translate(0 27)"/><use href="#contour-left" transform="translate(0 36)"/>
          <use href="#contour-left" transform="translate(1440 20) scale(-1 1)"/><use href="#contour-left" transform="translate(1440 32) scale(-1 1)"/><use href="#contour-left" transform="translate(1440 44) scale(-1 1)"/>
          <use href="#contour-bottom"/><use href="#contour-bottom" transform="translate(0 10)"/><use href="#contour-bottom" transform="translate(0 20)"/><use href="#contour-bottom" transform="translate(0 30)"/><use href="#contour-bottom" transform="translate(1440 45) scale(-1 1)"/></g>
      </svg>
    </div>
    <div className="hero-heading" aria-hidden="true" />
    <div className="thv-stage" ref={stageRef} tabIndex={0}
      aria-label="人物卡组，左右方向键切换，点击中央卡查看档案"
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      onPointerMove={event => {
        if (event.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.style.setProperty('--fx', String((event.clientX - rect.left) / rect.width * 2 - 1));
        event.currentTarget.style.setProperty('--fy', String((event.clientY - rect.top) / rect.height * 2 - 1));
      }}
      onPointerLeave={resetPointer}
      onPointerDown={event => {
        swiped.current = false;
        if (event.pointerType !== 'mouse') gesture.current = {x:event.clientX, y:event.clientY};
      }}
      onPointerUp={event => {
        const start = gesture.current;
        gesture.current = null;
        if (!start) return;
        const dx = event.clientX - start.x;
        if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(event.clientY - start.y)) {
          swiped.current = true; step(dx < 0 ? 1 : -1);
        }
      }}
      onPointerCancel={() => { gesture.current = null; }}
      onClickCapture={event => { if (swiped.current) { event.stopPropagation(); swiped.current = false; } }}>
      <div className="thv-fan">
        {slots.map(slot => { const node = at(slot); return <HeroCard key={node.id} node={node}
          index={serials.get(node.id) || 0} total={nodes.length} slot={slot}
          stats={{workCount:workCounts.get(node.id) || 0, relationCount:relationCounts.get(node.id) || 0,
            average:ratings[node.id]?.average, count:ratings[node.id]?.count}}
          inBeef={beefSet.has(node.id)} isFront={slot === 0} tier={cardTier(ratings[node.id])}
          onOpen={() => setDetailOpen(true)} onPromote={() => setHeroId(node.id)} />; })}
      </div>
      <div className="thv-floor" aria-hidden="true" /><div className="thv-plinth" aria-hidden="true" />
    </div>
    {hero ? <div className="hero-navigation">
      <button aria-label={`上一张：${at(-1).name}`} disabled={deck.length < 2} onClick={() => step(-1)}><ChevronLeft size={22}/><span>{at(-1).name}</span></button>
      <div className="hero-caption" aria-live="polite"><b>{hero.name}</b><span>{provinceLabel(provinceOf(hero.city))} · {index + 1} / {deck.length}</span><button onClick={() => setDetailOpen(true)}>展开人物档案</button></div>
      <button aria-label={`下一张：${at(1).name}`} disabled={deck.length < 2} onClick={() => step(1)}><span>{at(1).name}</span><ChevronRight size={22}/></button>
    </div> : <p className="hero-caption">暂无人物档案</p>}
    <p className="tier-hero-label">{tier} · {hero ? ratings[hero.id]?.count || 0 : 0} 人评分</p>
    {detailOpen && hero && <RapperDetail node={hero} stat={ratings[hero.id]}
      workCount={workCounts.get(hero.id) || 0} relationCount={relationCounts.get(hero.id) || 0}
      inBeef={beefSet.has(hero.id)} onClose={() => setDetailOpen(false)}
      onLocate={() => { setDetailOpen(false); onLocate(hero.id); }} onRated={() => void refresh()} />}
  </section>;
}
