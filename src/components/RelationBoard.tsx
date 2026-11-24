import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import panzoom, {type PanZoom, type Transform} from 'panzoom';
import {LayoutGrid, RotateCcw, Search, Sparkles, Users, X} from 'lucide-react';
import {useDatasetData} from '../state/Dataset';
import {Avatar} from './PixelAvatar';
import {ALL_PROVINCES, PROVINCE_NAMES, UNKNOWN_PROVINCE, provinceLabel, provinceOf} from '../lib/province';
import {boardLayout, buildEdges, edgeMid, edgePath, beefPath, relationMeta, type NodePlace} from '../lib/board';
import type {RelationType} from '../data/types';
import type {BeefEvent} from '../data/beefs';
import {beefNodeIds} from '../data/beefs';

const YEARS = Array.from({length: 10}, (_, index) => 2017 + index);

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3;

/** Ambient dust for the canvas backdrop. Deterministic so renders never reshuffle it. */
const SPARKS = Array.from({length: 18}, (_, index) => ({
  x: (index * 37 + 11) % 100,
  y: (index * 61 + 17) % 100,
  delay: -((index * 1.9) % 15),
  duration: 12 + (index % 6) * 2.4,
  size: index % 4 === 0 ? 2.5 : 1.6,
}));

interface RosterState {
  province: string;
  x: number;
  y: number;
  h: number;
}

export function RelationBoard({selected, onSelect, onClear, types, province, path, focus, onToggleType, onLocate, onResetProvince, beefs, onOpenBeef}: {
  selected: string | null;
  onSelect: (id: string) => void;
  /** A click on empty canvas closes the detail drawer. */
  onClear: () => void;
  types: RelationType[];
  province: string;
  path: string[] | null;
  /** Set by the page when the user picks someone from search / catalogue — the board flies over. */
  focus: {id: string; n: number} | null;
  onToggleType: (type: RelationType) => void;
  onLocate: () => void;
  onResetProvince: () => void;
  /** BEEF 链事件：作为关系网的一种边渲染，与普通关系共用聚焦逻辑。 */
  beefs: BeefEvent[];
  onOpenBeef: (beef: BeefEvent) => void;
}) {
  const data = useDatasetData();
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  /** panzoom 实例：平移/缩放直接写 DOM transform，不触发 React 重渲染——这是拖动丝滑的关键。 */
  const pz = useRef<PanZoom | null>(null);
  /** 当前 transform 的镜像，供省份框拖拽 / flyTo 读取（panzoom 自身才是唯一数据源）。 */
  const viewRef = useRef({scale: 0.8, x: 0, y: 0});
  const [hover, setHover] = useState<string | null>(null);
  /** 省份框 hover：驱动整块省份的弹性抬升与无关省份降噪（hover 单个人物走上面的 hover）。 */
  const [hoverProvince, setHoverProvince] = useState<string | null>(null);
  const [pinnedProvince, setPinnedProvince] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set([...PROVINCE_NAMES, UNKNOWN_PROVINCE]));
  const activeProvince = pinnedProvince || hoverProvince;
  const [year, setYear] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 跨过缩放阈值时才更新，避免 pan 过程中反复重渲染整棵节点树。 */
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const dragProvince: string | null = null;
  /**
   * 省份框内滚动：滚轮只写一个 track 元素的 translate3d，React 完全不参与。
   * 当前值向目标值做插值，rAF 合帧 → GPU 合成层，密集省份也能保持高帧率。
   */
  const peekScroll = useRef({host: null as HTMLElement | null, track: null as HTMLElement | null, current: 0, target: 0, max: 0, raf: 0});
  const touchY = useRef<number | null>(null);
  const scrollTick = () => {
    const s = peekScroll.current;
    if (!s.track) { s.raf = 0; return; }
    const delta = s.target - s.current;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || Math.abs(delta) < 0.4) { s.current = s.target; s.raf = 0; }
    else { s.current += delta * 0.26; s.raf = requestAnimationFrame(scrollTick); }
    s.track.style.transform = `translate3d(0,${-s.current.toFixed(2)}px,0)`;
  };
  const beginPeekScroll = (host: HTMLElement, delta: number) => {
    const s = peekScroll.current;
    if (s.host !== host) {
      s.host = host;
      s.track = host.querySelector<HTMLElement>('.peek-track');
      s.current = 0; s.target = 0;
      s.max = Math.max(0, (s.track?.offsetHeight || 0) - host.clientHeight);
    }
    s.target = Math.max(0, Math.min(s.max, s.target + delta));
    if (!s.raf) s.raf = requestAnimationFrame(scrollTick);
  };
  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    // capture 阶段先于 panzoom 的滚轮缩放：落在预览框内就拦截，框外照常缩放地图。
    const onWheel = (event: WheelEvent) => {
      const host = (event.target as HTMLElement | null)?.closest<HTMLElement>('.zone-nodes.is-peek');
      if (!host) return;
      event.preventDefault();
      event.stopPropagation();
      beginPeekScroll(host, event.deltaY);
    };
    const onTouchStart = (event: TouchEvent) => {
      const host = (event.target as HTMLElement | null)?.closest<HTMLElement>('.zone-nodes.is-peek');
      touchY.current = host && event.touches[0] ? event.touches[0].clientY : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchY.current === null || !event.touches[0]) return;
      const host = (event.target as HTMLElement | null)?.closest<HTMLElement>('.zone-nodes.is-peek');
      if (!host) return;
      const y = event.touches[0].clientY;
      const delta = (touchY.current - y) * 1.5;
      touchY.current = y;
      event.preventDefault();
      beginPeekScroll(host, delta);
    };
    surface.addEventListener('wheel', onWheel, {passive: false, capture: true});
    surface.addEventListener('touchstart', onTouchStart, {passive: true, capture: true});
    surface.addEventListener('touchmove', onTouchMove, {passive: false, capture: true});
    return () => {
      surface.removeEventListener('wheel', onWheel, true);
      surface.removeEventListener('touchstart', onTouchStart, true);
      surface.removeEventListener('touchmove', onTouchMove, true);
    };
  }, []);
  // 切换省份时复位上一个框的滚动位置。
  useEffect(() => {
    const s = peekScroll.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.track) s.track.style.transform = '';
    s.host = null; s.track = null; s.current = 0; s.target = 0; s.max = 0; s.raf = 0;
    touchY.current = null;
  }, [activeProvince]);
  const [roster, setRoster] = useState<RosterState | null>(null);
  const [regionView, setRegionView] = useState<string | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 780);
  /** 当前焦点：悬停或选中。普通关系线与 BEEF 边共用这一个变量，行为完全一致。 */
  const focusId = selected;

  // Search / related-person links reveal an artist even if their region was collapsed.
  useEffect(() => {
    const node = data.nodes.find(node => node.id === selected || (!selected && node.id === focus?.id));
    if (!node) return;
    const ids = new Set([node.id]);
    for(const relation of data.relations) { if(relation.source===node.id) ids.add(relation.target); if(relation.target===node.id) ids.add(relation.source); }
    const regions = new Set(data.nodes.filter(person=>ids.has(person.id)).map(person=>provinceOf(person.city)));
    setCollapsed(old => { if(![...regions].some(region=>old.has(region)))return old; const next=new Set(old); for(const region of regions)next.delete(region); return next; });
  }, [selected, focus?.id, focus?.n, data.nodes]);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  /* ── panzoom：接管画布平移/缩放 ────────────────────────────────────────
     事件监听绑在 viewport，transform 写到 stage（两层分离，靠自定义 controller）。
     关键收益：拖拽/滚轮/惯性全部由库直接改 DOM matrix，React 零重渲染。
     .bn 节点 / .bz 省份框 / .roster 名单上的按下被 beforeMouseDown 拦下，
     继续走它们各自的 pointer 拖拽逻辑，不会被画布 pan 抢走。 */
  useEffect(() => {
    const surface = viewport.current;
    const layer = stage.current;
    if (!surface || !layer) return;
    const instance = panzoom(layer, {
      controller: {
        getOwner: () => surface,
        applyTransform: (t: Transform) => {
          layer.style.transform = `translate3d(${t.x}px,${t.y}px,0) scale(${t.scale})`;
        },
      } as never,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      zoomDoubleClickSpeed: 1,          // 关闭双击缩放（点击节点要聚焦，不是放大）
      disableKeyboardInteraction: true, // 方向键留给页面，不劫持
      zoomSpeed: 0.12,                  // 滚轮缩放更跟手
      // 松手后的惯性：kinetic 只认 minVelocity / amplitude（@types 仅声明 boolean，故断言）。
      // minVelocity=5 只让明显的甩动触发；amplitude=0.14 让滑行短促顺滑、收得住。
      smoothScroll: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : {minVelocity: 8, amplitude: 0.18} as never,
      beforeMouseDown: (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return false;
        // 交互元素：节点、省份框、名单、控件——不启动画布 pan。
        const interactive = target.closest('.bn, .roster, .board-rail, .board-timeline, .board-zoom, .board-title, button');
        return !!interactive;
      },
      onTouch: (e: TouchEvent) => {
        const target = e.target as HTMLElement | null;
        // 触摸同样放过交互元素，让原生 click / 拖拽生效。
        return !(target && target.closest('.bn, .roster, button'));
      },
    });
    pz.current = instance;

    const syncTransform = () => {
      const t = instance.getTransform();
      viewRef.current = t;
      // 背景视差直接写 CSS 变量，避免 setView 触发整棵树重渲染。
      if (bg.current) {
        bg.current.style.setProperty('--px', `${(t.x * 0.08).toFixed(1)}px`);
        bg.current.style.setProperty('--py', `${(t.y * 0.08).toFixed(1)}px`);
      }
      // 只有跨过缩放阈值才 setState，避免 pan 过程中反复重渲染。
      const z = t.scale >= 1.22;
      if (z !== zoomedRef.current) { zoomedRef.current = z; setZoomed(z); }
    };
    instance.on('transform', syncTransform);
    instance.on('panstart', () => setDragging(true));
    instance.on('panend', () => setDragging(false));

    return () => {
      instance.dispose();
      pz.current = null;
    };
  }, []);

  const degree = useMemo(() => {
    const map = new Map<string, number>();
    for (const relation of data.relations) {
      if (!types.includes(relation.type)) continue;
      map.set(relation.source, (map.get(relation.source) || 0) + 1);
      map.set(relation.target, (map.get(relation.target) || 0) + 1);
    }
    return map;
  }, [data.relations, types]);

  const base = useMemo(() => {
    const located = data.nodes.filter(node => province === ALL_PROVINCES || provinceOf(node.city) === province);
    // 完整展示：地域待考据的每一个人都上画板，不再按关系数截取前 12 个。
    // 框面积与世界尺寸由 boardLayout 按实际人数计算。
    return boardLayout(located, province, narrow, collapsed, activeProvince);
  }, [data.nodes, province, narrow, collapsed, activeProvince]);

  const {zones, positions, world} = base;

  // 悬停预览会把该省人物在框内纵向铺开（临时坐标），关系线若跟着连过去会拉成长扇形。
  // 建线时把该省所有端点收敛到框的顶部锚点，线就汇聚成从省份框射出的星爆。
  const edgePositions = useMemo(() => {
    if (!activeProvince || !collapsed.has(activeProvince)) return positions;
    const zone = zones.find(item => item.def.province === activeProvince);
    if (!zone || zone.count <= 6) return positions;
    const ax = zone.def.x + zone.def.w / 2;
    const ay = zone.def.y + 70;
    const next = new Map(positions);
    for (const [id, place] of positions) {
      if (place.province === activeProvince) next.set(id, {...place, x: ax, y: ay});
    }
    return next;
  }, [positions, activeProvince, collapsed, zones]);
  const allEdges = useMemo(
    () => buildEdges(data, types, province, year, edgePositions),
    [data, types, province, year, edgePositions],
  );
  // 默认态：只留跨省、合作次数 top20 的线作暗纹。省内线不画，避免格子内部糊成一团。
  const ambientEdges = useMemo(() => allEdges
    .filter(edge => positions.get(edge.source)?.province !== positions.get(edge.target)?.province)
    .sort((a, b) => b.count - a.count).slice(0, 20), [allEdges, positions]);
  const edges = useMemo(() => {
    if (!selected) return ambientEdges;
    const merged = new Map(ambientEdges.map(edge => [edge.id, edge]));
    for (const edge of allEdges) if (edge.source === selected || edge.target === selected) merged.set(edge.id, edge);
    return [...merged.values()];
  }, [ambientEdges, allEdges, selected]);

  /**
   * BEEF 是关系网的一种边，跟普通关系线共用聚焦逻辑：
   * 悬停/选中某人时，亮出与他相关的冲突链；无焦点时不显示。
   * 不再有独立的 BEEF 图层开关，也不再是「单独的一个显示层」。
   */
  const shownBeefs = useMemo(() => {
    if (!focusId) return [];
    return beefs.filter(beef => beef.sides.some(side => side && side.nodeId === focusId));
  }, [beefs, focusId]);

  /** BEEF 链几何：只有双方都在当前面板/筛选内的事件才画。 */
  const beefLinks = useMemo(() => {
    const result: {beef: BeefEvent; d: string; mid: {x: number; y: number}; anchor: {x: number; y: number}; ax: number; ay: number; bx: number; by: number; nearA: {x: number; y: number}; nearB: {x: number; y: number}}[] = [];
    for (const beef of shownBeefs) {
      const a = beef.sides[0] ? positions.get(beef.sides[0].nodeId) : null;
      const b = beef.sides[1] ? positions.get(beef.sides[1].nodeId) : null;
      if (!a || !b) continue;
      // 弯曲控制点：中点沿垂线偏移，让双方锯齿线不与普通直线重合
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(40, len * 0.12);
      const ux = dx / len, uy = dy / len;
      const c = {x: mx - uy * bow, y: my + ux * bow};
      // 端点标记从头像边缘起笔，避免被头像盖住
      const nearA = {x: a.x + ux * 26, y: a.y + uy * 26};
      const nearB = {x: b.x - ux * 26, y: b.y - uy * 26};
      // 小标签沿法线轻微外移，避免压在线身上；尺度与普通关系线标签一致。
      const nx = -uy, ny = ux;
      const anchor = {x: (nearA.x + 2 * c.x + nearB.x) / 4, y: (nearA.y + 2 * c.y + nearB.y) / 4};
      result.push({
        beef,
        d: beefPath(nearA, nearB, c),
        mid: {x: anchor.x + nx * 17, y: anchor.y + ny * 17}, anchor,
        ax: a.x, ay: a.y, bx: b.x, by: b.y, nearA, nearB,
      });
    }
    return result;
  }, [shownBeefs, positions]);

  // 节点角标也随显隐走：默认不给人任何「这里有 beef」的暗示，选中/总开关才亮。
  const beefIds = useMemo(() => beefNodeIds(shownBeefs), [shownBeefs]);
  const archiveTotal = useMemo(
    () => data.nodes.filter(node => provinceOf(node.city) === UNKNOWN_PROVINCE).length,
    [data.nodes],
  );

  /** Union of the designed canvas and any zone the user dragged outside it. */
  const bounds = useMemo(() => {
    let minX = 0, minY = 0, maxX = world.width, maxY = world.height;
    for (const zone of zones) {
      minX = Math.min(minX, zone.def.x);
      minY = Math.min(minY, zone.def.y);
      maxX = Math.max(maxX, zone.def.x + zone.def.w);
      maxY = Math.max(maxY, zone.def.y + zone.def.h);
    }
    for (const place of positions.values()) {
      minX = Math.min(minX, place.x - place.size / 2 - 62);
      maxX = Math.max(maxX, place.x + place.size / 2 + 62);
      maxY = Math.max(maxY, place.y + place.size / 2 + 26);
    }
    return {x: minX, y: minY, w: maxX - minX, h: maxY - minY};
  }, [zones, positions, world]);

  /** Latest bounds, read by fit() without making it a new function on every layout change. */
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const mapCenterRef = useRef({x:0,y:0});
  const centralRegion = zones.find(zone=>zone.def.province==='湖北')?.def;
  mapCenterRef.current = centralRegion ? {x:centralRegion.x+centralRegion.w/2,y:centralRegion.y+centralRegion.h/2} : {x:world.width/2,y:world.height/2};

  const clampScale = useCallback((value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value)), []);

  /** 唯一的 transform 出口：所有程序化视图变更都经 panzoom，DOM transform 由它直接写。 */
  const applyView = useCallback((scale: number, x: number, y: number) => {
    const instance = pz.current;
    if (!instance) return;
    instance.zoomAbs(0, 0, clampScale(scale));   // 先定比例（锚在原点，x/y 随后覆盖）
    instance.moveTo(x, y);                        // 再精确平移，得到目标 transform
  }, [clampScale]);

  const fit = useCallback(() => {
    const element = viewport.current;
    if (!element || !pz.current) return;
    const rect = element.getBoundingClientRect();
    const box = boundsRef.current;
    // Phones stack the provinces vertically: fit the width and let the user pan down,
    // otherwise the whole list is squeezed into an unreadable thumbnail.
    if (narrow && province !== ALL_PROVINCES) {
      const scale = Math.min(1, (rect.width - 20) / box.w);
      applyView(scale, (rect.width - box.w * scale) / 2 - box.x * scale, 42 - box.y * scale);
      return;
    }
    // Phones start at a readable regional scale; pan and province search cover the country.
    if(narrow && province===ALL_PROVINCES){
      const scale=.68;
      applyView(scale,rect.width/2-mapCenterRef.current.x*scale,rect.height/2-mapCenterRef.current.y*scale);
      return;
    }
    // Leave room for the compact year strip pinned to the bottom edge.
    const left = narrow ? 14 : 88;
    const usableW = rect.width-left-20, usableH=Math.max(180,rect.height-140);
    const scale=Math.min(1.2,usableW/box.w,usableH/box.h);
    applyView(scale,left+(usableW-box.w*scale)/2-box.x*scale,70+(usableH-box.h*scale)/2-box.y*scale);
  }, [narrow, province, applyView]);

  useEffect(() => {
    if(!regionView)return;
    const region=zones.find(zone=>zone.def.province===regionView)?.def;
    const frame=viewport.current?.getBoundingClientRect();
    if(!region || !frame)return;
    if(region.collapsed)fit();
    else {
      const scale=Math.min(1.3,(frame.width-36)/region.w,(frame.height-140)/region.h);
      applyView(scale,frame.width/2-(region.x+region.w/2)*scale,70+(frame.height-140)/2-(region.y+region.h/2)*scale);
    }
    setRegionView(null);
  },[regionView,zones,fit,applyView]);

  // Fit once (and on a real viewport resize). Selecting someone must NOT reset the zoom:
  // the previous dependency on `bounds` re-ran this on every selection.
  useEffect(() => {
    fit();
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit]);

  // Changing the province filter is the one selection-like action that should reframe.
  const provinceRef = useRef(province);
  useEffect(() => {
    if (provinceRef.current === province) return;
    provinceRef.current = province;
    setPinnedProvince(null);
    if(province!==ALL_PROVINCES){
      setCollapsed(old=>{const next=new Set(old);next.delete(province);return next;});
      setRegionView(province);
    }
    fit();
  }, [province, fit]);

  /** Zoom around a screen-space anchor so the point under the cursor stays put. */
  const zoomAround = useCallback((px: number, py: number, factor: number) => {
    const instance = pz.current;
    if (!instance) return;
    instance.smoothZoom(px, py, factor);
  }, []);

  /* ── 空白点击关闭详情 ─────────────────────────────────────────────────
     panzoom 已经接管滚轮缩放与画布拖拽（含松手惯性）。这里只补一个"点空白关抽屉"，
     用原生 pointer 监听：不调 preventDefault、不拦 panzoom 的 mousedown。 */
  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    let sx = 0, sy = 0, blank = false;
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      blank = !!target && !target.closest('.bn, .roster, button');
      sx = e.clientX; sy = e.clientY;
      if (blank) setRoster(null);
    };
    const up = (e: PointerEvent) => {
      if (blank && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) { onClearRef.current(); setPinnedProvince(null); }
      if (Math.hypot(e.clientX-sx,e.clientY-sy)>=5) { suppressClick.current=true; setTimeout(()=>{suppressClick.current=false;},0); }
      blank = false;
    };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointerup', up);
    return () => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerup', up);
    };
  }, []);

  // A finished canvas drag must not also open the region under the pointer.
  const suppressClick = useRef(false);

  const openRoster = (provinceName: string, zoneEl: HTMLElement | null) => {
    setPinnedProvince(provinceName);
    const frame = viewport.current?.getBoundingClientRect();
    const rect = zoneEl?.getBoundingClientRect();
    if (!frame || !rect) return;
    if (roster?.province === provinceName) {
      setRoster(null);
      return;
    }
    const width = Math.min(268, frame.width - 24);
    // The timeline strip owns the bottom ~80px — keep the list out of it.
    const bottomLimit = frame.height - 82;
    const below = Math.max(0, bottomLimit - (rect.bottom - frame.top + 6));
    const above = Math.max(0, rect.top - frame.top - 14);
    const height = Math.max(160, Math.min(320, Math.max(below, above)));
    let y = below >= above ? rect.bottom - frame.top + 6 : rect.top - frame.top - 6 - height;
    y = Math.max(8, Math.min(y, bottomLimit - height));
    setRosterQuery('');
    setRoster({
      province: provinceName,
      x: Math.max(8, Math.min(rect.left - frame.left, frame.width - width - 8)),
      y,
      h: height,
    });
  };

  const resetArrangement = () => {
    onClearRef.current();
    setCollapsed(new Set([...PROVINCE_NAMES, UNKNOWN_PROVINCE]));
    setRoster(null); setPinnedProvince(null);
    requestAnimationFrame(fit);
  };

  /* ── fly to a node (search results, roster entries, path hops) ──────────
     飞入也走 panzoom：rAF 里直接调 zoomAbs/moveTo 写 DOM，不触发 React 重渲染。 */
  const animation = useRef<number | null>(null);
  const flyTo = useCallback((id: string) => {
    const place = positions.get(id);
    const element = viewport.current;
    const instance = pz.current;
    if (!place || !element || !instance) return;
    const rect = element.getBoundingClientRect();
    const start = instance.getTransform();
    const scale = Math.max(start.scale, 1.15);
    const target = {
      scale,
      x: (rect.width > 700 ? (rect.width-380)/2 : rect.width/2) - place.x * scale,
      y: rect.height / 2 - place.y * scale,
    };
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    const begin = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - begin) / 420);
      const ease = 1 - Math.pow(1 - k, 3);
      instance.zoomAbs(0, 0, start.scale + (target.scale - start.scale) * ease);
      instance.moveTo(start.x + (target.x - start.x) * ease, start.y + (target.y - start.y) * ease);
      animation.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, [positions]);

  useEffect(() => () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
  }, []);

  useEffect(() => {
    if(!selected || positions.get(selected)?.size===0)return;
    const frame=requestAnimationFrame(()=>flyTo(selected));
    return ()=>cancelAnimationFrame(frame);
  },[selected,positions,flyTo]);

  const focusNonce = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === focusNonce.current || collapsed.has(positions.get(focus.id)?.province || '')) return;
    focusNonce.current = focus.n;
    const frame = requestAnimationFrame(() => flyTo(focus.id));
    return () => cancelAnimationFrame(frame);
  }, [focus, positions, flyTo, collapsed]);

  const pathPairs = useMemo(() => {
    const pairs = new Set<string>();
    if (!path) return pairs;
    path.forEach((id, index) => {
      if (index < path.length - 1) pairs.add([id, path[index + 1]].sort().join('|'));
    });
    return pairs;
  }, [path]);

  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focusId) return set;
    edges.forEach(edge => {
      if (edge.source === focusId) set.add(edge.target);
      if (edge.target === focusId) set.add(edge.source);
    });
    // BEEF 也是关系：聚焦某人时，他的冲突对手同样算邻居，不被 dim。
    shownBeefs.forEach(beef => beef.sides.forEach(side => {
      if (side && side.nodeId !== focusId) set.add(side.nodeId);
    }));
    return set;
  }, [edges, focusId, shownBeefs]);

  /**
   * 省份 hover 的降噪集合：本省 + 当前筛选/年份下有连线直达的省份。
   * 基于 edges 而非全量 relations，所以「有连线」始终指画面上看得见的连线。
   */
  const zoneFocus = useMemo<Set<string> | null>(() => {
    if (!activeProvince) return null;
    const set = new Set<string>([activeProvince]);
    for (const edge of allEdges) {
      const a = positions.get(edge.source)?.province;
      const b = positions.get(edge.target)?.province;
      if (a === activeProvince && b) set.add(b);
      if (b === activeProvince && a) set.add(a);
    }
    return set;
  }, [activeProvince, allEdges, positions]);

  const isFocusEdge = (edge: {source: string; target: string}) =>
    !!focusId && (edge.source === focusId || edge.target === focusId);

  const isPathEdge = (edge: {source: string; target: string}) =>
    pathPairs.has([edge.source, edge.target].sort().join('|'));

  const labelled = useMemo(() => {
    const ids = new Set<string>();
    const ranked = [...edges].sort((a, b) => b.count - a.count);
    for (const edge of ranked) {
      if (isFocusEdge(edge) && isPathEdge(edge)) ids.add(edge.id);
      else if (isFocusEdge(edge) && edge.count >= 3) ids.add(edge.id);
      else if (!focusId && ids.size < 4 && edge.count >= 4) ids.add(edge.id);
      if (ids.size >= 7) break;
    }
    return ids;
  }, [edges, focusId, path]);

  const hotEdges = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set(edges.filter(edge => edge.source === focusId || edge.target === focusId)
      .sort((a, b) => b.count - a.count).slice(0, 10).map(edge => edge.id));
  }, [edges, focusId]);

  const visibleNodes = useMemo(() => data.nodes.filter(node => positions.has(node.id) && positions.get(node.id)!.size > 0), [data.nodes, positions, collapsed]);
  const locatedCount = useMemo(() => data.nodes.reduce((sum, node) => sum + (provinceOf(node.city) !== UNKNOWN_PROVINCE ? 1 : 0), 0), [data.nodes]);

  /* ── roster: every artist inside one province, searchable ─────────────── */
  const rosterRows = useMemo(() => {
    if (!roster) return [];
    const needle = rosterQuery.trim().toLowerCase();
    return data.nodes
      .filter(node => provinceOf(node.city) === roster.province)
      .filter(node => !needle || node.name.toLowerCase().includes(needle) || (node.aliases || []).some(alias => alias.toLowerCase().includes(needle)))
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh'));
  }, [roster, rosterQuery, data.nodes, degree]);

  return <div className={`board ${focusId ? 'has-focus' : ''}`}>
    <div className={`board-viewport ${dragging ? 'dragging' : ''} ${dragProvince ? 'zone-dragging' : ''}`} ref={viewport}>
      {/* Ambient backdrop: drifts slower than the board so the canvas gets depth.
          视差偏移由 panzoom 的 transform 事件直接写 CSS 变量，不经过 React。 */}
      <div className={`board-bg ${selected ? 'is-soft' : ''}`} aria-hidden="true" ref={bg}>
        <div className="bg-par">
          <div className="bg-depth-plane" />
          <div className="bg-aurora"><i /><i /><i /></div>
          <div className="bg-lines"><i /></div>
          <div className="bg-traces"><i /><i /><i /><i /><i /></div>
          <div className="bg-radar" />
          <div className="bg-radar alt" />
          <div className="bg-sweep" />
          <div className="bg-sparks">
            {SPARKS.map((spark, index) => <i key={index}
              style={{left: `${spark.x}%`, top: `${spark.y}%`, width: spark.size, height: spark.size,
                animationDelay: `${spark.delay}s`, animationDuration: `${spark.duration}s`}} />)}
          </div>
        </div>
      </div>
      <div className="board-stage" ref={stage}>
        <div className={`board-world ${zoomed ? 'is-zoomed' : ''}`}
          style={{width: world.width, height: world.height}}>
          {zones.map(zone => {
            // 折叠省被悬停：框尺寸不变，框内铺开全部人物并可滚轮浏览。
            const peeking = !!activeProvince && activeProvince === zone.def.province && collapsed.has(zone.def.province) && zone.count > 6;
            const members = visibleNodes.filter(node => positions.get(node.id)!.province === zone.def.province);
            return <div key={zone.def.province} data-province={zone.def.province}
            tabIndex={0} role="group" aria-label={`${provinceLabel(zone.def.province)}，${zone.count} 人，按回车查看名单`}
            onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openRoster(zone.def.province, event.currentTarget); } }}
            className={`bz ${zone.def.mini ? 'mini' : ''} ${zone.def.empty ? 'empty' : ''} ${zone.def.tiny ? 'tiny' : ''} ${dragProvince === zone.def.province ? 'is-dragging' : ''} ${hoverProvince === zone.def.province ? 'is-zone-lit' : ''} ${pinnedProvince === zone.def.province ? 'is-zone-selected' : ''} ${zone.def.collapsed ? 'is-collapsed' : ''} ${peeking ? 'is-peeking' : ''} ${zoneFocus && !zoneFocus.has(zone.def.province) ? 'is-zone-dim' : ''}`}
            style={{left: zone.def.x, top: zone.def.y, width: zone.def.w, height: zone.def.h, borderRadius: zone.def.radius ?? 10, ['--c' as string]: zone.def.color, zIndex: dragProvince === zone.def.province || activeProvince === zone.def.province ? 4 : undefined}}
            // 只在鼠标设备触发：触屏点完没有 leave，省份高亮会一直卡住。
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHoverProvince(zone.def.province); }}
            onPointerLeave={event => { if (event.pointerType === 'mouse') setHoverProvince(null); }}
            onClick={event => { if (!suppressClick.current && !(event.target as HTMLElement).closest('button')) openRoster(zone.def.province,event.currentTarget); }}>
            <div className="bz-tag" title="点击查看省份人物名单">
              {zone.def.tiny && !zone.def.mini
                ? <em className="only-name">{provinceLabel(zone.def.province)}</em>
                : <><b>{zone.def.code}</b><em>{provinceLabel(zone.def.province)}</em></>}
              <i>{zone.def.mini ? `${zone.count}/${archiveTotal}` : zone.def.empty ? '' : zone.count}</i>
              {zone.count > 3 && <button className="zone-collapse" aria-expanded={!zone.def.collapsed}
                aria-label={`${zone.def.collapsed ? '展开' : '收起'}${provinceLabel(zone.def.province)}`}
                onClick={event => { event.stopPropagation(); setCollapsed(old => { const next = new Set(old); if(next.has(zone.def.province)) next.delete(zone.def.province); else next.add(zone.def.province); return next; }); setRegionView(zone.def.province); setRoster(null); }}>
                {zone.def.collapsed ? `展开全部` : '收起'}</button>}
              {zone.def.mini ? <button onClick={onLocate}>全部 →</button>
                : <button className="roster-open" onClick={event => {
                  event.stopPropagation();
                  openRoster(zone.def.province, event.currentTarget.closest('.bz') as HTMLElement | null);
                }} aria-expanded={roster?.province === zone.def.province} aria-label={`展开 ${provinceLabel(zone.def.province)} 名单`}>名单</button>}
            </div>
            {peeking && <div className="peek-hint" aria-hidden="true">滚轮浏览全部 {zone.count} 人<i /></div>}
            <div className={`zone-nodes ${peeking ? 'is-peek' : ''}`}>
             <div className="peek-track" style={peeking ? {height: 82 + Math.ceil(zone.count / 3) * 76 + 12} : undefined}>
              {members.map(node => {
                const place = positions.get(node.id)!;
                const active = node.id === selected;
                const inBeef = beefIds.has(node.id);
                const dim = !!focusId && node.id !== focusId && !neighbours.has(node.id) && !path?.includes(node.id);
                const zoneDim = !!zoneFocus && !zoneFocus.has(place.province);
                const zoneLit = activeProvince === place.province;
                const latin = /^[\x20-\x7F]+$/.test(node.name);
                const featured = node.kind === 'group';
                const labelFocus = node.id === hover || active;
                return <button key={node.id}
                  className={`bn ${place.mini ? 'mini' : ''} ${place.tight ? 'tight' : ''} ${active ? 'is-active' : ''} ${node.id === focusId ? 'is-focus' : ''} ${neighbours.has(node.id) ? 'is-neighbour' : ''} ${dim ? 'is-dim' : ''} ${zoneDim ? 'is-zone-dim' : ''} ${zoneLit ? 'is-zone-lit' : ''} ${featured ? 'is-group' : ''} ${inBeef ? 'has-beef' : ''}`}
                  data-node-id={node.id}
                  style={{left: place.x - zone.def.x - place.size / 2, top: place.y - zone.def.y - place.size / 2,
                    ['--c' as string]: place.color, ['--s' as string]: `${place.size}px`,
                    zIndex: zoneLit ? 5 : undefined}}
                  onClick={() => { if (suppressClick.current) return; setRoster(null); onSelect(node.id); }}
                  onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(null)}
                  title={`${node.name} · ${provinceLabel(provinceOf(node.city))}`}>
                  <span className="bn-focus-base" aria-hidden="true" />
                  <span className="bn-pic"><Avatar node={node} />
                    {featured && <span className="bn-flag">CREW</span>}
                    {inBeef && <span className="bn-beef-ring" aria-hidden="true" />}
                    {inBeef && <span className="bn-beef-flag">⚡BEEF</span>}
                  </span>
                  <span className="bn-name" title={node.name} style={{
                    maxWidth: labelFocus ? Math.max(place.labelW, 168) : place.labelW,
                    fontSize: latin ? (node.name.length > 9 ? 9.5 : 10.5) : place.dense || place.lines === 1 ? 10.5 : 12,
                    WebkitLineClamp: latin && !node.name.includes(' ') ? 1 : labelFocus ? 3 : place.lines,
                  }}>{node.name}</span>
                </button>;
              })}
             </div>
            </div>
          </div>; })}

          {/* 透视地面压在省份框之上、连线与节点之下：有焦点时才显影，不接收指针事件。 */}
          <div className="board-floor" aria-hidden="true" />

          <svg className="board-edges" width={world.width} height={world.height} viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
            {[...edges].sort((a, b) => Number(isFocusEdge(a)) - Number(isFocusEdge(b))).map(edge => {
              const focus = isFocusEdge(edge);
              const onPath = isPathEdge(edge);
              const color = relationMeta[edge.type].color;
              const strong = hotEdges.has(edge.id);
              // 省份 hover：只让与该省直连的线发亮，其余压到近乎不可见。
              const zoneEdge = !!activeProvince && (
                positions.get(edge.source)?.province === activeProvince ||
                positions.get(edge.target)?.province === activeProvince
              );
              return <path key={edge.id} d={edgePath(edge)} fill="none"
                stroke={onPath ? '#ffffff' : color}
                strokeWidth={onPath ? 2.4 : zoneEdge ? 2 : strong ? 1.9 : focus ? 1 : 0.9}
                strokeOpacity={onPath ? 0.95 : zoneEdge ? 0.88 : strong ? 0.9 : focus ? 0.22 : zoneFocus ? 0.05 : Math.min(0.26, 0.06 + edge.count * 0.015)}
                strokeDasharray={edge.type === 'member' ? undefined : edge.type === 'production' ? '3 4' : '6 5'}
                style={{color: onPath ? '#ffffff' : color}}
                className={focus || onPath ? `edge-live edge-focus ${onPath ? 'edge-path' : ''}` : zoneEdge ? 'edge-zone-live' : focusId ? 'edge-rest' : ''} />;
            })}
            {/* Selected person: light runs along every connected line, inward toward the face. */}
            {selected && edges.filter(edge => edge.source === selected || edge.target === selected).map((edge, index) => {
              // 省份降噪时，选中人物的流光若落在无关省份也一起隐去。
              if (zoneFocus && !zoneFocus.has(positions.get(edge.source)?.province || '') && !zoneFocus.has(positions.get(edge.target)?.province || '')) return null;
              const color = relationMeta[edge.type].color;
              // Edges are drawn from the alphabetically-first end; reverse when needed so the
              // dash flow always travels *into* the selected node.
              const d = edge.target === selected
                ? edgePath(edge)
                : `M${edge.bx.toFixed(1)},${edge.by.toFixed(1)} Q${edge.cx.toFixed(1)},${edge.cy.toFixed(1)} ${edge.ax.toFixed(1)},${edge.ay.toFixed(1)}`;
              return <g key={`flow-${edge.id}`} style={{['--c' as string]: color}}>
                <path d={d} fill="none" stroke={color} strokeWidth={4} strokeOpacity={0.09} strokeLinecap="round" />
                <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" className="edge-flow"
                  style={{animationDelay: `${(index % 7) * 0.17}s`, animationDuration: `${1.85 + (index % 3) * 0.4}s`}} />
              </g>;
            })}
            {edges.filter(edge => labelled.has(edge.id)).map(edge => {
              const meta = relationMeta[edge.type];
              const mid = edgeMid(edge);
              const labelX = mid.x * 0.86 + edge.ax * 0.14;
              const labelY = mid.y * 0.86 + edge.ay * 0.14;
              const clash = [...positions.values()].some(place => Math.hypot(place.x - labelX, place.y - labelY) < 74);
              if (clash) return null;
              const text = edge.count > 1 ? `${meta.tag} ×${edge.count}` : meta.tag;
              const width = text.length * 6.2 + 12;
              const focus = isFocusEdge(edge) || isPathEdge(edge);
              return <g key={`label-${edge.id}`} transform={`translate(${labelX},${labelY})`} opacity={focus ? 1 : 0.78}>
                <rect x={-width / 2} y={-8} width={width} height={16} rx={3} fill="#070b12" stroke={meta.color} strokeOpacity={focus ? 0.95 : 0.5} />
                <text textAnchor="middle" y={3.4} fill={meta.color} fontSize={9.5} fontFamily="'JetBrains Mono','Microsoft YaHei',monospace" letterSpacing="0.6">{text}</text>
              </g>;
            })}

            {/* BEEF 边：跟普通关系线同构——锯齿线身 + 双端标记 + 同尺度小标签。
                无独立图层开关、无巨型档案牌；点线/标签打开冲突档案看详情。 */}
            <g className="beef-links">
              {beefLinks.map(({beef, d, mid, nearA, nearB}) => {
                const active = beef.sides.some(s => s && s.nodeId === focusId);
                const status = beef.status === 'verified' ? '已核实' : '待核实';
                const label = `BEEF / ${status}`;
                const w = label.length * 6.2 + 12;
                return <g key={beef.id} className={`beef-link ${active ? 'is-active' : ''}`} onClick={e => { e.stopPropagation(); onOpenBeef(beef); }}>
                  {/* 透明命中区在最底层，捕获线身点击 */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={18} className="beef-hit" />
                  <path d={d} fill="none" className="beef-thread" />
                  <path d={d} fill="none" className="beef-halo" />
                  <path d={d} fill="none" className={`beef-zig ${active ? 'is-active' : ''}`} />
                  <path d={d} fill="none" className="beef-spark" />
                  {[nearA, nearB].map((p, i) => <g key={i} className="beef-anchor" transform={`translate(${p.x},${p.y})`}>
                    <path className="beef-anchor-diamond" d="M0,-7 L7,0 L0,7 L-7,0 Z" />
                    <path className="beef-anchor-ticks" d="M-13,0 H-9 M9,0 H13 M0,-13 V-9 M0,9 V13" />
                  </g>)}
                  <g className="beef-tag" transform={`translate(${mid.x},${mid.y})`} opacity={active ? 1 : 0.8}>
                    <rect x={-w / 2} y={-8} width={w} height={16} rx={3} />
                    <text textAnchor="middle" y={3.4}>{label}</text>
                  </g>
                </g>;
              })}
            </g>
          </svg>

        </div>
      </div>

      {roster && <div className="roster" style={{left: roster.x, top: roster.y, maxHeight: roster.h}} onPointerDown={event => event.stopPropagation()}>
        <header>
          <b>{provinceLabel(roster.province)}</b>
          <small>{rosterRows.length} 人</small>
          <button aria-label="关闭名单" onClick={() => setRoster(null)}><X size={12} /></button>
        </header>
        {data.nodes.filter(node => provinceOf(node.city) === roster.province).length > 6 &&
          <input value={rosterQuery} onChange={event => setRosterQuery(event.target.value)}
            placeholder="框内搜名字…" aria-label="在省份名单内搜索" />}
        <div className="roster-list">
          {rosterRows.length ? rosterRows.map(node => <button key={node.id} className={node.id === selected ? 'on' : ''}
            onClick={() => { onSelect(node.id); flyTo(node.id); }}>
            <Avatar node={node} />
            <span><b>{node.name}</b><small>{node.kind === 'group' ? '组合' : '音乐人'} · {degree.get(node.id) || 0} 条关系</small></span>
          </button>) : <p className="roster-empty">没有匹配的名字</p>}
        </div>
      </div>}
    </div>

    <div className="board-rail" aria-label="图层与筛选">
      <div className="rail-group">
        <button className={province === ALL_PROVINCES ? 'on' : ''} onClick={onResetProvince} title="查看全部省份">
          <Users size={15} /><span>ALL</span>
        </button>
      </div>
      <div className="rail-group">
        {(Object.keys(relationMeta) as RelationType[]).map(type => {
          const meta = relationMeta[type];
          const on = types.includes(type);
          return <button key={type} className={on ? 'on' : ''} style={{['--c' as string]: meta.color}}
            onClick={() => onToggleType(type)} title={`${meta.label} ${meta.tag}`} aria-pressed={on}>
            <i className="rail-line" /><span>{meta.tag}</span>
          </button>;
        })}
      </div>
      <div className="rail-group">
        <button onClick={onLocate} title="地域待考据名单"><Search size={15} /><span>?</span></button>
        <button onClick={resetArrangement} title="恢复地理总览，收起人物列表"><LayoutGrid size={15} /><span>总览</span></button>
        <button onClick={fit} title="复位视图"><RotateCcw size={15} /><span>FIT</span></button>
      </div>
      <div className="rail-meter">
        <Sparkles size={12} />
        <b>{edges.length}</b>
        <small>LINKS</small>
      </div>
    </div>

    <div className="board-title">
      <h2>中文说唱圈关系网</h2>
      <p>{narrow ? '拖动探索各省 · 双指缩放 · 搜索定位人物' : '地理方位示意 · 点击省份查看名单 · 选中人物显示关系'}</p>
    </div>

    <div className="board-timeline">
      <div className="bt-legend" aria-label="关系类型">
        {(Object.keys(relationMeta) as RelationType[]).map(type => {
          const meta = relationMeta[type];
          const on = types.includes(type);
          return <button key={type} className={on ? 'on' : ''} style={{['--c' as string]: meta.color}}
            onClick={() => onToggleType(type)} aria-pressed={on} title={`${on ? '隐藏' : '显示'}${meta.label}`}>
            <i />{meta.label}
          </button>;
        })}
      </div>
      <div className="bt-track">
        {YEARS.map(value => <button key={value} className={year === value ? 'on' : year !== null && value < year ? 'past' : ''}
          onClick={() => setYear(year === value ? null : value)}>{value}</button>)}
      </div>
      <button className={`bt-all ${year === null ? 'on' : ''}`} onClick={() => setYear(null)}>全部</button>
    </div>

    <div className="board-zoom">
      <button onClick={() => { const rect = viewport.current?.getBoundingClientRect(); zoomAround((rect?.width || 0) / 2, (rect?.height || 0) / 2, 1.25); }} aria-label="放大">+</button>
      <button onClick={() => { const rect = viewport.current?.getBoundingClientRect(); zoomAround((rect?.width || 0) / 2, (rect?.height || 0) / 2, 1 / 1.25); }} aria-label="缩小">−</button>
      <button onClick={fit} aria-label="复位">⌂</button>
    </div>
  </div>;
}
