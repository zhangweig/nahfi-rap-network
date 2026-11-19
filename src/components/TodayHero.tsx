import {useMemo, useState} from 'react';
import {useDataset} from '../state/Dataset';
import {avatarPath, thumbPath} from './PixelAvatar';
import {RapperDetail} from './RapperDetail';
import {allBeefs, loadLocalBeefs, beefNodeIds} from '../data/beefs';
import {provinceLabel, provinceOf} from '../lib/province';
import type {ArtistNode} from '../data/types';

/**
 * 今日首屏：走廊两侧是看不清的人像卡飞过，正中一张当日主角卡，
 * 底部一句话说明这个网站能做什么。数字全部来自公开数据，不写死。
 */
export function TodayHero({onLocate}:{onLocate:(id:string)=>void}) {
  const {data:{nodes, relations, works, beefs, ratings}, refresh} = useDataset();

  // 只有真实头像的人物才做卡片（走廊 + 换一位候选），避免像素占位图充数。
  const portraitNodes = useMemo(() => nodes.filter(n => !!avatarPath(n)), [nodes]);
  const [heroId, setHeroId] = useState('air');
  const [detailOpen, setDetailOpen] = useState(false);

  const hero:ArtistNode = portraitNodes.find(n => n.id === heroId) || portraitNodes[0] || nodes[0];
  const heroIndex = nodes.findIndex(n => n.id === hero?.id);
  const relationCount = relations.filter(r => r.source === hero?.id || r.target === hero?.id).length;
  const workCount = works.filter(w => w.artistIds.includes(hero?.id)).length;
  const inBeef = hero ? beefNodeIds(allBeefs(beefs, loadLocalBeefs())).has(hero.id) : false;
  const province = hero ? provinceLabel(provinceOf(hero.city)) : '';

  // 走廊飞卡：排除主角自己，左右交替，循环播。
  const flyers = useMemo(() => {
    const pool = portraitNodes.filter(n => n.id !== heroId);
    const list = pool.length ? pool : portraitNodes;
    return Array.from({length: 24}, (_, i) => list[i % list.length]).filter(Boolean);
  }, [portraitNodes, heroId]);

  const next = () => {
    if (portraitNodes.length < 2) return;
    const at = portraitNodes.findIndex(n => n.id === heroId);
    setHeroId(portraitNodes[(at + 1) % portraitNodes.length].id);
  };

  const today = new Date();
  const stamp = `${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')}`;

  return <section className="today-hero" aria-label="今日人物">
    <div className="th-corridor" aria-hidden="true">
      <div className="th-floor" />
      {flyers.map((node, i) => (
        <div key={`${node.id}-${i}`} className={`th-flyer ${i % 2 ? 'right' : 'left'}`}
          style={{animationDelay: `${-(i * (8 / flyers.length)).toFixed(2)}s`}}>
          <div className="th-face"><img src={thumbPath(node)} alt="" width={160} height={160} loading="lazy" decoding="async" draggable={false} /></div>
        </div>
      ))}
    </div>

    <div className="th-stage">
      <button className="th-card" onClick={() => setDetailOpen(true)} aria-label={`翻开 ${hero?.name} 的卡`}>
        <div className="th-card-top">
          <span className="th-serial">NO. {String(heroIndex + 1).padStart(3, '0')} / {nodes.length}</span>
          <span>{hero?.kind === 'group' ? 'CREW' : 'ARTIST'} · {province}</span>
        </div>
        <div className="th-portrait">
          <img src={hero ? avatarPath(hero) : ''} alt={hero ? `${hero.name}头像` : ''} width={320} height={320} decoding="async" fetchPriority="high" draggable={false} />
          <span className="th-scan" aria-hidden="true" />
        </div>
        <div className="th-body">
          <div className="th-name">{hero?.name}</div>
          <div className="th-city">{hero?.city} · {hero?.category}</div>
          {hero?.description && <p className="th-desc">{hero.description}</p>}
          <div className="th-stats">
            <span><b>{relationCount}</b><small>关系</small></span>
            <span><b>{workCount}</b><small>作品</small></span>
            <span className="th-rate">
              <span className="th-stars">{ratings[hero?.id]?.average ? '★'.repeat(Math.round(ratings[hero.id].average)) + '☆'.repeat(5 - Math.round(ratings[hero.id].average)) : '☆☆☆☆☆'}</span>
              <small>{ratings[hero?.id]?.count ? `${ratings[hero.id].average.toFixed(1)} · ${ratings[hero.id].count} 人评分` : '暂无评分 · 来做第一个'}</small>
            </span>
          </div>
        </div>
      </button>
    </div>

    <div className="th-bottom">
      <div className="th-kicker"><span className="th-dot" />THE FACE OF TODAY · {stamp}</div>
      <h1>今日人物 · <em>{hero?.name}</em></h1>
      <p className="th-hook">{nodes.length} 位中文说唱人物，收录 {relations.length} 条关系，等你来补全</p>
      <div className="th-actions">
        <button className="th-primary" onClick={() => setDetailOpen(true)}>翻开这张卡 →</button>
        <button className="th-ghost" onClick={next}>换一位</button>
      </div>
    </div>

    <div className="th-signature">FLOWLINE / 一张卡就是一个入口</div>

    {detailOpen && hero && <RapperDetail node={hero} stat={ratings[hero.id]}
      workCount={workCount} relationCount={relationCount} inBeef={inBeef}
      onClose={() => setDetailOpen(false)}
      onLocate={() => { setDetailOpen(false); onLocate(hero.id); }}
      onRated={() => void refresh()} />}
  </section>;
}
