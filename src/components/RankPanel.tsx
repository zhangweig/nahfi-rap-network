import {useMemo, useState} from 'react';
import {Bookmark, Crown, Star, TrendingUp, Users} from 'lucide-react';
import {useDatasetData, useDatasetStatus} from '../state/Dataset';
import {useFavorites} from '../state/favorites';
import {thumbPath} from './PixelAvatar';
import {provinceLabel, provinceOf} from '../lib/province';
import {RapperDetail} from './RapperDetail';
import {allBeefs, loadLocalBeefs, beefNodeIds} from '../data/beefs';

type Tab = 'top' | 'popular' | 'saved';
const TABS: [Tab, string, typeof Star][] = [
  ['top', '均分榜', Star],
  ['popular', '人气榜', Users],
  ['saved', '我的收藏', Bookmark],
];

/**
 * 回访页：评分均分榜 / 评分人数榜 / 本机收藏夹。
 * 数据全部来自现有 ratings 与 nodes，不引入新后端字段。
 */
export function RankPanel({onLocate}:{onLocate:(id:string)=>void}) {
  const {nodes, relations, works, beefs, ratings} = useDatasetData();
  const {refresh} = useDatasetStatus();
  const favorites = useFavorites();
  const [tab, setTab] = useState<Tab>('top');
  const [detailId, setDetailId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  // 索引一次，避免给榜单每个条目重复全量 filter。
  const {workCountById, relationCountById, beefIds} = useMemo(() => {
    const w = new Map<string, number>();
    for (const work of works) for (const id of work.artistIds) w.set(id, (w.get(id) || 0) + 1);
    const r = new Map<string, number>();
    for (const rel of relations) {
      r.set(rel.source, (r.get(rel.source) || 0) + 1);
      r.set(rel.target, (r.get(rel.target) || 0) + 1);
    }
    return {workCountById: w, relationCountById: r, beefIds: beefNodeIds(allBeefs(beefs, loadLocalBeefs()))};
  }, [works, relations, beefs]);

  const rated = useMemo(() => Object.entries(ratings)
    .filter(([id, stat]) => !!stat && stat.count > 0 && nodeById.has(id))
    .map(([id, stat]) => ({id, node: nodeById.get(id)!, ...stat})), [ratings, nodeById]);

  const top = useMemo(() => [...rated].sort((a, b) => b.average - a.average || b.count - a.count).slice(0, 20), [rated]);
  const popular = useMemo(() => [...rated].sort((a, b) => b.count - a.count || b.average - a.average).slice(0, 20), [rated]);
  const saved = useMemo(() => favorites.map(id => nodeById.get(id)).filter((n): n is NonNullable<typeof n> => !!n), [favorites, nodeById]);

  const rows = tab === 'top' ? top : tab === 'popular' ? popular : saved;
  const detail = detailId ? nodeById.get(detailId) || null : null;

  return <section className="rank-panel" aria-label="榜单与收藏">
    <header className="rank-head">
      <div className="rank-head-title"><Crown size={22} /><div><h2>社区榜单</h2><p>由网友评分与收藏共同决定 · 每次回来都有新变化</p></div></div>
      <div className="rank-tabs" role="tablist">
        {TABS.map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key}
          className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
          <Icon size={15} />{label}{key === 'saved' && favorites.length > 0 && <span className="rank-tab-count">{favorites.length}</span>}
        </button>)}
      </div>
    </header>

    {rows.length === 0
      ? <div className="rank-empty">
          {tab === 'saved' ? <Bookmark size={38} /> : <Star size={38} />}
          <h3>{tab === 'saved' ? '还没有收藏' : '榜单还空着'}</h3>
          <p>{tab === 'saved'
            ? '打开任意人物大卡，点「收藏」就能把它放进这里。'
            : '还没有人评分。去人物页给喜欢的 rapper 打第一颗星。'}</p>
        </div>
      : <ol className="rank-list">
          {rows.map((row, i) => {
            const node = 'node' in row ? row.node : row;
            const stat = 'average' in row ? row : undefined;
            return <li key={node.id}>
              <button className="rank-row" onClick={() => setDetailId(node.id)}>
                <span className={`rank-no ${i < 3 ? 'is-top' : ''}`}>{String(i + 1).padStart(2, '0')}</span>
                <span className="rank-face"><img src={thumbPath(node)} alt="" width={96} height={96} loading="lazy" decoding="async" /></span>
                <span className="rank-who"><b>{node.name}</b><small>{provinceLabel(provinceOf(node.city))} · {node.category}</small></span>
                {stat
                  ? <span className="rank-score"><b>{stat.average.toFixed(1)}</b><small><Star size={11} fill="currentColor" /> {stat.count} 人</small></span>
                  : <span className="rank-score"><b>—</b><small>已收藏</small></span>}
              </button>
            </li>;
          })}
        </ol>}

    {tab !== 'saved' && rated.length > 0 && <p className="rank-foot"><TrendingUp size={13} /> 共 {rated.length} 位人物已有评分 · 评分实时计入，无需审核</p>}

    {detail && <RapperDetail node={detail} stat={ratings[detail.id]}
      workCount={workCountById.get(detail.id) || 0}
      relationCount={relationCountById.get(detail.id) || 0}
      inBeef={beefIds.has(detail.id)}
      onClose={() => setDetailId(null)}
      onLocate={() => { setDetailId(null); onLocate(detail.id); }}
      onRated={() => void refresh()} />}
  </section>;
}
