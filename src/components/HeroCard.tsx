import {useEffect, useMemo, useRef} from 'react';
import {avatarPath} from './PixelAvatar';
import {drawPortrait} from '../lib/portrait';
import {provinceLabel, provinceOf} from '../lib/province';
import type {ArtistNode} from '../data/types';

/**
 * 首屏的实体卡。纯 DOM + CSS 3D，不用 WebGL——首屏要的是立刻可见，
 * 而不是等 three.js 下载完才出现。
 *
 * 卡面分层顺序（自下而上）：卡体 → 头像/程序化人像 → 镭射 → 镜面反光 → 文字。
 * 镭射和反光都由舞台上的指针变量 --fx/--fy 驱动，卡片本身不监听鼠标，
 * 五张卡共享一次指针计算。
 */

export interface HeroCardStats {
  workCount: number;
  relationCount: number;
  average?: number;
  count?: number;
}

export function HeroCard({
  node, index, total, slot, stats, inBeef, isFront, onOpen, onPromote,
}:{
  node: ArtistNode;
  index: number;
  total: number;
  /** 带符号的横向档位：-2…2，0 就是正中那张。 */
  slot: number;
  stats: HeroCardStats;
  inBeef: boolean;
  isFront: boolean;
  onOpen: () => void;
  onPromote: () => void;
}) {
  const artRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photo = avatarPath(node);
  const serial = String(index + 1).padStart(3, '0');

  // 没有照片时画程序化人像。canvas 尺寸跟着盒子走，且限幅 DPR2——
  // 首屏同时最多五张卡，再高就是白烧 GPU。
  useEffect(() => {
    if (photo) return;
    const box = artRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const paint = () => {
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawPortrait(ctx, 0, 0, w, h, {seed: index + 3, accent: node.color});
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(box);
    return () => observer.disconnect();
  }, [node.id, node.color, index, photo]);

  // 条码由序号确定性生成：同一张卡一直是同一个条码。
  const bars = useMemo(() => {
    let s = ((index + 1) * 104729) % 2147483647 || 1;
    return Array.from({length: 26}, () => {
      s = (s * 48271) % 2147483647;
      return (s - 1) / 2147483646 > 0.56 ? 2 : 1;
    });
  }, [index]);

  const province = provinceLabel(provinceOf(node.city));
  const stars = stats.average ? Math.round(stats.average) : 0;

  return <article
    className={`thc ${isFront ? 'is-front' : ''}`}
    style={{'--k': slot, '--a': Math.abs(slot)} as React.CSSProperties}
    aria-hidden={!isFront}
  >
    <button className="thc-hit" onClick={isFront ? onOpen : onPromote}
      tabIndex={isFront ? 0 : -1}
      aria-label={isFront ? `翻开 ${node.name} 的档案` : `切换到 ${node.name}`}>
      <div className="thc-body">
        <div className="thc-head">
          <span className="thc-no">NO.{serial}</span>
          <span className="thc-kind">{node.kind === 'group' ? 'CREW' : 'RAPPER'}</span>
        </div>

        <div className="thc-art" ref={artRef}>
          {photo
            ? <img src={photo} alt={`${node.name} 头像`} width={320} height={320} draggable={false} decoding="async" />
            : <canvas ref={canvasRef} role="img" aria-label={`${node.name} 的占位人像`} />}
          <span className="thc-art-foil" aria-hidden="true" />
          <span className="thc-art-corner" aria-hidden="true" />
          {inBeef && <span className="thc-beef">⚡ BEEF</span>}
        </div>

        <div className="thc-plate">
          <b>{node.name}</b>
          <i>{province}{node.aliases?.[0] ? ` · ${node.aliases[0]}` : ''}</i>
        </div>

        <div className="thc-stats">
          <span><b>{stats.workCount}</b><small>作品</small></span>
          <span><b>{stats.relationCount}</b><small>关系</small></span>
          <span className="thc-rate">
            <b>{stats.average ? stats.average.toFixed(1) : '—'}</b>
            <small>{stats.average ? '★'.repeat(stars) + '☆'.repeat(5 - stars) : '未评分'}</small>
          </span>
        </div>

        <div className="thc-tail" aria-hidden="true">
          <span className="thc-bars">{bars.map((w, i) => <i key={i} style={{width: w}} />)}</span>
          <em>{serial}/{String(total).padStart(3, '0')}</em>
        </div>

        <span className="thc-foil" aria-hidden="true" />
        <span className="thc-glare" aria-hidden="true" />
      </div>
    </button>
  </article>;
}
