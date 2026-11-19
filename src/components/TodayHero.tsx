import {useMemo, useRef, useState} from 'react';
import {ArrowRight, FileSearch, RefreshCw, Zap} from 'lucide-react';
import {useDatasetData, useDatasetStatus} from '../state/Dataset';
import {Avatar, avatarPath} from './PixelAvatar';
import {HeroCard} from './HeroCard';
import {RapperDetail} from './RapperDetail';
import {BeefCard} from './BeefCard';
import {allBeefs, loadLocalBeefs, beefNodeIds, type BeefEvent} from '../data/beefs';
import {provinceLabel, provinceOf} from '../lib/province';
import type {ArtistNode} from '../data/types';

/** 卡阵张数：正中一张 + 两侧各两张。奇数才有「正中」。 */
const FAN = 5;

/**
 * 今日首屏：左侧今日翻牌与说明，正中五张卡摊开，右侧 BEEF 线索。
 *
 * 卡是实体感的：指针移过整个舞台时，五张卡按各自的前后层级倾斜，
 * 越靠前倾角越大，形成真实的视差，而不是整块一起晃。
 * 卡片本身不监听鼠标——舞台算一次指针位置，写进 CSS 变量，五张卡共享。
 */
export function TodayHero({onLocate}:{onLocate:(id:string)=>void}) {
  const {nodes, relations, works, beefs, ratings} = useDatasetData();
  const {refresh} = useDatasetStatus();

  // 只有真实头像的人物才适合当主角；占位人像留给两侧，避免首页第一眼就是剪影。
  const withPortrait = useMemo(() => nodes.filter(n => !!avatarPath(n)), [nodes]);
  const [heroId, setHeroId] = useState(() => withPortrait[0]?.id || nodes[0]?.id || 'air');
  const [detailOpen, setDetailOpen] = useState(false);
  const [openBeef, setOpenBeef] = useState<BeefEvent | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  // 一次遍历建好索引，避免每张卡各自 filter 一遍全量作品与关系。
  const {workCounts, relationCounts} = useMemo(() => {
    const w = new Map<string, number>();
    for (const work of works) for (const id of work.artistIds) w.set(id, (w.get(id) || 0) + 1);
    const r = new Map<string, number>();
    for (const rel of relations) {
      r.set(rel.source, (r.get(rel.source) || 0) + 1);
      r.set(rel.target, (r.get(rel.target) || 0) + 1);
    }
    return {workCounts: w, relationCounts: r};
  }, [works, relations]);

  const beefList = useMemo(() => allBeefs(beefs, loadLocalBeefs()), [beefs]);
  const beefSet = useMemo(() => beefNodeIds(beefList), [beefList]);

  // 卡阵：主角固定在正中，再按 ±1、±2 向两侧取人，凑成 5 张。
  // 位置数组按「左 → 右」排好，中心索引由 FAN 推出来，不依赖取人的顺序。
  const fan = useMemo(() => {
    if (!nodes.length) return [] as ArtistNode[];
    const pool = withPortrait.length >= 2 ? withPortrait : nodes;
    const anchor = Math.max(0, pool.findIndex(n => n.id === heroId));
    const mid = Math.floor(FAN / 2);
    const slots: (ArtistNode | undefined)[] = Array.from({length: FAN});
    slots[mid] = pool[anchor];
    for (let k = 1; k <= mid; k++) {
      slots[mid - k] = pool[(anchor - k + pool.length * 2) % pool.length];
      slots[mid + k] = pool[(anchor + k) % pool.length];
    }
    // pool 比 FAN 小时两侧会取到同一个人，去重后阵型自动收窄。
    const seen = new Set<string>();
    return slots.filter((n): n is ArtistNode => {
      if (!n || seen.has(n.id)) return false;
      seen.add(n.id);
      return true;
    });
  }, [nodes, withPortrait, heroId]);

  const hero = nodeById.get(heroId) || fan[0] || nodes[0];
  const heroIndex = hero ? nodes.findIndex(n => n.id === hero.id) : 0;

  const next = () => {
    const pool = withPortrait.length >= 2 ? withPortrait : nodes;
    if (pool.length < 2) return;
    const at = pool.findIndex(n => n.id === heroId);
    setHeroId(pool[(at + 1) % pool.length].id);
  };

  // 指针位置 → 舞台上的两个 CSS 变量。直接写 style，不触发 React 重渲染。
  const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const fx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width - 0.5) * 2));
    const fy = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height - 0.5) * 2));
    stage.style.setProperty('--fx', fx.toFixed(3));
    stage.style.setProperty('--fy', fy.toFixed(3));
  };
  const resetPointer = () => {
    stageRef.current?.style.setProperty('--fx', '0');
    stageRef.current?.style.setProperty('--fy', '0');
  };

  const today = new Date();
  const stamp = `${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;
  const provinces = new Set(nodes.map(n => provinceOf(n.city))).size;
  const stats = (node: ArtistNode) => ({
    workCount: workCounts.get(node.id) || 0,
    relationCount: relationCounts.get(node.id) || 0,
    average: ratings[node.id]?.average,
    count: ratings[node.id]?.count,
  });

  return <section className="today-hero" aria-label="今日人物">
    <div className="thv-spine" aria-hidden="true">
      <span>FLOWLINE</span><i /> ARCHIVE OF CHINESE RAP
    </div>

    <div className="thv-copy">
      <span className="thv-kicker"><i />今日翻牌 · {stamp}</span>
      <h1>{nodes.length} 位人物，<br />{relations.length} 条关系，<br />一张一张翻。</h1>
      <p className="thv-hook">
        每天换一位中文说唱人物。翻开卡，合作、厂牌与冲突线索都在同一条关系网里，
        覆盖 {provinces} 个省份 —— 缺的部分等你补。
      </p>
      <div className="thv-actions">
        <button className="thv-primary" onClick={() => setDetailOpen(true)} tabIndex={0}>
          翻开 {hero?.name} 的卡 <ArrowRight size={15} />
        </button>
        <button className="thv-ghost" onClick={next}><RefreshCw size={14} />换一位</button>
      </div>
      <p className="thv-meta">
        <b>{hero?.name}</b>
        <span>{hero ? `${provinceLabel(provinceOf(hero.city))} · ${hero.category}` : ''}</span>
        <span>NO.{String(heroIndex + 1).padStart(3, '0')} / {nodes.length}</span>
      </p>
    </div>

    <div className="thv-stage" ref={stageRef} onPointerMove={trackPointer} onPointerLeave={resetPointer}>
      <div className="thv-fan">
        {fan.map((node, i) => <HeroCard key={node.id} node={node}
          index={nodes.findIndex(n => n.id === node.id)} total={nodes.length}
          slot={i - (fan.length - 1) / 2} stats={stats(node)}
          inBeef={beefSet.has(node.id)} isFront={node.id === hero?.id}
          onOpen={() => setDetailOpen(true)}
          onPromote={() => setHeroId(node.id)} />)}
      </div>
      <div className="thv-floor" aria-hidden="true" />
      <div className="thv-plinth" aria-hidden="true" />
    </div>

    <aside className="thv-beef" aria-label="冲突线索">
      <header className="thv-beef-head">
        <span className="thv-beef-kicker"><Zap size={13} />BEEF 线索</span>
        <b>{beefList.length}</b>
      </header>
      {beefList.length === 0
        ? <p className="thv-beef-empty"><FileSearch size={15} />还没有可查的冲突记录。</p>
        : <ul className="thv-beef-list">
          {beefList.slice(0, 4).map(beef => {
            const sides = beef.sides.filter((s): s is NonNullable<typeof s> => !!s);
            return <li key={beef.id}>
              <button className="thv-beef-row" onClick={() => setOpenBeef(beef)}>
                <span className="thv-beef-faces">
                  {sides.map(side => {
                    const node = nodeById.get(side.nodeId);
                    // 没有照片的人用像素头像兜底，不留空格子。
                    return node
                      ? <span key={side.nodeId} className="thv-beef-face"><Avatar node={node} /></span>
                      : <i key={side.nodeId} className="thv-beef-unknown">?</i>;
                  })}
                  {beef.sides[1] === null && <i className="thv-beef-unknown">?</i>}
                </span>
                <span className="thv-beef-body">
                  <b>{beef.title}</b>
                  <small>{beef.status === 'verified' ? '已核实' : '待核实 · 可补充'}</small>
                </span>
              </button>
            </li>;
          })}
        </ul>}
      <p className="thv-beef-foot">
        涉及真人的内容必须附可查证来源，本站只公开核实过的经过。
      </p>
    </aside>

    <dl className="thv-rail" aria-label="收录概况">
      {[
        ['人物', nodes.length],
        ['关系', relations.length],
        ['作品', works.length],
        ['省份', provinces],
        ['BEEF', beefList.length],
      ].map(([label, value]) => <div key={label}>
        <dt>{label}</dt><dd>{value}</dd>
      </div>)}
      <p>数据全部来自公开来源与网友补充，每条关系都附证据链接。</p>
    </dl>

    {detailOpen && hero && <RapperDetail node={hero} stat={ratings[hero.id]}
      workCount={workCounts.get(hero.id) || 0} relationCount={relationCounts.get(hero.id) || 0}
      inBeef={beefSet.has(hero.id)}
      onClose={() => setDetailOpen(false)}
      onLocate={() => { setDetailOpen(false); onLocate(hero.id); }}
      onRated={() => void refresh()} />}

    {openBeef && <BeefCard beef={openBeef} nodeById={nodeById}
      onClose={() => setOpenBeef(null)}
      onPick={id => { setOpenBeef(null); setHeroId(id); }}
      onLocate={id => { setOpenBeef(null); onLocate(id); }} />}
  </section>;
}
