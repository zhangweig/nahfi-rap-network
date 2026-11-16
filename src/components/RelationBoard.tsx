import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {LayoutGrid, RotateCcw, Search, Sparkles, Users, X} from 'lucide-react';
import {useDataset} from '../state/Dataset';
import {Avatar} from './PixelAvatar';
import {ALL_PROVINCES, UNKNOWN_PROVINCE, provinceLabel, provinceOf} from '../lib/province';
import {boardLayout, buildEdges, edgeMid, edgePath, relationMeta, type NodePlace} from '../lib/board';
import type {RelationType} from '../data/types';

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

export function RelationBoard({selected, onSelect, onClear, types, province, path, focus, onToggleType, onLocate, onResetProvince}: {
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
}) {
  const {data} = useDataset();
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({scale: 0.8, x: 0, y: 0});
  const [hover, setHover] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [offsets, setOffsets] = useState<Record<string, Offset>>(loadOffsets);
  const [dragProvince, setDragProvince] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterState | null>(null);
  const [rosterQuery, setRosterQuery] = useState('');
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 780);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 780px)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
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

  const fit = useCallback(() => {
    const element = viewport.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const box = boundsRef.current;
    // Phones stack the provinces vertically: fit the width and let the user pan down,
    // otherwise the whole list is squeezed into an unreadable thumbnail.
    if (narrow) {
      const scale = Math.min(1, (rect.width - 20) / box.w);
      setView({
        scale,
        x: (rect.width - box.w * scale) / 2 - box.x * scale,
        y: 42 - box.y * scale,
      });
      return;
    }
    // Leave room for the compact year strip pinned to the bottom edge.
    const usable = Math.max(240, rect.height - 58);
    const scale = Math.min(1.2, Math.min((rect.width - 28) / box.w, usable / box.h));
    setView({
      scale,
      x: (rect.width - box.w * scale) / 2 - box.x * scale,
      y: 8 - box.y * scale,
    });
  }, [narrow]);

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

  const clampScale = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));

  /** Zoom around a screen-space anchor so the point under the cursor stays put. */
  const zoomAround = useCallback((px: number, py: number, factor: number) => {
    setView(old => {
      const next = clampScale(old.scale * factor);
      const ratio = next / old.scale;
      return {scale: next, x: px - (px - old.x) * ratio, y: py - (py - old.y) * ratio};
    });
  }, []);

  // Wheel zoom needs a non-passive listener to keep the page still.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setView(old => {
        const next = clampScale(old.scale * Math.exp(-event.deltaY * 0.0014));
        const ratio = next / old.scale;
        return {
          scale: next,
          x: event.clientX - rect.left - (event.clientX - rect.left - old.x) * ratio,
          y: event.clientY - rect.top - (event.clientY - rect.top - old.y) * ratio,
        };
      });
    };
    element.addEventListener('wheel', onWheel, {passive: false});
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  /* ── canvas panning ─────────────────────────────────────────────────── */
  const pan = useRef({x: 0, y: 0, ox: 0, oy: 0, active: false, moved: false, blank: false});
  const onPointerDown = (event: React.PointerEvent) => {
    // Node clicks belong to the node; everything else is canvas.
    if ((event.target as HTMLElement).closest('.bn')) return;
    setRoster(null);
    pan.current = {x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, active: true, moved: false, blank: true};
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pan.current.active) return;
    if (Math.hypot(event.clientX - pan.current.x, event.clientY - pan.current.y) > 4) pan.current.moved = true;
    setView(old => ({
      ...old,
      x: pan.current.ox + (event.clientX - pan.current.x),
      y: pan.current.oy + (event.clientY - pan.current.y),
    }));
  };
  const onPointerUp = () => {
    const {active, blank, moved} = pan.current;
    pan.current.active = false;
    setDragging(false);
    // A tap (not a drag) closes the detail drawer — the map keeps its layout either way.
    if (active && blank && !moved) onClear();
  };

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
        dx: state.ox + (event.clientX - state.sx) / view.scale,
        dy: state.oy + (event.clientY - state.sy) / view.scale,
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
  }, [dragProvince, view.scale]);

  const resetArrangement = () => {
    setOffsets({});
    setRoster(null);
    requestAnimationFrame(fit);
  };

  /* ── fly to a node (search results, roster entries, path hops) ────────── */
  const animation = useRef<number | null>(null);
  const flyTo = useCallback((id: string) => {
    const place = positions.get(id);
    const element = viewport.current;
    if (!place || !element) return;
    const rect = element.getBoundingClientRect();
    const scale = Math.max(view.scale, 1.15);
    const target = {
      scale,
      x: rect.width / 2 - place.x * scale,
      y: rect.height / 2 - place.y * scale,
    };
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    const start = view;
    const begin = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - begin) / 360);
      const ease = 1 - Math.pow(1 - k, 3);
      setView({
        scale: start.scale + (target.scale - start.scale) * ease,
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
      });
      animation.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, [positions, view]);

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

  const focusId = hover || selected;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focusId) return set;
    edges.forEach(edge => {
      if (edge.source === focusId) set.add(edge.target);
      if (edge.target === focusId) set.add(edge.source);
    });
    return set;
  }, [edges, focusId]);

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

  const visibleNodes = data.nodes.filter(node => positions.has(node.id));
  const locatedCount = data.nodes.filter(node => provinceOf(node.city) !== UNKNOWN_PROVINCE).length;

  /* ── roster: every artist inside one province, searchable ─────────────── */
  const rosterRows = useMemo(() => {
    if (!roster) return [];
    const needle = rosterQuery.trim().toLowerCase();
    return data.nodes
      .filter(node => provinceOf(node.city) === roster.province)
      .filter(node => !needle || node.name.toLowerCase().includes(needle) || (node.aliases || []).some(alias => alias.toLowerCase().includes(needle)))
      .sort((a, b) => (degree.get(b.id) || 0) - (degree.get(a.id) || 0) || a.name.localeCompare(b.name, 'zh'));
  }, [roster, rosterQuery, data.nodes, degree]);

  const zoomed = view.scale >= 1.22;

  return <div className="board">
    <div className={`board-viewport ${dragging ? 'dragging' : ''} ${dragProvince ? 'zone-dragging' : ''}`} ref={viewport}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {/* Ambient backdrop: drifts slower than the board so the canvas gets depth. */}
      <div className={`board-bg ${selected ? 'is-soft' : ''}`} aria-hidden="true"
        style={{['--px' as string]: `${(view.x * 0.08).toFixed(1)}px`, ['--py' as string]: `${(view.y * 0.08).toFixed(1)}px`}}>
        <div className="bg-par">
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
      <div className="board-stage" style={{transform: `translate3d(${view.x}px,${view.y}px,0)`}}>
        <div className={`board-world ${zoomed ? 'is-zoomed' : ''}`}
          style={{width: world.width, height: world.height, zoom: view.scale}}>
          {zones.map(zone => <div key={zone.def.province}
            className={`bz ${zone.def.mini ? 'mini' : ''} ${zone.def.empty ? 'empty' : ''} ${zone.def.tiny ? 'tiny' : ''} ${dragProvince === zone.def.province ? 'is-dragging' : ''}`}
            style={{left: zone.def.x, top: zone.def.y, width: zone.def.w, height: zone.def.h, borderRadius: zone.def.radius ?? 10, ['--c' as string]: zone.def.color, zIndex: dragProvince === zone.def.province ? 4 : undefined}}
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

          <svg className="board-edges" width={world.width} height={world.height} viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
            {[...edges].sort((a, b) => Number(isFocusEdge(a)) - Number(isFocusEdge(b))).map(edge => {
              const focus = isFocusEdge(edge);
              const onPath = isPathEdge(edge);
              const color = relationMeta[edge.type].color;
              const strong = hotEdges.has(edge.id);
              return <path key={edge.id} d={edgePath(edge)} fill="none"
                stroke={onPath ? '#ffffff' : color}
                strokeWidth={onPath ? 2.4 : strong ? 1.9 : focus ? 1 : 0.9}
                strokeOpacity={onPath ? 0.95 : strong ? 0.9 : focus ? 0.22 : Math.min(0.26, 0.06 + edge.count * 0.015)}
                strokeDasharray={edge.type === 'member' ? undefined : edge.type === 'production' ? '3 4' : '6 5'}
                className={focus || onPath ? 'edge-live' : ''} />;
            })}
            {/* Selected person: light runs along every connected line, inward toward the face. */}
            {selected && edges.filter(edge => edge.source === selected || edge.target === selected).map((edge, index) => {
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
          </svg>

          {visibleNodes.map(node => {
            const place = positions.get(node.id)!;
            const active = node.id === selected;
            const dim = !!focusId && node.id !== focusId && !neighbours.has(node.id) && !path?.includes(node.id);
            const latin = /^[\x20-\x7F]+$/.test(node.name);
            const featured = node.kind === 'group';
            const raised = dragProvince === place.province;
            // Focused plates may wrap further so the full name can be read.
            const labelFocus = node.id === hover || active;
            return <button key={node.id} className={`bn ${place.mini ? 'mini' : ''} ${place.tight ? 'tight' : ''} ${active ? 'is-active' : ''} ${dim ? 'is-dim' : ''} ${featured ? 'is-group' : ''}`}
              style={{left: place.x - place.size / 2, top: place.y - place.size / 2, ['--c' as string]: place.color, ['--s' as string]: `${place.size}px`, zIndex: raised ? 3 : undefined}}
              onClick={() => { if (suppressClick.current) return; onSelect(node.id); }}
              // An avatar works as a handle for its whole province card: dragging any face
              // moves the card, a plain click still selects the person.
              onPointerDown={event => startZoneDrag(event, place.province)}
              onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(null)}
              title={`${node.name} · ${provinceLabel(provinceOf(node.city))}`}>
              <span className="bn-pic"><Avatar node={node} />
                {featured && <span className="bn-flag">CREW</span>}
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
