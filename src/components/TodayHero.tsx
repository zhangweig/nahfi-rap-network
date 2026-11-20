import {useEffect, useMemo, useRef, useState} from 'react';
import {ArrowRight, FileSearch, Zap} from 'lucide-react';
import {useDatasetData, useDatasetStatus} from '../state/Dataset';
import {Avatar, avatarPath} from './PixelAvatar';
import {HeroCard} from './HeroCard';
import {RapperDetail} from './RapperDetail';
import {BeefCard} from './BeefCard';
import {allBeefs, loadLocalBeefs, beefNodeIds, type BeefEvent} from '../data/beefs';
import {provinceLabel, provinceOf} from '../lib/province';
import {heatWeight} from '../lib/heat';
import type {ArtistNode} from '../data/types';

/** 卡阵张数：正中一张 + 两侧各两张。奇数才有「正中」。 */
const FAN = 5;

/** 按权重抽一个；exclude 里的人不参与。 */
function weightedPick<T extends {id: string}>(
  pool: T[], weights: Map<string, number>, exclude?: Set<string>,
): T | undefined {
  const choices = exclude ? pool.filter(n => !exclude.has(n.id)) : pool;
  if (!choices.length) return undefined;
  let total = 0;
  for (const n of choices) total += weights.get(n.id) ?? 1;
  let r = Math.random() * total;
  for (const n of choices) {
    r -= weights.get(n.id) ?? 1;
    if (r <= 0) return n;
  }
  return choices[choices.length - 1];
}

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

  // 热度表先算好再抽人，这样主角、侧卡、翻页用的是同一套权重。
  const weights = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of nodes) map.set(n.id, heatWeight(
      relationCounts.get(n.id) || 0,
      workCounts.get(n.id) || 0,
      ratings[n.id],
    ));
    return map;
  }, [nodes, workCounts, relationCounts, ratings]);

  // 今日主角：每次进首页按热度加权抽一位，关系多、呼声高的更容易被翻到。
  const [heroId, setHeroId] = useState(() => {
    const pool = withPortrait.length >= 2 ? withPortrait : nodes;
    return weightedPick(pool, weights)?.id || 'air';
  });
  const [detailOpen, setDetailOpen] = useState(false);
  const [openBeef, setOpenBeef] = useState<BeefEvent | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  /**
   * 跟手位移 + 阻尼吸附引擎（参考 Embla / Keen Slider / motion 的共同机制：
   * 输入先作用到一个连续的位移量，再由弹簧把它拉回目标，而不是让内容瞬间跳变）。
   * pos 当前位移 / vel 速度 / target 目标（静止时恒为 0）。
   * 每帧把 pos 写进 --dragX，卡阵整体平移，形成"抽出一张、推入一张"的连续质感。
   */
  const drag = useRef({pos: 0, vel: 0, target: 0, raf: 0, lastMs: 0});
  const snapTimer = useRef<number | undefined>(undefined);
  // step 每次渲染都会重建，放进 ref 让常驻的 rAF/wheel 监听读到最新版本，
  // 这样监听只挂载一次，不会因为 heroId 变化反复解绑重绑。
  const stepRef = useRef<(dir: -1 | 1) => void>(() => {});

  const beefList = useMemo(() => allBeefs(beefs, loadLocalBeefs()), [beefs]);
  const beefSet = useMemo(() => beefNodeIds(beefList), [beefList]);

  // 卡阵：主角固定在正中，另外四张各自按热度加权独立抽取，互不重复。
  // 不再取数组邻居——旧逻辑会让同省的人连成一串，看着像按地区派发。
  const fan = useMemo(() => {
    const pool = withPortrait.length >= 2 ? withPortrait : nodes;
    const head = nodeById.get(heroId) || pool[0];
    if (!head) return [] as ArtistNode[];
    const used = new Set([head.id]);
    const sides: ArtistNode[] = [];
    for (let i = 1; i < FAN; i++) {
      const pick = weightedPick(pool, weights, used);
      if (!pick) break;
      used.add(pick.id);
      sides.push(pick);
    }
    const mid = Math.floor((FAN - 1) / 2);
    return [...sides.slice(0, mid), head, ...sides.slice(mid)];
  }, [nodes, withPortrait, heroId, weights, nodeById]);

  const hero = nodeById.get(heroId) || fan[0] || nodes[0];
  const heroIndex = hero ? nodes.findIndex(n => n.id === hero.id) : 0;

  /**
   * 每次按热度加权另抽一张，dir 只决定甩出方向，不再沿数组顺移。
   * 换主角的同时给弹簧一个反向"甩出"位移：卡阵先顺着翻页方向让出一点，
   * 再由弹簧带阻尼回到 0。整个过程是连续插值，不再是固定时长的 CSS 关键帧。
   */
  const step = (dir: -1 | 1) => {
    const pool = withPortrait.length >= 2 ? withPortrait : nodes;
    if (pool.length < 2) return;
    const next = weightedPick(pool, weights, new Set([heroId]));
    if (!next) return;
    setHeroId(next.id);
    // 甩出：下一张(-1 位移，卡片向左让位) / 上一张(+1 位移)。
    const stage = stageRef.current;
    const kick = stage ? Math.max(28, Math.min(stage.clientWidth * 0.09, 96)) : 56;
    drag.current.pos = -dir * kick;
    drag.current.vel = dir * 6;
    drag.current.target = 0;
  };
  stepRef.current = step;

  // 卡阵弹簧引擎：一个常驻 rAF 把 pos 用临界阻尼拉回 target，写进 --dragX。
  // 参数取接近临界阻尼（略欠阻尼，回弹极轻），手感和 Embla/Keen 的默认吸附一致。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let raf = 0;
    let last = 0;
    const STIFFNESS = 150; // 越大越快到位
    const DAMPING = 22;    // 越大越不晃；22/150 ≈ 略欠阻尼
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.04) : 0.016;
      last = now;
      const d = drag.current;
      // 半隐式欧拉：先加速度到速度，再由速度更新位置，低帧率下也稳定。
      d.vel += ((-STIFFNESS * d.pos - DAMPING * d.vel) * dt);
      d.pos += d.vel * dt;
      // 到位后吸附，避免浮点残余导致永远有微小位移。
      if (Math.abs(d.pos) < 0.15 && Math.abs(d.vel) < 0.4 && d.target === 0) {
        d.pos = 0; d.vel = 0;
      }
      stage.style.setProperty('--dragX', `${d.pos.toFixed(2)}px`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 滚轮切卡：滚轮量先推到 target（跟手位移），停止滚动后再吸附到最近一张。
    // 用原生非被动监听才能 preventDefault，阻止整页跟着滚。
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      event.preventDefault();
      const d = drag.current;
      // 累加位移并限幅：连续滚动会持续推动卡阵，而不是每 48px 硬跳一张。
      d.target = Math.max(-160, Math.min(160, d.target + delta * 1.15));
      window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => {
        // 停止滚动后：位移越过阈值就走一张，然后统一弹回 0。
        const cur = drag.current;
        if (Math.abs(cur.target) > 46) stepRef.current(cur.target > 0 ? 1 : -1);
        cur.target = 0;
      }, 140);
    };
    stage.addEventListener('wheel', onWheel, {passive: false});
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(snapTimer.current);
      stage.removeEventListener('wheel', onWheel);
    };
  }, []);

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
      </div>
      <p className="thv-meta">
        <b>{hero?.name}</b>
        <span>{hero ? `${provinceLabel(provinceOf(hero.city))} · ${hero.category}` : ''}</span>
        <span>NO.{String(heroIndex + 1).padStart(3, '0')} / {nodes.length}</span>
      </p>
    </div>

    <div className="thv-stage" ref={stageRef}
      onPointerMove={trackPointer} onPointerLeave={resetPointer}
      tabIndex={0} aria-label="人物卡阵，点击左右两侧翻页，或用左右方向键"
      onClick={e => {
        // 点在卡片上交给卡片自己处理：正面开档案、侧卡切到那张。
        // 点在卡片之外的空白处，则按左右半区翻页——这就是"点左右两边切换"。
        if ((e.target as HTMLElement).closest('.thc')) return;
        const rect = e.currentTarget.getBoundingClientRect();
        step(e.clientX < rect.left + rect.width / 2 ? -1 : 1);
      }}
      onKeyDown={e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      }}>
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
