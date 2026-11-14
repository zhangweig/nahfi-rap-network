import {useMemo, useState} from 'react';
import {Activity, MapPin, Pencil, Radio, Sparkles, X} from 'lucide-react';
import {Avatar} from './PixelAvatar';
import {provinceLabel, provinceOf, UNKNOWN_PROVINCE} from '../lib/province';
import {relationMeta, relationYear} from '../lib/board';
import type {ArtistNode, Relationship, Work, RelationType} from '../data/types';

const bars = (value: number, total = 12) => {
  const filled = Math.max(1, Math.min(total, Math.round(value * total)));
  return Array.from({length: total}, (_, index) => <em key={index} className={index < filled ? 'on' : ''} />);
};

export function ArtistPanel({current, works, relations, nodeById, types, canContribute, onPick, onEdit, onContribute, onClose}: {
  current: ArtistNode | null;
  works: Work[];
  relations: Relationship[];
  nodeById: Map<string, ArtistNode>;
  types: RelationType[];
  /** Static build (no API): hide the write entry points instead of offering dead buttons. */
  canContribute: boolean;
  onPick: (id: string) => void;
  onEdit: (node: ArtistNode) => void;
  onContribute: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'works' | 'relations'>('works');

  const stats = useMemo(() => {
    if (!current) return null;
    const artistWorks = works.filter(work => work.artistIds.includes(current.id));
    const artistRelations = relations.filter(relation => relation.source === current.id || relation.target === current.id);
    const focusedRelations = artistRelations.filter(relation => types.includes(relation.type));
    const years = artistWorks.map(work => work.year).concat(
      artistRelations.map(relation => relationYear(relation as any) || 0).filter(Boolean),
    );
    const first = years.length ? Math.min(...years) : null;
    const last = years.length ? Math.max(...years) : null;
    const partners = new Set<string>();
    focusedRelations.forEach(relation => partners.add(relation.source === current.id ? relation.target : relation.source));
    const provinces = new Set([...partners].map(id => provinceOf(nodeById.get(id)?.city)));
    return {
      works: artistWorks,
      relations: artistRelations,
      focusedRelations,
      partners: partners.size,
      provinces: provinces.size,
      first,
      last,
      recent: [...artistWorks].sort((a, b) => b.year - a.year).slice(0, 3),
    };
  }, [current, works, relations, types, nodeById]);

  if (!current || !stats) {
    return <aside className="artist-panel game-card empty-card">
      <div className="gc-empty">
        <Radio size={22} />
        <h2>选择一个人物</h2>
        <p>在关系网上点击任意头像，展开他的作品、关系与档案。</p>
      </div>
    </aside>;
  }

  const province = provinceOf(current.city);
  const span = stats.first && stats.last ? `${String(stats.first).slice(2)}–${String(stats.last).slice(2)}` : '待补充';
  const level = Math.min(99, 12 + stats.works.length * 2 + stats.relations.length);

  return <aside className="artist-panel game-card">
    <div className="gc-head">
      <div className="gc-avatar" style={{['--c' as string]: current.color}}>
        <Avatar node={current} large />
        <span className="gc-level">LV.{level}</span>
      </div>
      <div className="gc-id">
        <span className="gc-kind">{current.kind === 'group' ? 'CREW / 团体' : 'RAPPER / 说唱音乐人'}</span>
        <h2>{current.name}</h2>
        <p className="gc-alias">{current.aliases?.slice(0, 3).join(' / ') || 'NAHFI ARCHIVE'}</p>
        <span className="gc-prov"><MapPin size={11} />{provinceLabel(province)}{current.city !== '未标注' && current.city !== province && province !== UNKNOWN_PROVINCE ? ` · ${current.city}` : ''}</span>
      </div>
      {canContribute && <button className="gc-edit" onClick={() => onEdit(current)} aria-label="编辑人物信息"><Pencil size={14} /></button>}
      <button className="gc-close" onClick={onClose} aria-label="收起人物面板"><X size={14} /></button>
    </div>

    <div className="gc-stats">
      <div><b>{stats.works.length}</b><small>作品</small></div>
      <div><b>{stats.relations.length}</b><small>关系</small></div>
      <div><b>{stats.partners}</b><small>合作者</small></div>
      <div><b>{span}</b><small>活跃年段</small></div>
    </div>

    <div className="gc-bars">
      <div className="gc-bar"><span>作品密度</span><i>{bars(Math.min(1, stats.works.length / 26))}</i><b>{Math.min(99, stats.works.length * 3 + 20)}</b></div>
      <div className="gc-bar"><span>合作广度</span><i>{bars(Math.min(1, stats.partners / 24))}</i><b>{Math.min(99, stats.partners * 3 + 12)}</b></div>
      <div className="gc-bar"><span>圈层跨度</span><i>{bars(Math.min(1, stats.provinces / 6))}</i><b>{Math.min(99, stats.provinces * 14 + 8)}</b></div>
    </div>

    <p className="gc-bio">{current.description}</p>
    {province === UNKNOWN_PROVINCE && <p className="gc-note">该人物暂无有来源的省份信息，暂列“待考据档案区”，补齐地域证据后会自动并入对应聚落。</p>}

    <div className="gc-moments">
      <h3><Sparkles size={12} /> HIGHLIGHT MOMENTS</h3>
      <div className="gc-shots">
        {stats.recent.length ? stats.recent.map((work, index) => <button key={work.id} onClick={() => onPick(current.id)}
          style={{['--h' as string]: ['#ff3d6e', '#35d6ff', '#ffc93c'][index % 3]}}>
          <span className="gc-shot-art">{work.title.slice(0, 1)}</span>
          <span className="gc-shot-meta"><b>{work.title}</b><small>{work.year} · {work.version}</small></span>
        </button>) : <p className="gc-none">暂未收录作品</p>}
      </div>
    </div>

    <div className="gc-track">
      <div className="gc-track-top"><Radio size={13} /><span>TRACK RECORD</span><b>{stats.works.length}</b></div>
      <div className="gc-wave">{Array.from({length: 26}, (_, index) => <i key={index} style={{height: `${18 + ((index * 37) % 62)}%`}} />)}</div>
      <p>{stats.recent[0]?.title || '暂无代表作品'} <small>{stats.recent[0]?.year || ''}</small></p>
    </div>

    <div className="gc-tabs">
      <button className={tab === 'works' ? 'on' : ''} onClick={() => setTab('works')}>作品 <b>{stats.works.length}</b></button>
      <button className={tab === 'relations' ? 'on' : ''} onClick={() => setTab('relations')}>关系 <b>{stats.focusedRelations.length}</b></button>
    </div>

    <div className="gc-scroll">
      {tab === 'works' ? (stats.works.length ? stats.works.map(work => <article className="gc-row" key={work.id}>
        <span className="gc-row-year">{work.year}</span>
        <div><b>{work.title}</b><small>{work.version}{work.artistIds.length > 1 ? ` · ${work.artistIds.length} 人参与` : ''}</small></div>
      </article>) : <p className="gc-none">暂未收录作品。可通过“添加关系”补充有据可查的合作。</p>)
        : (stats.focusedRelations.length ? stats.focusedRelations.map(relation => {
          const otherId = relation.source === current.id ? relation.target : relation.source;
          const meta = relationMeta[relation.type];
          return <article className="gc-row is-link" key={relation.id}>
            <span className="gc-row-year" style={{color: meta.color}}>{meta.tag}</span>
            <div>
              <button onClick={() => onPick(otherId)}>{nodeById.get(otherId)?.name} ↗</button>
              <small>{relation.label} · {relationYear(relation as any) || '年份待补充'}</small>
              <details><summary>证据</summary>{relation.evidence.map((evidence, index) => <p key={index}>
                <a href={evidence.url} target="_blank" rel="noopener noreferrer">{evidence.title} ↗</a>{evidence.note}</p>)}</details>
            </div>
          </article>;
        }) : <p className="gc-none">当前筛选下暂无关系记录。</p>)}
    </div>

    <details className="gc-sources">
      <summary><Activity size={12} /> 人物资料来源</summary>
      {current.sources?.length ? current.sources.map((source, index) => <a key={index} href={source.url} target="_blank" rel="noopener noreferrer">{source.title} ↗</a>) : <p>成员及历史关联的证据请查看关系记录。</p>}
    </details>

    {canContribute && <button className="gc-contribute" onClick={onContribute}>＋ 补充人物关系</button>}
  </aside>;
}
