import {useState} from 'react';
import {X, AlertTriangle, Plus} from 'lucide-react';
import type {ArtistNode} from '../data/types';
import type {BeefEvent} from '../data/beefs';
import {api, useDataset} from '../state/Dataset';

/**
 * 网友补充 BEEF 表单。
 *
 * 与「添加人物 / 添加关系」走完全相同的投稿管线：
 *   POST /api/submissions (kind:'beef') → 待审队列 → 站长核实来源 → 批准后全网可见。
 * 只有投稿服务未连接时才降级为浏览器本地草稿，且明确标注「仅自己可见 / 未公开」。
 */
export function BeefSubmit({nodes, onClose, onSaveDraft}:{
  nodes: ArtistNode[];
  onClose: () => void;
  onSaveDraft: (beef: BeefEvent) => void;
}) {
  const {online} = useDataset();
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [title, setTitle] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [contributor, setContributor] = useState('');
  const [website, setWebsite] = useState(''); // 蜜罐字段：机器人会填，真人看不到
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');

  const options = [...nodes].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const buildPayload = () => ({
    sides: [sideA || sideB, sideA && sideB ? sideB : ''].filter(Boolean),
    title: title.trim(),
    sourceTitle: sourceTitle.trim() || '来源链接',
    sourceUrl: sourceUrl.trim(),
    sourceNote: '网友提供的公开来源链接，待站长核实',
    note: note.trim(),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!sideA && !sideB) { setError('至少选择一方参与人。'); return; }
    if (sideA && sideA === sideB) { setError('两方不能是同一个人。'); return; }
    if (!title.trim()) { setError('请填写事件标题。'); return; }
    if (!/^https:\/\//i.test(sourceUrl.trim())) {
      setError('必须提供 HTTPS 的公开来源链接。beef 涉及真人，不接受纯文字爆料。');
      return;
    }

    // 投稿服务没连上：降级为本地草稿，绝不伪装成「已进入审核队列」。
    if (!online) {
      const beef: BeefEvent = {
        id: `beef-draft-${Date.now()}`,
        sides: [{nodeId: sideA || sideB}, sideA && sideB ? {nodeId: sideB} : null],
        title: title.trim(),
        status: 'unverified',
        moments: [],
        evidence: [{title: sourceTitle.trim() || '来源链接', url: sourceUrl.trim()}],
        note: note.trim() || undefined,
        local: true,
      };
      onSaveDraft(beef);
      onClose();
      return;
    }

    setBusy(true);
    try {
      const result = await api<{id: string}>('/submissions', {
        kind: 'beef',
        payload: buildPayload(),
        contributor: contributor.trim() || '匿名乐迷',
        message: note.trim(),
        website,
      });
      setReceipt(result.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="beef-card-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    {receipt ? <div className="beef-submit beef-submit-done" role="status">
      <header className="bfc-head">
        <div><span className="bfc-kicker">SUBMIT / 补充线索</span><h3>已进入审核队列</h3></div>
        <button type="button" className="bfc-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </header>
      <div className="bfc-notice"><AlertTriangle size={15} />
        <p>站长核实来源后，这条 BEEF 会出现在关系网和所有访客的档案里。请留意来源链接是否可打开。</p>
      </div>
      <p className="bfm-receipt">投稿编号：{receipt}</p>
      <footer className="bfc-foot"><button type="button" className="bfc-locate" onClick={onClose}>返回地图</button></footer>
    </div> : <form className="beef-submit" onSubmit={submit} role="dialog" aria-modal="true" aria-label="补充 BEEF 线索">
      <header className="bfc-head">
        <div>
          <span className="bfc-kicker">SUBMIT / 补充线索</span>
          <h3>补充一条 BEEF</h3>
        </div>
        <button type="button" className="bfc-close" onClick={onClose} aria-label="关闭"><X size={16} /></button>
      </header>

      <div className="bfc-notice"><AlertTriangle size={15} />
        <p>{online
          ? <>提交后进入<strong>站长审核队列</strong>，核实来源后全网公开。beef 涉及真人名誉，必须附公开可查证的 HTTPS 来源，仅凭文字爆料会被退回。</>
          : <>投稿服务未连接，提交内容会存为<strong>本地草稿、仅你可见</strong>，不会进入公开数据。连上投稿服务后需重新提交才能被所有人看到。</>}
        </p>
      </div>

      <label className="bfm-field">
        <span>参与方 A *</span>
        <select value={sideA} onChange={e => setSideA(e.target.value)}>
          <option value="">选择人物 / 团队</option>
          {options.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>
      <label className="bfm-field">
        <span>参与方 B <small>（留空 = 对手待补充）</small></span>
        <select value={sideB} onChange={e => setSideB(e.target.value)}>
          <option value="">选择人物 / 团队</option>
          {options.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>
      <label className="bfm-field">
        <span>事件标题 *</span>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} placeholder="如：马思唯 vs GAI" />
      </label>
      <label className="bfm-field">
        <span>来源标题</span>
        <input value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} maxLength={120} placeholder="如：某媒体报道 / 公开采访" />
      </label>
      <label className="bfm-field">
        <span>来源链接 * <small>（HTTPS，公开可查证）</small></span>
        <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..." />
      </label>
      <label className="bfm-field">
        <span>补充说明 <small>（同时作为给站长的审核备注）</small></span>
        <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} rows={3} placeholder="其他背景或核实线索（可选）" />
      </label>
      <label className="bfm-field">
        <span>投稿昵称</span>
        <input value={contributor} onChange={e => setContributor(e.target.value)} maxLength={60} placeholder="匿名乐迷" />
      </label>
      <div className="honey" aria-hidden="true"><label>网站<input value={website} onChange={e => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" /></label></div>

      {error && <p className="bfm-error" role="alert">{error}</p>}

      <footer className="bfc-foot">
        <button type="submit" className="bfc-locate" disabled={busy}><Plus size={14} />{busy ? '正在提交…' : online ? '提交审核' : '存为本地草稿'}</button>
        <span>{online ? '审核后公开 · 所有人可见' : '仅自己可见 · 未公开'}</span>
      </footer>
    </form>}
  </div>;
}
