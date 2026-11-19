import {useEffect, useMemo, useRef, useState} from 'react';
import {ChevronDown, Download, Link2, MapPin, Plus, Route, Search, ShieldCheck, SlidersHorizontal, UserPlus, X, Zap} from 'lucide-react';
import {useDataset} from './state/Dataset';
import {RelationBoard} from './components/RelationBoard';
import {ArtistPanel} from './components/ArtistPanel';
import {Avatar} from './components/PixelAvatar';
import {CatalogPanel} from './components/CatalogPanel';
import {SubmissionEditor, ReviewPanel, Modal, type EditorTarget} from './components/Community';
import {ReportDialog, type ReportTarget} from './components/ReportDialog';
import {BeefCard} from './components/BeefCard';
import {BeefSubmit} from './components/BeefSubmit';
import {TodayHero} from './components/TodayHero';
import {ALL_PROVINCES, UNKNOWN_PROVINCE, provinceLabel, provinceOf, provinceOptions} from './lib/province';
import {artistMatches} from './lib/catalog';
import {shortestRoute} from './lib/network';
import type {RelationType} from './data/types';
import {allBeefs, loadLocalBeefs, saveLocalBeefs, type BeefEvent} from './data/beefs';

type Section = 'today' | 'map' | 'artists';

const NAV: [Section, string][] = [['today', '今日'], ['map', '地图'], ['artists', '人物']];

/**
 * 人物深链：`?p=<id>`。
 *
 * 用查询参数而不是路径，是因为站点托管在 GitHub Pages 的子路径下，
 * `/artist/xxx` 这类路径刷新会直接 404，得额外配 404.html 兜底；
 * 查询参数始终落在同一个 index.html，任何静态托管都能用。
 */
const personInUrl = () => new URLSearchParams(window.location.search).get('p');

export default function App() {
  const {data, online, checked} = useDataset();
  const writable = online || !checked;
  const {nodes, relations, works} = data;
  // 带 ?p= 进来的（分享链接 / 站内定位）直接落到关系网；普通访问先看今日首屏。
  const [section, setSection] = useState<Section>(() => personInUrl() ? 'map' : 'today');
  const [selected, setSelected] = useState<string | null>(personInUrl);
  const [query, setQuery] = useState('');
  const [province, setProvince] = useState<string>(ALL_PROVINCES);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  // 三个投稿入口收进一个下拉：内容投稿（需 API）+ 本地线索（BEEF），离线时前两项保留并说明原因。
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitNotice, setSubmitNotice] = useState(false);
  const submitRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [review, setReview] = useState(false);
  const [unlocated, setUnlocated] = useState(false);
  const [filters, setFilters] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);
  // BEEF 链：服务端公开数据（种子 + 网友投稿经审核）+ 本地离线草稿。
  const [localBeefs, setLocalBeefs] = useState<BeefEvent[]>(loadLocalBeefs);
  const [openBeef, setOpenBeef] = useState<BeefEvent | null>(null);
  const [beefSubmitOpen, setBeefSubmitOpen] = useState(false);
  const beefs = useMemo(() => allBeefs(data.beefs, localBeefs), [data.beefs, localBeefs]);
  const [types, setTypes] = useState<RelationType[]>(['member', 'collaboration', 'production', 'affiliation']);
  const [start, setStart] = useState('yitai');
  const [end, setEnd] = useState('air');
  const [path, setPath] = useState<string[] | null>(null);
  const [pathChecked, setPathChecked] = useState(false);
  const [focus, setFocus] = useState<{id: string; n: number} | null>(null);

  const provinces = useMemo(() => provinceOptions(nodes), [nodes]);
  const current = nodes.find(n => n.id === selected) || null;
  const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const pendingLocations = nodes.filter(n => provinceOf(n.city) === UNKNOWN_PROVINCE);
  const matches = query.trim() ? nodes.filter(n => artistMatches(n, query)).slice(0, 7) : [];

  // 选中谁就把谁写进地址栏。用 replaceState 而不是 pushState：浏览人物不该
  // 在历史里堆一层层「后退」，否则从别人分享的链接进来后一按后退就困在图里。
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) url.searchParams.set('p', selected);
    else url.searchParams.delete('p');
    if (url.href !== window.location.href) window.history.replaceState(null, '', url);
  }, [selected]);

  useEffect(() => {
    const onPop = () => {
      const id = personInUrl();
      setSelected(id);
      if (id) {
        setSection('map');
        setFocus(old => ({id, n: (old?.n || 0) + 1}));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 投稿下拉：点外部或 Esc 关闭；键盘也能操作，避免只在 hover 时才可用。
  useEffect(() => {
    if (!submitOpen) return;
    const outside = (event: PointerEvent) => {
      if (!submitRef.current?.contains(event.target as Node)) setSubmitOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSubmitOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onKey);
    };
  }, [submitOpen]);

  // 首屏带 ?p= 时把画布飞过去。投稿新增的人物要等接口数据回来才在 nodes 里，
  // 所以这里等 nodeById 更新而不是一次性跑完。
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current) return;
    const id = personInUrl();
    if (!id) {
      deepLinked.current = true;
      return;
    }
    if (!nodeById.has(id)) return;
    deepLinked.current = true;
    setFocus({id, n: 1});
  }, [nodeById]);

  const clearPath = () => {
    setPath(null);
    setPathChecked(false);
  };

  const pick = (id: string) => {
    setSelected(id || null);
    clearPath();
    setUnlocated(false);
    setQuery('');
    const node = nodeById.get(id);
    if (node && province !== ALL_PROVINCES && provinceOf(node.city) !== province) setProvince(ALL_PROVINCES);
  };

  /** Selecting from a list (search, catalogue, archive modal) also flies the board to that person. */
  const flyPick = (id: string) => {
    pick(id);
    setFocus(old => ({id, n: (old?.n || 0) + 1}));
  };

  const closeDetail = () => {
    setSelected(null);
    clearPath();
  };

  function exportData() {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify({version: '0.6', nodes, relations, works}, null, 2)], {type: 'application/json'}));
    link.download = 'nahfi-approved-data.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  const openSection = (next: Section) => {
    setSection(next);
    setQuery('');
  };

  const toggleType = (type: RelationType) => {
    setTypes(old => (old.includes(type) ? old.filter(item => item !== type) : [...old, type]));
    clearPath();
  };

  return <div className={`app pixel-app neon-mode ${section === 'map' ? 'board-mode' : ''}`}>
    <div className="ascii-field" aria-hidden="true" />
    <header className="site-header">
      <a href="#" className="brand" onClick={e => { e.preventDefault(); openSection('map'); }}>
        <span className="vinyl-logo" /><strong>FLOWLINE<span>®</span></strong>
      </a>
      <nav aria-label="主要导航">
        {NAV.map(([key, label]) => <button key={key} className={section === key ? 'active' : ''} onClick={() => openSection(key)}>{label}</button>)}
      </nav>
      <div className="header-actions">
        <div className="submit-menu" ref={submitRef}>
          <button className={`hbtn is-primary submit-trigger ${submitOpen ? 'is-open' : ''}`}
            onClick={() => setSubmitOpen(v => !v)} aria-haspopup="menu" aria-expanded={submitOpen} aria-label="投稿入口">
            <Plus size={15} /><span>投稿</span><ChevronDown size={13} className="submit-caret" />
          </button>
          {submitOpen && <div className="submit-pop" role="menu">
            <div className="submit-pop-head">
              <span>CONTRIBUTE / 投稿中心</span>
              <small>{writable ? '投稿服务已连接' : '浏览模式'}</small>
            </div>
            <button role="menuitem" className={`submit-item ${writable ? '' : 'is-disabled'}`}
              onClick={() => { setSubmitOpen(false); if (writable) setEditor({kind: 'artist'}); else setSubmitNotice(true); }}>
              <span className="si-icon"><UserPlus size={16} /></span>
              <span className="si-body"><b>添加人物</b><small>录入新的人物档案</small></span>
              {!writable && <em className="si-lock" title="需要连接投稿服务">离线</em>}
            </button>
            <button role="menuitem" className={`submit-item ${writable ? '' : 'is-disabled'}`}
              onClick={() => { setSubmitOpen(false); if (writable) setEditor({kind: 'relationship'}); else setSubmitNotice(true); }}>
              <span className="si-icon"><Link2 size={16} /></span>
              <span className="si-body"><b>添加关系</b><small>补充合作 / 成员 / 制作关系</small></span>
              {!writable && <em className="si-lock" title="需要连接投稿服务">离线</em>}
            </button>
            <button role="menuitem" className={`submit-item is-beef ${writable ? '' : 'is-draft'}`} onClick={() => { setSubmitOpen(false); setBeefSubmitOpen(true); }}>
              <span className="si-icon"><Zap size={16} /></span>
              <span className="si-body"><b>补充 BEEF</b><small>{writable ? '冲突线索 · 审核后公开' : '冲突线索 · 先存本地草稿'}</small></span>
              <em className="si-count">{beefs.length}</em>
            </button>
            <p className="submit-foot">
              {writable
                ? '三类投稿都经站长审核；通过后所有人可见，也会实时同步到关系网。'
                : <>当前为浏览模式：人物 / 关系投稿不可用，BEEF 只能存为本地草稿。<button onClick={() => { setSubmitOpen(false); setSubmitNotice(true); }}>为什么？</button></>}
            </p>
          </div>}
        </div>
      </div>
    </header>

    {section !== 'today' && <div className="workspace-toolbar">
      <div className="search-area">
        <Search size={17} />
        <input aria-label="搜索人物或省份" placeholder="搜索人物 / 别名" value={query} onChange={e => setQuery(e.target.value)} />
        {query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={15} /></button>}
        {query.trim() && section === 'map' && <div className="search-results">
          {matches.map(n => <button key={n.id} onClick={() => flyPick(n.id)}>
            <Avatar node={n} /><span><strong>{n.name}</strong><small>{provinceLabel(provinceOf(n.city))}</small></span>
          </button>)}
          {!matches.length && <p>没有找到相关人物。</p>}
        </div>}
      </div>
      <label className="city-filter">
        <MapPin size={16} />
        <select aria-label="省份聚落" value={province} onChange={e => { setProvince(e.target.value); clearPath(); }}>
          {[ALL_PROVINCES, ...provinces].map(p => <option key={p} value={p}>{p === ALL_PROVINCES ? p : provinceLabel(p)}</option>)}
        </select>
      </label>
      <button onClick={() => setFilters(!filters)} aria-expanded={filters}><SlidersHorizontal size={16} /><span>关系筛选</span></button>
      <button onClick={() => setPathOpen(true)}><Route size={16} /><span>寻找路径</span></button>
    </div>}

    {filters && section !== 'today' && <div className="filter-strip">
      {Object.entries({member: '组合成员', collaboration: '歌曲合作', production: '幕后制作', affiliation: '历史关联'}).map(([key, label]) =>
        <label key={key}>
          <input type="checkbox" checked={types.includes(key as RelationType)} onChange={() => toggleType(key as RelationType)} />
          {label}<small>{relations.filter(r => r.type === key).length}</small>
        </label>)}
    </div>}

    <main className={`explorer ${section === 'today' ? 'is-today' : section === 'map' ? 'is-board' : 'is-catalog'}`}>
      <section className="explore-main">
        {section === 'today'
          ? <TodayHero onLocate={id => { flyPick(id); setSection('map'); }} />
          : section === 'map'
          ? <div className="map-room">
            <RelationBoard selected={selected} onSelect={pick} onClear={closeDetail} types={types} province={province}
              path={path} focus={focus} onToggleType={toggleType} onLocate={() => setUnlocated(true)}
              onResetProvince={() => { setProvince(ALL_PROVINCES); clearPath(); }}
              beefs={beefs} onOpenBeef={setOpenBeef} />
            {path && <div className="path-banner board-path">
              找到 {path.length - 1} 步路径：{path.map((id, i) => <span key={id}>{i > 0 ? ' → ' : ''}<button onClick={() => setSelected(id)}>{nodeById.get(id)?.name}</button></span>)}
              <button aria-label="清除路径" onClick={() => setPath(null)}>×</button>
            </div>}
            {current && <div className="board-drawer">
              <ArtistPanel current={current} works={works} relations={relations} nodeById={nodeById} types={types}
                canContribute={writable}
                onPick={pick} onEdit={node => setEditor({kind: 'artist', record: node})}
                onReport={setReport}
                onContribute={() => setEditor({kind: 'relationship', source: current.id})} onClose={closeDetail} />
            </div>}
          </div>
          : <CatalogPanel query={query} onQuery={setQuery}
            onPick={id => { flyPick(id); setSection('map'); }} province={province} />}
      </section>
    </main>

    <footer className="site-footer">
      <span><i className={online ? 'online' : 'offline'} /> {online ? '投稿服务已连接' : '浏览模式 · 投稿服务未连接'} <span className="footer-divider">/</span> 像素头像为占位示意</span>
      <div>
        <button onClick={exportData}><Download size={13} />导出公开数据</button>
        {writable && <button onClick={() => setReview(true)}><ShieldCheck size={14} />站长审核</button>}
      </div>
    </footer>

    {editor && <SubmissionEditor target={editor} onClose={() => setEditor(null)} />}
    {report && <ReportDialog target={report} onClose={() => setReport(null)} />}
    {review && <ReviewPanel onClose={() => setReview(false)} />}
    {openBeef && <BeefCard beef={openBeef} nodeById={nodeById}
      onClose={() => setOpenBeef(null)} onPick={flyPick}
      onLocate={flyPick} />}
    {beefSubmitOpen && <BeefSubmit nodes={nodes} onClose={() => setBeefSubmitOpen(false)}
      onSaveDraft={beef => setLocalBeefs(old => { const next = [...old, beef]; saveLocalBeefs(next); return next; })} />}
    {submitNotice && <Modal title="为什么投稿不可用" onClose={() => setSubmitNotice(false)}>
      <p className="form-intro">三类投稿都会提交到投稿服务，经站长核实来源后才能进入公开数据——这是网友共同补全关系网、又不让不实内容污染网站的方式。当前页面是静态浏览模式，没有连接投稿 API。</p>
      <p className="field-help">本地开发运行 <code>npm run dev</code> 即可启用；线上站点需要站长在仓库 Variables 里配置 <code>VITE_API_BASE</code> 指向投稿 Worker。没连上时，BEEF 可先存为本地草稿，但只有你能看到，需要联网后重新提交。</p>
    </Modal>}
    {unlocated && <Modal title="地域待考据" onClose={() => setUnlocated(false)}>
      <p className="form-intro">这些人物已收录，但还没有可核验的省份来源。他们暂时停留在“待考据之岛”，补充有来源的地域信息后会自动归入对应聚落。</p>
      <div className="unlocated-grid">{pendingLocations.map(n => <button key={n.id} onClick={() => flyPick(n.id)}>
        <Avatar node={n} /><span><b>{n.name}</b><small>{n.city}</small></span>
      </button>)}</div>
    </Modal>}
    {pathOpen && <Modal title="寻找人物之间的关系路径" onClose={() => setPathOpen(false)}>
      <div className="path-form">
        <p>按当前关系类型筛选，使用全部已公开记录查找路径。</p>
        <label>起点人物<select value={start} onChange={e => { setStart(e.target.value); setPathChecked(false); }}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <label>终点人物<select value={end} onChange={e => { setEnd(e.target.value); setPathChecked(false); }}>{nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <button className="primary" onClick={() => {
          const result = shortestRoute(start, end, types, []);
          setPath(result);
          setPathChecked(true);
          if (result) {
            setSection('map');
            setSelected(start);
            setProvince(ALL_PROVINCES);
            setPathOpen(false);
          }
        }}>查找关系路径 →</button>
        {pathChecked && !path && <p role="status">当前资料与筛选条件下没有找到路径。</p>}
        <p className="field-help">路径可能包含组合成员或历史关联，不代表双方直接合作。</p>
      </div>
    </Modal>}
  </div>;
}
