import {useRef} from 'react';
import {X, ExternalLink, AlertTriangle} from 'lucide-react';
import type {BeefEvent, BeefEventKind} from '../data/beefs';
import type {ArtistNode} from '../data/types';
import {provinceLabel, provinceOf} from '../lib/province';
import {Avatar} from './PixelAvatar';

const MOMENT_LABEL: Record<BeefEventKind, string> = {
  diss: 'DISS', response: '回应', statement: '表态', reconcile: '和解', other: '其他',
};

/** 冲突档案卡：双方对阵 + 事件时间线 + 证据/来源。接续球星卡的焦橙+酸绿视觉。 */
export function BeefCard({beef, nodeById, onClose, onPick, onLocate}:{
  beef: BeefEvent;
  nodeById: Map<string, ArtistNode>;
  onClose: () => void;
  onPick: (id: string) => void;
  onLocate: (id: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const sides = beef.sides.filter((s): s is NonNullable<typeof s> => !!s);
  const verified = beef.status === 'verified';
  const hasDetail = beef.moments.length > 0 || beef.evidence.length > 0;

  return <div className="beef-card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="beef-card" ref={cardRef} role="dialog" aria-modal="true" aria-label={`冲突档案：${beef.title}`}>
      <header className="bfc-head">
        <div>
          <span className="bfc-kicker">BEEF FILE / 冲突档案</span>
          <h3>{beef.title}</h3>
        </div>
        <button className="bfc-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </header>

      <div className="bfc-status-row">
        <span className={`bfc-badge ${verified ? 'is-verified' : 'is-unverified'}`}>
          {verified ? '已核实' : '待核实'}
        </span>
        {beef.local && <span className="bfc-badge is-local">离线草稿 · 未公开 · 仅自己可见</span>}
      </div>

      <div className="bfc-versus">
        {sides.map((side, index) => {
          const node = nodeById.get(side.nodeId);
          return <div className="bfc-side" key={side.nodeId}>
            {node ? <button className="bfc-face" onClick={() => { onLocate(node.id); onClose(); }} title="在地图中定位">
              <Avatar node={node} />
            </button> : <div className="bfc-face bfc-face-empty">?</div>}
            <div className="bfc-side-info">
              <b>{node?.name ?? side.nodeId}</b>
              <small>{node ? `${provinceLabel(provinceOf(node.city))} · ${node.kind === 'group' ? '厂牌' : '音乐人'}` : '节点缺失'}</small>
              {side.note && <em>{side.note}</em>}
            </div>
            {index === 0 && <span className="bfc-vs">VS</span>}
          </div>;
        })}
        {beef.sides[1] === null && <p className="bfc-open">对手待补充 —— 欢迎在下方提交线索</p>}
      </div>

      <div className="bfc-section">
        <h4>事件时间线</h4>
        {beef.moments.length === 0
          ? <p className="bfc-empty">暂无已核实的事件记录。具体经过待核实后补充，不填写未经证实的传闻。</p>
          : <div className="bfc-timeline">
            {beef.moments.map((m, i) => <div className="bfc-moment" key={i}>
              <span className="bfc-year">{m.year ?? '—'}</span>
              <div className="bfc-moment-body">
                <span className={`bfc-tag bfc-tag-${m.kind}`}>{MOMENT_LABEL[m.kind]}</span>
                <span className="bfc-moment-label">{m.label}</span>
                {m.evidence.map((ev, j) => <a key={j} className="bfc-source" href={ev.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={11} />{ev.title}
                </a>)}
              </div>
            </div>)}
          </div>}
      </div>

      <div className="bfc-section">
        <h4>证据与来源</h4>
        {beef.evidence.length === 0
          ? <p className="bfc-empty"><AlertTriangle size={13} /> 暂无来源。beef 涉及真人，必须附公开可查证来源，不接受纯文字爆料。</p>
          : <div className="bfc-sources">
            {beef.evidence.map((ev, i) => <a key={i} href={ev.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={12} /><span><b>{ev.title}</b>{ev.note && <small>{ev.note}</small>}</span>
            </a>)}
          </div>}
      </div>

      {beef.note && <p className="bfc-note">{beef.note}</p>}

      <footer className="bfc-foot">
        <button className="bfc-locate" onClick={() => { const first = sides[0]; if (first) { onLocate(first.nodeId); onClose(); } }}>
          在地图中定位
        </button>
        <span>FLOWLINE · BEEF CHAIN ARCHIVE</span>
      </footer>
    </div>
  </div>;
}
