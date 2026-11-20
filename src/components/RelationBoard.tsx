import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import panzoom, {type PanZoom, type Transform} from 'panzoom';
import {LayoutGrid, RotateCcw, Search, Sparkles, Users, X} from 'lucide-react';
import {useDatasetData} from '../state/Dataset';
import {Avatar} from './PixelAvatar';
import {ALL_PROVINCES, UNKNOWN_PROVINCE, provinceLabel, provinceOf} from '../lib/province';
import {boardLayout, buildEdges, edgeMid, edgePath, beefPath, relationMeta, type NodePlace} from '../lib/board';
import type {RelationType} from '../data/types';
import type {BeefEvent} from '../data/beefs';
import {beefNodeIds} from '../data/beefs';

const YEARS = Array.from({length: 10}, (_, index) => 2017 + index);

/** Free-canvas arrangement: each province can be nudged anywhere, edges follow. */
type Offset = {dx: number; dy: number};
const OFFSET_KEY = 'nahfi.board.offsets.v2';
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;

/** Ambient dust for the canvas backdrop. Deterministic so renders never reshuffle it. */
const SPARKS = Array.from({length: 18}, (_, index) => ({
  x: (index * 37 + 11) % 100,
  y: (index * 61 + 17) % 100,
  delay: -((index * 1.9) % 15),
  duration: 12 + (index % 6) * 2.4,
  size: index % 4 === 0 ? 2.5 : 1.6,
}));

const loadOffsets = (): Record<string, Offset> => {
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

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
  const [year, setYear] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 跨过缩放阈值时才更新，避免 pan 过程中反复重渲染整棵节点树。 */
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  const [offsets, setOffsets] = useState<Record<string, Offset>>(loadOffsets);
  const [dragProvince, setDragProvince] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterState | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 780);
  /** 当前焦点：悬停或选中。普通关系线与 BEEF 边共用这一个变量，行为完全一致。 */
  const focusId = hover || selected;

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
      smoothScroll: {minVelocity: 5, amplitude: 0.14} as never,
      beforeMouseDown: (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return false;
        // 交互元素：节点、省份框、名单、控件——不启动画布 pan。
        const interactive = target.closest('.bn, .bz, .roster, .board-rail, .board-timeline, .board-zoom, .board-title, button');
        return !!interactive;
      },
      onTouch: (e: TouchEvent) => {
        const target = e.target as HTMLElement | null;
        // 触摸同样放过交互元素，让原生 click / 拖拽生效。
        return !(target && target.closest('.bn, .bz, .roster, button'));
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

  useEffect(() => {
    try {
      localStorage.setItem(OFFSET_KEY, JSON.stringify(offsets));
    } catch {
      /* private mode — the arrangement just won't survive a reload */
    }
  }, [offsets]);

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
    return boardLayout(located, province, narrow);
  }, [data.nodes, province, narrow]);

  /** Layout with the hand-nudged province offsets folded in. */
  const {zones, positions, world} = useMemo(() => {
    const movedZones = base.zones.map(zone => {
      const offset = offsets[zone.def.province];
      return offset ? {...zone, def: {...zone.def, x: zone.def.x + offset.dx, y: zone.def.y + offset.dy}} : zone;
    });
    const movedPositions = new Map<string, NodePlace>();
    base.positions.forEach((place, id) => {
      const offset = offsets[place.province];
      movedPositions.set(id, offset ? {...place, x: place.x + offset.dx, y: place.y + offset.dy} : place);
    });
    return {zones: movedZones, positions: movedPositions, world: base.world};
  }, [base, offsets]);

  const edges = useMemo(
    () => buildEdges(data, types, province, year, positions),
    [data, types, province, year, positions],
  );

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
    if (narrow) {
      const scale = Math.min(1, (rect.width - 20) / box.w);
      applyView(scale, (rect.width - box.w * scale) / 2 - box.x * scale, 42 - box.y * scale);
      return;
    }
    // Leave room for the compact year strip pinned to the bottom edge.
    const usable = Math.max(240, rect.height - 58);
    const scale = Math.min(1.2, Math.min((rect.width - 28) / box.w, usable / box.h));
    applyView(scale, (rect.width - box.w * scale) / 2 - box.x * scale, 8 - box.y * scale);
  }, [narrow, applyView]);

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
      blank = !!target && !target.closest('.bn, .bz, .roster, button');
      sx = e.clientX; sy = e.clientY;
      if (blank) setRoster(null);
    };
    const up = (e: PointerEvent) => {
      if (blank && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) onClearRef.current();
      blank = false;
    };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointerup', up);
    return () => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerup', up);
    };
  }, []);

  /* ── province cards are draggable, PureRef style ─────────────────────── */
  const zoneDrag = useRef<{
    province: string; sx: number; sy: number; ox: number; oy: number; moved: boolean; el: HTMLElement;
  } | null>(null);
  const pendingDrag = useRef<{province: string; dx: number; dy: number} | null>(null);
  const dragFrame = useRef<number | null>(null);
  const dragFromTag = useRef(false);
  // A drag that started on an avatar must not also count as a click on that avatar.
  const suppressClick = useRef(false);

  const flushDrag = () => {
    dragFrame.current = null;
    const pending = pendingDrag.current;
    if (!pending) return;
    setOffsets(old => ({...old, [pending.province]: {dx: pending.dx, dy: pending.dy}}));
  };

  const openRoster = (provinceName: string, zoneEl: HTMLElement | null) => {
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

  const startZoneDrag = (event: React.PointerEvent<HTMLElement>, zoneProvince: string) => {
    // Both the canvas pan and the zone drag listen for pointerdown — the zone wins.
    event.stopPropagation();
    if ((event.target as HTMLElement).closest('.roster-open')) return;
    const offset = offsets[zoneProvince] || {dx: 0, dy: 0};
    const el = event.currentTarget;
    zoneDrag.current = {
      province: zoneProvince, sx: event.clientX, sy: event.clientY,
      ox: offset.dx, oy: offset.dy, moved: false, el,
    };
    dragFromTag.current = !!(event.target as HTMLElement).closest('.bz-tag');
    setRoster(null);
    setDragProvince(zoneProvince);
    // Capture keeps the drag alive once the pointer leaves the card; the window listeners
    // in the effect below are the safety net when the browser drops that capture.
    try { el.setPointerCapture(event.pointerId); } catch { /* older engines */ }
  };

  // The move/up phase listens on the window instead of the card itself: no backdrop layer,
  // pointer-capture edge case or fast exit past the canvas edge can strand a card mid-drag
  // (which feels like "省份框拖不动了"). The canvas itself stays free — a card may be parked
  // outside the designed grid; TIDY brings everything home.
  useEffect(() => {
    if (!dragProvince) return;
    const onMove = (event: PointerEvent) => {
      const state = zoneDrag.current;
      if (!state) return;
      if (!state.moved && Math.hypot(event.clientX - state.sx, event.clientY - state.sy) > 3) state.moved = true;
      pendingDrag.current = {
        province: state.province,
        dx: state.ox + (event.clientX - state.sx) / viewRef.current.scale,
        dy: state.oy + (event.clientY - state.sy) / viewRef.current.scale,
      };
      if (dragFrame.current === null) dragFrame.current = requestAnimationFrame(flushDrag);
    };
    const finish = () => {
      const state = zoneDrag.current;
      zoneDrag.current = null;
      setDragProvince(null);
      if (!state) return;
      if (dragFrame.current !== null) {
        cancelAnimationFrame(dragFrame.current);
        dragFrame.current = null;
        flushDrag();
      }
      // A tap on the name tag (not a drag) opens the roster for that province.
      if (!state.moved && dragFromTag.current) openRoster(state.province, state.el);
      // Swallow the click the browser fires right after a real drag (avatars included).
      if (state.moved) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragProvince]);

  const resetArrangement = () => {
    setOffsets({});
    setRoster(null);
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
      x: rect.width / 2 - place.x * scale,
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
    if (dragFrame.current !== null) cancelAnimationFrame(dragFrame.current);
  }, []);

  const focusNonce = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === focusNonce.current) return;
    focusNonce.current = focus.n;
    const frame = requestAnimationFrame(() => flyTo(focus.id));
    return () => cancelAnimationFrame(frame);
  }, [focus, positions, flyTo]);

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
  const zoneFocus = useMemo(() => {
    if (!hoverProvince) return null;
    const provinces = new Set<string>([hoverProvince]);
    for (const edge of edges) {
      const a = positions.get(edge.source)?.province;
      const b = positions.get(edge.target)?.province;
      if (a === hoverProvince && b) provinces.add(b);
      else if (b === hoverProvince && a) provinces.add(a);
    }
    return provinces;
  }, [hoverProvince, edges, positions]);

  const isFocusEdge = (edge: {source: string; target: string}) =>
    !!focusId && (edge.source === focusId || edge.target === focusId);

  const isPathEdge = (edge: {source: string; target: string}) =>
    pathPairs.has([edge.source, edge.target].sort().join('|'));

  const labelled = useMemo(() => {
    const ids = new Set<string>();
    const ranked = [...edges].sort((a, b) => b.count - a.count);
    for (const edge of ranked) {
      if (isPathEdge(edge)) ids.add(edge.id);
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

  const visibleNodes = useMemo(() => data.nodes.filter(node => positions.has(node.id)), [data.nodes, positions]);
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
          {zones.map(zone => <div key={zone.def.province}
            className={`bz ${zone.def.mini ? 'mini' : ''} ${zone.def.empty ? 'empty' : ''} ${zone.def.tiny ? 'tiny' : ''} ${dragProvince === zone.def.province ? 'is-dragging' : ''} ${hoverProvince === zone.def.province ? 'is-zone-lit' : ''} ${zoneFocus && !zoneFocus.has(zone.def.province) ? 'is-zone-dim' : ''}`}
            style={{left: zone.def.x, top: zone.def.y, width: zone.def.w, height: zone.def.h, borderRadius: zone.def.radius ?? 10, ['--c' as string]: zone.def.color, zIndex: dragProvince === zone.def.province || hoverProvince === zone.def.province ? 4 : undefined}}
            // 只在鼠标设备触发：触屏点完没有 leave，省份高亮会一直卡住。
            onPointerEnter={event => { if (event.pointerType === 'mouse') setHoverProvince(zone.def.province); }}
            onPointerLeave={event => { if (event.pointerType === 'mouse') setHoverProvince(null); }}
            onPointerDown={event => startZoneDrag(event, zone.def.province)}>
            <div className="bz-tag" title="拖动移动这个省份框 · 单击展开名单">
              {zone.def.tiny && !zone.def.mini
                ? <em className="only-name">{provinceLabel(zone.def.province)}</em>
                : <><b>{zone.def.code}</b><em>{provinceLabel(zone.def.province)}</em></>}
              <i>{zone.def.mini ? `${zone.count}/${archiveTotal}` : zone.def.empty ? '' : zone.count}</i>
              {zone.def.mini ? <button onClick={onLocate}>全部 →</button>
                : <button className="roster-open" onClick={event => {
                  event.stopPropagation();
                  openRoster(zone.def.province, event.currentTarget.closest('.bz') as HTMLElement | null);
                }} aria-label={`展开 ${provinceLabel(zone.def.province)} 名单`}>名单</button>}
            </div>
          </div>)}

          {/* 透视地面压在省份框之上、连线与节点之下：有焦点时才显影，不接收指针事件。 */}
          <div className="board-floor" aria-hidden="true" />

          <svg className="board-edges" width={world.width} height={world.height} viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
            {[...edges].sort((a, b) => Number(isFocusEdge(a)) - Number(isFocusEdge(b))).map(edge => {
              const focus = isFocusEdge(edge);
              const onPath = isPathEdge(edge);
              const color = relationMeta[edge.type].color;
              const strong = hotEdges.has(edge.id);
              // 省份 hover：只让与该省直连的线发亮，其余压到近乎不可见。
              const zoneEdge = !!hoverProvince && (
                positions.get(edge.source)?.province === hoverProvince ||
                positions.get(edge.target)?.province === hoverProvince
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

          {visibleNodes.map(node => {
            const place = positions.get(node.id)!;
            const active = node.id === selected;
            const inBeef = beefIds.has(node.id);
            const dim = !!focusId && node.id !== focusId && !neighbours.has(node.id) && !path?.includes(node.id);
            const zoneDim = !!zoneFocus && !zoneFocus.has(place.province);
            const zoneLit = hoverProvince === place.province;
            const latin = /^[\x20-\x7F]+$/.test(node.name);
            const featured = node.kind === 'group';
            const raised = dragProvince === place.province;
            // Focused plates may wrap further so the full name can be read.
            const labelFocus = node.id === hover || active;
            return <button key={node.id} className={`bn ${place.mini ? 'mini' : ''} ${place.tight ? 'tight' : ''} ${active ? 'is-active' : ''} ${node.id === focusId ? 'is-focus' : ''} ${neighbours.has(node.id) ? 'is-neighbour' : ''} ${dim ? 'is-dim' : ''} ${zoneDim ? 'is-zone-dim' : ''} ${zoneLit ? 'is-zone-lit' : ''} ${featured ? 'is-group' : ''} ${inBeef ? 'has-beef' : ''}`}
              // 省份框 hover 时抬到 z-index 4，本省头像必须同步抬到 5，否则会被自己的框盖住点不到。
              style={{left: place.x - place.size / 2, top: place.y - place.size / 2, ['--c' as string]: place.color, ['--s' as string]: `${place.size}px`, zIndex: raised ? 3 : zoneLit ? 5 : undefined}}
              onClick={() => { if (suppressClick.current) return; onSelect(node.id); }}
              // An avatar works as a handle for its whole province card: dragging any face
              // moves the card, a plain click still selects the person.
              onPointerDown={event => startZoneDrag(event, place.province)}
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
                // A single long Latin word breaks into ugly orphans — clip it instead.
                // Multi-word Latin names still wrap cleanly at their spaces.
                fontSize: latin ? (node.name.length > 9 ? 9.5 : 10.5) : place.dense || place.lines === 1 ? 10.5 : 12,
                WebkitLineClamp: latin && !node.name.includes(' ') ? 1 : labelFocus ? 3 : place.lines,
              }}>{node.name}</span>
            </button>;
          })}
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
        <button onClick={resetArrangement} title="恢复自动排版（拖远、找不到的省份框也会回到原位）"><LayoutGrid size={15} /><span>TIDY</span></button>
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
      <p>34 PROVINCES · 已定位 {locatedCount} 人 · {data.nodes.length - locatedCount} 人待考据</p>
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
