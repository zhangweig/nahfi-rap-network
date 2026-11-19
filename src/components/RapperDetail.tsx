import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent} from 'react';
import {Bookmark, MapPin, Star} from 'lucide-react';
import type {ArtistNode} from '../data/types';
import type {RatingStat} from '../state/Dataset';
import {api} from '../state/Dataset';
import {useFavorites, toggleFavorite} from '../state/favorites';
import {avatarPath} from './PixelAvatar';
import {provinceLabel, provinceOf} from '../lib/province';

/** 匿名投票者标识：仅用于「一人一票、可改分」去重，不收集任何身份信息。 */
function voterId(): string {
  const KEY = 'nahfi-rating-voter';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + Math.random().toString(36).slice(2, 10);
  }
}

/** 本机已评分记录：重新打开大卡时能回显「你的评分」。 */
const MINE_KEY = 'nahfi-rating-mine';
function readMine(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || '{}'); } catch { return {}; }
}
function writeMine(map: Record<string, number>) {
  try { localStorage.setItem(MINE_KEY, JSON.stringify(map)); } catch { /* 隐私模式忽略 */ }
}

/**
 * 人物大卡 + 星级评分。点击球星卡弹出，不再跳地图。
 * 评分独立存储、不审核：提交后由父组件 refresh() 拉回新的均分。
 */
export function RapperDetail({node, stat, workCount, relationCount, inBeef,
  onClose, onLocate, onRated}:{
  node:ArtistNode; stat?:RatingStat; workCount:number; relationCount:number; inBeef?:boolean;
  onClose:()=>void; onLocate:()=>void; onRated:()=>void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(0);
  const [mine, setMine] = useState<number>(() => readMine()[node.id] || 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const favorites = useFavorites();
  const saved = favorites.includes(node.id);

  useEffect(() => {
    ref.current?.showModal();
    return () => { if (ref.current?.open) ref.current.close(); };
  }, []);

  const submit = async (stars: number) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await api('/ratings', {targetId: node.id, voter: voterId(), stars});
      const next = {...readMine(), [node.id]: stars};
      writeMine(next);
      setMine(stars);
      setNotice('评分已保存，感谢参与');
      onRated();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评分失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  /** 指针只驱动当前弹层的镭射相位与高光，离开后定格。 */
  const moveFoil = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const s = el.style;
    s.setProperty('--foil-px', `${(x * 100).toFixed(1)}%`);
    s.setProperty('--foil-py', `${(y * 100).toFixed(1)}%`);
    s.setProperty('--foil-bg-x', `${(37 + x * 26).toFixed(1)}%`);
    s.setProperty('--foil-bg-y', `${(33 + y * 34).toFixed(1)}%`);
    s.setProperty('--foil-bar-x', `${(50 + (0.5 - x) * 90).toFixed(1)}%`);
    s.setProperty('--foil-o', '.42');
    s.setProperty('--foil-glare-o', '.38');
    s.setProperty('--foil-art-o', '.62');
    s.setProperty('--foil-tilt-x', `${((0.5 - y) * 7).toFixed(2)}deg`);
    s.setProperty('--foil-tilt-y', `${((x - 0.5) * 9).toFixed(2)}deg`);
  };
  const resetFoil = () => {
    const s = cardRef.current?.style;
    if (!s) return;
    s.setProperty('--foil-px', '50%');
    s.setProperty('--foil-py', '50%');
    s.setProperty('--foil-bg-x', '50%');
    s.setProperty('--foil-bg-y', '50%');
    s.setProperty('--foil-bar-x', '50%');
    s.setProperty('--foil-o', '.22');
    s.setProperty('--foil-glare-o', '.18');
    s.setProperty('--foil-art-o', '.32');
    s.setProperty('--foil-tilt-x', '0deg');
    s.setProperty('--foil-tilt-y', '0deg');
  };

  const path = avatarPath(node);
  const province = provinceLabel(provinceOf(node.city));
  const serial = node.initials || node.name.slice(0, 1);
  const avg = stat?.average || 0;
  const filled = Math.round(avg);

  // 点击遮罩/弹层自身空白处关闭；点卡片与评分区不误触
  const onDialogClick = (e: ReactMouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current) onClose();
  };

  return <dialog ref={ref} className="rapper-detail-dialog"
    onClick={onDialogClick}
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="rd-card foil-card" ref={cardRef} onPointerMove={moveFoil} onPointerLeave={resetFoil}>
      <div className="rd-top">
        <span className="rd-kind">{node.kind === 'group' ? 'CREW' : 'RAPPER'}</span>
        <span className="rd-cat">{node.category}</span>
      </div>
      <div className="rd-art">
        {path
          ? <img src={path} alt={`${node.name}头像`} draggable={false} />
          : <span className="rd-art-ph">{serial}</span>}
        <span className="rd-art-ascii" aria-hidden="true" />
        <span className="foil-art" aria-hidden="true" />
        {inBeef && <span className="rd-beef">⚡ BEEF</span>}
      </div>
      <div className="rd-body">
        <h2 className="rd-name">{node.name}</h2>
        <p className="rd-prov"><MapPin size={13} />{province} · {node.city}</p>
        {node.description && <p className="rd-desc">{node.description}</p>}
        <div className="rd-stats">
          <span><b>{workCount}</b><small>作品</small></span>
          <span><b>{relationCount}</b><small>关系</small></span>
          <span><b>{stat?.count || 0}</b><small>人评分</small></span>
        </div>
      </div>
      <span className="foil-card__layer foil-card__shine" aria-hidden="true" />
      <span className="foil-card__layer foil-card__glare" aria-hidden="true" />
      <span className="foil-card__layer foil-card__edge" aria-hidden="true" />
    </div>

    <div className="rd-rating">
      <div className="rd-score">
        <span className="rd-score-num">{avg ? avg.toFixed(1) : '—'}</span>
        <span className="rd-score-of">/ 5</span>
        <span className="rd-stars-static" aria-label={`平均 ${avg} 星`}>
          {[1, 2, 3, 4, 5].map(i => <Star key={i} size={16} className={i <= filled ? 'on' : ''} fill={i <= filled ? 'currentColor' : 'none'} />)}
        </span>
      </div>
      <p className="rd-hint">网友评分平均值 · 无需审核，所有评分直接计入</p>
      <div className="rd-rate-row" onMouseLeave={() => setHover(0)}>
        <span className="rd-mine-label">{mine ? '你的评分' : '给它打分'}</span>
        <span className="rd-stars-input" role="group" aria-label="给这位人物打分">
          {[1, 2, 3, 4, 5].map(i => (
            <button key={i} className={(hover || mine) >= i ? 'on' : ''}
              onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(0)}
              onClick={() => void submit(i)} disabled={busy}
              aria-label={`${i} 星`} title={`${i} 星`}>
              <Star size={26} fill={(hover || mine) >= i ? 'currentColor' : 'none'} />
            </button>
          ))}
        </span>
      </div>
      {notice && <p className="rd-notice" role="status">{notice}</p>}
      <div className="rd-actions">
        <button className={`rd-save ${saved ? 'is-saved' : ''}`} onClick={() => toggleFavorite(node.id)}
          aria-pressed={saved} aria-label={saved ? '取消收藏' : '收藏这位人物'}>
          <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />{saved ? '已收藏' : '收藏'}
        </button>
        <button className="rd-locate" onClick={() => { onClose(); onLocate(); }}>
          <MapPin size={14} />在关系网中定位
        </button>
      </div>
    </div>
  </dialog>;
}
