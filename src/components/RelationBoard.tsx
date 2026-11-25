import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import panzoom, {type PanZoom, type Transform} from 'panzoom';
import {LayoutGrid, RotateCcw, Search, Sparkles, Users} from 'lucide-react';
import {useDatasetData} from '../state/Dataset';
import {Avatar} from './PixelAvatar';
import {ALL_PROVINCES, UNKNOWN_PROVINCE, provinceLabel, provinceOf} from '../lib/province';
import {boardLayout, buildEdges, edgeDash, edgePath, edgePathWave, beefPath, relationMeta, type BoardEdge, type NodePlace, type ZoneDef} from '../lib/board';
import type {RelationType} from '../data/types';
import type {BeefEvent} from '../data/beefs';
import {beefNodeIds} from '../data/beefs';

const YEARS = Array.from({length: 10}, (_, index) => 2017 + index);

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 3;

/**
 * 框内头像的慢速漂浮参数。
 * 位置本身是确定性的随机散布，这里再给每个人一份「确定性的随机漂移」：
 * 方向、幅度、周期都不同，但同一个人每次渲染完全一致（重渲染/刷新都不会跳位）。
 */
const driftOf = (id: string, size: number, radius: number) => {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash ^ id.charCodeAt(index)) * 16777619;
  }
  hash >>>= 0;
  // 幅度同时受头像大小与斑块半径约束：小省不会飘出轮廓，大省才敢飘几像素。
  const reach = Math.min(9, Math.max(3, Math.min(size * 0.34, radius * 0.13)));
  const angle = ((hash % 360) / 180) * Math.PI;
  const radiusScale = 0.65 + ((hash >>> 11) % 90) / 140;
  const dx = Math.cos(angle) * reach * radiusScale;
  const dy = Math.sin(angle) * reach * radiusScale;
  return {
    x: +dx.toFixed(2),
    y: +dy.toFixed(2),
    duration: 12 + ((hash >>> 15) % 120) / 10,   // 12 ~ 24s
    delay: -(((hash >>> 19) % 200) / 10),        // 负延迟：一进画面就处在各自的相位
  };
};

/** Ambient dust for the canvas backdrop. Deterministic so renders never reshuffle it. */
const SPARKS = Array.from({length: 18}, (_, index) => ({
  x: (index * 37 + 11) % 100,
  y: (index * 61 + 17) % 100,
  delay: -((index * 1.9) % 15),
  duration: 12 + (index % 6) * 2.4,
  size: index % 4 === 0 ? 2.5 : 1.6,
}));

/**
 * 省际骨架：地理相邻的省份对，画成极弱的贝塞尔虚线压在省份框下面。
 * 它表达"省份挨着谁"，和人物关系线完全是两套语义，所以不参与点击。
 */
const PROVINCE_TIES: [string, string][] = [
  ['新疆', '西藏'], ['新疆', '青海'], ['新疆', '甘肃'], ['西藏', '青海'], ['西藏', '四川'], ['西藏', '云南'],
  ['青海', '甘肃'], ['青海', '四川'], ['甘肃', '宁夏'], ['甘肃', '陕西'], ['甘肃', '内蒙古'],
  ['宁夏', '陕西'], ['宁夏', '内蒙古'], ['内蒙古', '陕西'], ['内蒙古', '山西'], ['内蒙古', '河北'],
  ['内蒙古', '辽宁'], ['内蒙古', '吉林'], ['内蒙古', '黑龙江'], ['黑龙江', '吉林'], ['吉林', '辽宁'],
  ['辽宁', '河北'], ['辽宁', '北京'], ['辽宁', '天津'], ['河北', '北京'], ['河北', '天津'], ['河北', '山西'],
  ['河北', '河南'], ['河北', '山东'], ['山西', '陕西'], ['山西', '河南'], ['陕西', '河南'], ['陕西', '四川'],
  ['陕西', '重庆'], ['陕西', '湖北'], ['河南', '山东'], ['河南', '安徽'], ['河南', '湖北'],
  ['山东', '江苏'], ['山东', '安徽'], ['江苏', '安徽'], ['江苏', '上海'], ['江苏', '浙江'],
  ['安徽', '浙江'], ['安徽', '江西'], ['安徽', '湖北'], ['上海', '浙江'], ['浙江', '江西'],
  ['浙江', '福建'], ['江西', '福建'], ['江西', '湖北'], ['江西', '湖南'], ['江西', '广东'],
  ['福建', '广东'], ['福建', '台湾'], ['湖北', '湖南'], ['湖北', '重庆'], ['湖北', '四川'],
  ['湖南', '四川'], ['湖南', '重庆'], ['湖南', '贵州'], ['湖南', '广西'], ['湖南', '广东'],
  ['四川', '重庆'], ['四川', '贵州'], ['四川', '云南'], ['重庆', '贵州'], ['贵州', '云南'],
  ['贵州', '广西'], ['云南', '广西'], ['广西', '广东'], ['广西', '海南'], ['广东', '海南'],
  ['广东', '香港'], ['广东', '澳门'], ['香港', '澳门'],
];
const tieHash = (key: string) => {
  let value = 0;
  for (let i = 0; i < key.length; i += 1) value = (value * 31 + key.charCodeAt(i)) % 997;
  return value;
};

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
  /** 飞行动画的中断句柄：用户一滚轮/拖拽就停下，避免和 panzoom 抢写 transform。 */
  const stopFlyRef = useRef<() => void>(() => {});
  /** flyTo 读布局的最新快照，避免悬停导致 positions 变化时重复起飞。 */
  const layoutRef = useRef({positions: new Map<string, NodePlace>(), allEdges: [] as ReturnType<typeof buildEdges>, shownBeefs: [] as BeefEvent[]});
  /** 框内镜头复位：定义在 fit 之后，用 ref 桥接，避免依赖顺序问题。 */
  const lensResetRef = useRef<() => void>(() => {});
  const [hover, setHover] = useState<string | null>(null);
  /** 斑块 hover：整块抬升 + 名字牌浮现 + 无关省份降噪。 */
  const [hoverProvince, setHoverProvince] = useState<string | null>(null);
  const [pinnedProvince, setPinnedProvince] = useState<string | null>(null);
  /** 手动拖动斑块累积的位移（世界坐标）。不影响别的省份，只带着自己的连线一起走。 */
  const [zoneShift, setZoneShift] = useState<Record<string, {x: number; y: number}>>({});
  const activeProvince = pinnedProvince || hoverProvince;
  const [year, setYear] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  /** 跨过缩放阈值时才更新，避免 pan 过程中反复重渲染整棵节点树。 */
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;
  // A finished canvas / lens drag must not also count as a click.
  const suppressClick = useRef(false);
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 780);
  /** 当前焦点：悬停或选中。普通关系线与 BEEF 边共用这一个变量，行为完全一致。 */
  const focusId = selected;

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
        // 交互元素：头像、斑块轮廓、控件——不启动画布 pan（斑块自己处理拖拽）。
        const interactive = target.closest('.bn, .bz, .board-rail, .board-timeline, .board-zoom, .board-title, button');
        return !!interactive;
      },
      onTouch: (e: TouchEvent) => {
        const target = e.target as HTMLElement | null;
        // 触摸同样放过交互元素，让原生 click / 拖拽生效。
        return !(target && target.closest('.bn, .bz, button'));
      },
    });
    pz.current = instance;
    const interrupt=()=>stopFlyRef.current();
    surface.addEventListener('pointerdown',interrupt,{capture:true});
    surface.addEventListener('wheel',interrupt,{capture:true,passive:true});
    surface.addEventListener('touchstart',interrupt,{capture:true,passive:true});

    let paintedScale = NaN;
    const syncTransform = () => {
      const t = instance.getTransform();
      viewRef.current = t;
      if(t.scale!==paintedScale){
        layer.style.setProperty('--focus-magnify',String(Math.min(2.2,Math.max(1,.45/t.scale))));
        paintedScale=t.scale;
      }
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
      surface.removeEventListener('pointerdown',interrupt,true);
      surface.removeEventListener('wheel',interrupt,true);
      surface.removeEventListener('touchstart',interrupt,true);
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

  /**
   * 布局只用「省份 + 人数」：选中谁都不会让斑块变形或位移，
   * 所以放大看关系时地图是稳的，不会因为焦点变化整张重排。
   */
  const base = useMemo(
    () => boardLayout(data.nodes, province, narrow, degree),
    [data.nodes, province, narrow, degree],
  );

  /** 手动拖动过的斑块：位移叠加到斑块中心与它的节点上，连线跟着一起走。 */
  const {zones, positions, world} = useMemo(() => {
    if (!Object.keys(zoneShift).length) return base;
    const zones = base.zones.map(zone => {
      const delta = zoneShift[zone.def.province];
      return delta ? {...zone, def: {...zone.def, x: zone.def.x + delta.x, y: zone.def.y + delta.y}} : zone;
    });
    const positions = new Map<string, NodePlace>();
    for (const [id, place] of base.positions) {
      const delta = zoneShift[place.province];
      positions.set(id, delta ? {...place, x: place.x + delta.x, y: place.y + delta.y} : place);
    }
    return {...base, zones, positions};
  }, [base, zoneShift]);

  const allEdges = useMemo(
    () => buildEdges(data, types, province, year, positions),
    [data, types, province, year, positions],
  );
  // 默认态：只留跨省、合作次数 top20 的线作暗纹。
  // 单省视图里所有关系都是省内的，跨省过滤会把线全滤掉（LINKS 变 0），所以那里改取省内 top。
  const ambientEdges = useMemo(() => {
    const sameZone = (edge: {source: string; target: string}) =>
      positions.get(edge.source)?.province === positions.get(edge.target)?.province;
    const ranked = [...allEdges].sort((a, b) => b.count - a.count);
    if (province !== ALL_PROVINCES) return ranked.filter(sameZone).slice(0, 60);
    return ranked.filter(edge => !sameZone(edge)).slice(0, 40);
  }, [allEdges, positions, province]);
  const edges = useMemo(() => {
    if (!selected) return ambientEdges;
    return allEdges.filter(edge=>edge.source===selected || edge.target===selected);
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

  // flyTo 读最新布局快照：positions 只在拖动斑块时变化，不会改变 flyTo 函数身份、也不会二次起飞。
  layoutRef.current = {positions, allEdges, shownBeefs};

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

  /** 画布范围：包住所有斑块（含轮廓外标签）与头像，拖动出界也跟着扩。 */
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const zone of zones) {
      minX = Math.min(minX, zone.def.x - zone.def.r);
      minY = Math.min(minY, zone.def.y - zone.def.r - 18);
      maxX = Math.max(maxX, zone.def.x + zone.def.r);
      maxY = Math.max(maxY, zone.def.y + zone.def.r + 8);
    }
    if (!Number.isFinite(minX)) return {x: 0, y: 0, w: world.width, h: world.height};
    return {x: minX, y: minY, w: maxX - minX, h: maxY - minY};
  }, [zones, world]);

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
    lensResetRef.current();
    const element = viewport.current;
    if (!element || !pz.current) return;
    const rect = element.getBoundingClientRect();
    const box = boundsRef.current;
    // 左侧让出工具条、底部让出年份条、顶部让出标题。
    const left = narrow ? 12 : 80;
    const usableW = Math.max(160, rect.width - left - 16);
    const usableH = Math.max(160, rect.height - 132);
    const fitScale = Math.min(1.15, usableW / box.w, usableH / box.h);
    // 手机上整张图缩到 0.35 会变成一张认不出人的缩略图：给一个可读下限，靠拖动看其余部分。
    const scale = narrow ? Math.max(fitScale, 0.8) : fitScale;
    applyView(scale, left + (usableW - box.w * scale) / 2 - box.x * scale,
      64 + (usableH - box.h * scale) / 2 - box.y * scale);
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
    setPinnedProvince(null);
    fit();
  }, [province, fit]);

  /** Zoom around a screen-space anchor so the point under the cursor stays put. */
  const zoomAround = useCallback((px: number, py: number, factor: number) => {
    const instance = pz.current;
    if (!instance) return;
    instance.smoothZoom(px, py, factor);
  }, []);

  /* ── 框内滚轮：像 Apple Watch 主屏那样缩放这一块的头像阵列 ────────────
     滚轮落在省份框里时，panzoom 被拦下，只有 .zone-inner 整体缩放：
     锚点跟着鼠标走，所以"指哪儿放大哪儿"；放大后按住头像可平移，
     缩回 1 倍自动归位、解除裁剪。全程直接写 DOM，不触发 React 重渲染。 */
  const lens = useRef({host: null as HTMLElement | null, inner: null as HTMLElement | null, s: 1, tx: 0, ty: 0});
  const paintLens = () => {
    const state = lens.current;
    if (!state.inner) return;
    state.inner.style.transform = `translate3d(${state.tx.toFixed(2)}px,${state.ty.toFixed(2)}px,0) scale(${state.s.toFixed(3)})`;
    const on = state.s > 1.02;
    state.host?.classList.toggle('is-lensing', on);
    // 角标：不写角标的话，选中人物后整块地图被压到 46% 透明，
    // 框内滚轮明明放大了却"看不出变化"（用户反馈）。数字给一个明确反馈。
    const zone = state.host?.closest<HTMLElement>('.bz');
    if (zone) {
      if (on) zone.dataset.lens = `${state.s.toFixed(1)}×`;
      else delete zone.dataset.lens;
    }
  };
  const lensReset = useCallback(() => {
    const state = lens.current;
    if (state.inner) state.inner.style.transform = '';
    state.host?.classList.remove('is-lensing');
    state.host?.closest<HTMLElement>('.bz')?.removeAttribute('data-lens');
    state.host = null; state.inner = null;
    state.s = 1; state.tx = 0; state.ty = 0;
  }, []);
  lensResetRef.current = lensReset;

  // 框内滚轮与拖动只作用于这一块；离开框/复位画布时清掉。
  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      // 指针可能落在斑块内部的空白（path 命中）上，也要算「在框内」。
      let host = target?.closest<HTMLElement>('.zone-nodes') ?? null;
      if (!host) host = target?.closest<HTMLElement>('.bz')?.querySelector<HTMLElement>('.zone-nodes') ?? null;
      if (!host) return;
      // 拦在 panzoom 之前：框内滚轮是「调这块的图标」，不是「缩整张地图」。
      event.preventDefault();
      event.stopPropagation();
      stopFlyRef.current();
      const state = lens.current;
      if (state.host !== host) {
        lensReset();
        state.host = host;
        state.inner = host.querySelector<HTMLElement>('.zone-inner');
      }
      const rect = host.getBoundingClientRect();
      const view = viewRef.current.scale || 1;
      const r = rect.width / view / 2;
      const px = (event.clientX - rect.left) / view;
      const py = (event.clientY - rect.top) / view;
      // 滚一格有明确反馈但不失控；0.7~2.8 覆盖「看清全部」到「看清一张脸」。
      const next = Math.max(0.7, Math.min(2.8, state.s * Math.exp(-event.deltaY * 0.0016)));
      // 鼠标下的那个头像保持不动：以指针为锚点重算平移。
      const ax = (px - r - state.tx) / state.s;
      const ay = (py - r - state.ty) / state.s;
      state.tx += ax * (state.s - next);
      state.ty += ay * (state.s - next);
      state.s = next;
      if (next <= 1.02) { state.tx = 0; state.ty = 0; }
      paintLens();
    };
    // 放大之后按住头像拖动 = 平移框内阵列（Apple Watch 主屏的手感）。
    let pan: {sx: number; sy: number; tx: number; ty: number; moved: boolean} | null = null;
    const onDown = (event: PointerEvent) => {
      const state = lens.current;
      if (state.s <= 1.02 || !state.host || event.button !== 0) return;
      if (!(event.target as HTMLElement | null)?.closest('.bn')) return;
      pan = {sx: event.clientX, sy: event.clientY, tx: state.tx, ty: state.ty, moved: false};
    };
    const onMove = (event: PointerEvent) => {
      if (!pan) return;
      const dx = event.clientX - pan.sx, dy = event.clientY - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) < 5) return;
      pan.moved = true;
      const state = lens.current;
      state.tx = pan.tx + dx;
      state.ty = pan.ty + dy;
      paintLens();
    };
    const onUp = () => {
      if (pan?.moved) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      pan = null;
    };
    surface.addEventListener('wheel', onWheel, {passive: false, capture: true});
    surface.addEventListener('pointerdown', onDown, {capture: true});
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      surface.removeEventListener('wheel', onWheel, true);
      surface.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [lensReset]);

  /* ── 空白点击关闭详情 ─────────────────────────────────────────────────
     panzoom 已经接管滚轮缩放与画布拖拽（含松手惯性）。这里只补一个"点空白关抽屉"，
     用原生 pointer 监听：不调 preventDefault、不拦 panzoom 的 mousedown。
     容差取 8px：真人点击常带 3~6px 抖动，用 5px 会让"点空白取消选择"偶尔失灵。 */
  useEffect(() => {
    const surface = viewport.current;
    if (!surface) return;
    let sx = 0, sy = 0, blank = false;
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      blank = !!target && !target.closest('.bn, .bz-shape, button');
      sx = e.clientX; sy = e.clientY;
    };
    const up = (e: PointerEvent) => {
      const drift = Math.hypot(e.clientX - sx, e.clientY - sy);
      if (blank && drift < 8) { onClearRef.current(); setPinnedProvince(null); }
      if (drift >= 5) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false; }, 0); }
      blank = false;
    };
    surface.addEventListener('pointerdown', down);
    surface.addEventListener('pointerup', up);
    return () => {
      surface.removeEventListener('pointerdown', down);
      surface.removeEventListener('pointerup', up);
    };
  }, []);

  /** 点击斑块 = 把镜头推到这一块（再看一次复位）。没有下拉名单了。 */
  const focusZone = (def: ZoneDef) => {
    lensResetRef.current();
    if (pinnedProvince === def.province) {
      setPinnedProvince(null);
      fit();
      return;
    }
    setPinnedProvince(def.province);
    const frame = viewport.current?.getBoundingClientRect();
    if (!frame) return;
    const span = def.r * 3.2;
    const scale = clampScale(Math.min(2.4, (frame.width - (narrow ? 40 : 150)) / span, (frame.height - 160) / span));
    applyView(scale, frame.width / 2 - def.x * scale, (frame.height - 10) / 2 - def.y * scale);
  };

  /* ── 拖动斑块 ─────────────────────────────────────────────────────────
     拖的是斑块轮廓（不是头像）：按下 → 直接写 transform 预览，松手才提交位移。
     提交后把位移叠到布局上，连线两端一起跟着走。位移用 < 4px 判定点击。 */
  const zoneDrag = useRef<{province: string; shape: Element; sx: number; sy: number; scale: number; dx: number; dy: number; moved: boolean} | null>(null);

  const beginZoneDrag = (event: React.PointerEvent<HTMLDivElement>, def: ZoneDef) => {
    if (event.button !== 0) return;
    // 头像有自己的点击语义，不参与拖框。
    if ((event.target as HTMLElement).closest('.bn')) return;
    const shape = (event.target as Element).closest('.bz-shape');
    if (!shape) return;
    zoneDrag.current = {
      province: def.province, shape,
      sx: event.clientX, sy: event.clientY,
      scale: viewRef.current.scale || 1,
      dx: 0, dy: 0, moved: false,
    };
    (shape as Element & {setPointerCapture?: (id: number) => void}).setPointerCapture?.(event.pointerId);
  };

  const moveZoneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = zoneDrag.current;
    if (!drag) return;
    // 屏幕位移换算回世界坐标，否则缩放后手感会漂。
    const dx = (event.clientX - drag.sx) / drag.scale;
    const dy = (event.clientY - drag.sy) / drag.scale;
    if (!drag.moved && Math.hypot(dx, dy) * drag.scale < 4) return;
    drag.moved = true;
    drag.dx = dx; drag.dy = dy;
    const host = event.currentTarget as HTMLElement;
    host.classList.add('is-dragging');
    host.style.transform = `translate3d(${dx}px,${dy}px,0)`;
  };

  const endZoneDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = zoneDrag.current;
    if (!drag) return;
    zoneDrag.current = null;
    const host = event.currentTarget as HTMLElement;
    host.classList.remove('is-dragging');
    host.style.transform = '';
    (drag.shape as Element & {releasePointerCapture?: (id: number) => void}).releasePointerCapture?.(event.pointerId);
    if (drag.moved) {
      setZoneShift(prev => ({
        ...prev,
        [drag.province]: {
          x: (prev[drag.province]?.x || 0) + drag.dx,
          y: (prev[drag.province]?.y || 0) + drag.dy,
        },
      }));
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      return;
    }
    const def = zones.find(zone => zone.def.province === drag.province)?.def;
    if (def && !suppressClick.current) focusZone(def);
  };

  const resetArrangement = () => {
    onClearRef.current();
    setZoneShift({});
    setPinnedProvince(null);
    requestAnimationFrame(fit);
  };

  /* ── fly to a node：把「本人 + 全部一度关系线」完整框进视野 ──────────
     关系线是二次曲线，控制点常常甩到两点包围盒之外，只框头像就会切掉线身，
     所以沿线采样一起算包围盒；右侧再让出人物面板的真实宽度，线不会被面板压住。 */
  const animation = useRef<number | null>(null);
  stopFlyRef.current = () => {
    if (animation.current !== null) { cancelAnimationFrame(animation.current); animation.current = null; }
  };
  const flyTo = useCallback((id: string) => {
    const element = viewport.current;
    const instance = pz.current;
    if (!element || !instance) return;
    const {positions: pos, allEdges: all, shownBeefs: beefList} = layoutRef.current;
    const place = pos.get(id);
    if (!place || place.size === 0) return;
    const rect = element.getBoundingClientRect();

    // 镜头要挪走，框内放大镜先归位，否则缩放会跟着新位置一起漂。
    lensResetRef.current();

    // 本人 + 所有相关边（普通关系与 BEEF），把线身采样点也算进包围盒。
    const linked: BoardEdge[] = [];
    for (const edge of all) if (edge.source === id || edge.target === id) linked.push(edge);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const include = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    const includeNode = (nid: string) => {
      const p = pos.get(nid);
      if (!p || p.size === 0) return;
      include(p.x - p.size / 2, p.y - p.size / 2);
      include(p.x + p.size / 2, p.y + p.size / 2 + 18);   // 下方名字牌也留出来
    };
    includeNode(id);
    for (const edge of linked) {
      includeNode(edge.source); includeNode(edge.target);
      for (let step = 0; step <= 10; step += 1) {
        const t = step / 10, it = 1 - t;
        include(
          it * it * edge.ax + 2 * it * t * edge.cx + t * t * edge.bx,
          it * it * edge.ay + 2 * it * t * edge.cy + t * t * edge.by,
        );
      }
      // 线上的类型标签挂在曲线中段，宽度算进去，避免标签被屏幕边切掉。
      const mx = (edge.ax + 2 * edge.cx + edge.bx) / 4;
      const my = (edge.ay + 2 * edge.cy + edge.by) / 4;
      include(mx - 52, my - 12); include(mx + 52, my + 12);
    }
    for (const beef of beefList) for (const side of beef.sides) if (side?.nodeId) includeNode(side.nodeId);
    if (!Number.isFinite(minX)) return;

    const wide = rect.width > 700;
    // 面板宽度随断点变化（含滚动条），直接量真实宽度。
    const popover = wide ? document.querySelector<HTMLElement>('.map-person-popover') : null;
    const drawer = popover ? popover.getBoundingClientRect().width + 20 : 0;
    const leftPad = wide ? 88 : 16;
    const usableW = Math.max(160, rect.width - drawer - leftPad - 16);
    // 顶部标题、底部时间轴都是浮层，别把线塞到它们底下。
    const topPad = wide ? 72 : 62;
    const usableH = Math.max(140, rect.height - topPad - (wide ? 62 : 96));
    const boxW = Math.max(1, maxX - minX), boxH = Math.max(1, maxY - minY);
    // 1.22 的余量：线有描边、标签有宽度，框太紧会贴边。
    const scale = clampScale(Math.min(1.6, usableW / (boxW * 1.22), usableH / (boxH * 1.22)));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const start = {...instance.getTransform()};
    const target = {
      scale,
      x: leftPad + usableW / 2 - cx * scale,
      y: topPad + usableH / 2 - cy * scale,
    };
    if (animation.current !== null) cancelAnimationFrame(animation.current);
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){
      instance.zoomAbs(0,0,target.scale);instance.moveTo(target.x,target.y);return;
    }
    const begin = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - begin) / 420);
      const ease = 1 - Math.pow(1 - k, 3);
      instance.zoomAbs(0, 0, start.scale + (target.scale - start.scale) * ease);
      instance.moveTo(start.x + (target.x - start.x) * ease, start.y + (target.y - start.y) * ease);
      animation.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    animation.current = requestAnimationFrame(step);
  }, [clampScale]);

  useEffect(() => () => {
    if (animation.current !== null) cancelAnimationFrame(animation.current);
  }, []);

  const focusNonce = useRef(0);
  // 选中 / 搜索定位：一次把整条关系线框进视野。
  // 不再等 positions 或做「已经飞过」去重——那样第二次点同一个人、或者悬停改布局时都会漏飞。
  useEffect(() => {
    const explicit = !!focus && focus.n !== focusNonce.current;
    const id = explicit ? focus!.id : selected;
    if (!id) return;
    const frame = requestAnimationFrame(() => {
      if (explicit) focusNonce.current = focus!.n;
      flyTo(id);
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, focus?.n, flyTo]);

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
    if (!activeProvince || selected) return null;
    const set = new Set<string>([activeProvince]);
    for (const edge of allEdges) {
      const a = positions.get(edge.source)?.province;
      const b = positions.get(edge.target)?.province;
      if (a === activeProvince && b) set.add(b);
      if (b === activeProvince && a) set.add(a);
    }
    return set;
  }, [activeProvince, allEdges, positions, selected]);

  /** 省际骨架线：连接相邻斑块的中心；悬停时只点亮与该省相邻的几条。 */
  const zoneTies = useMemo(() => {
    const byProvince = new Map(zones.map(zone => [zone.def.province, zone.def]));
    const result: {id: string; d: string; lit: boolean; dim: boolean}[] = [];
    for (const [a, b] of PROVINCE_TIES) {
      const za = byProvince.get(a), zb = byProvince.get(b);
      if (!za || !zb) continue;
      const ax = za.x, ay = za.y;
      const bx = zb.x, by = zb.y;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const bow = ((tieHash(a + b) % 7) - 3) * 9;
      const cx = (ax + bx) / 2 - (dy / len) * bow;
      const cy = (ay + by) / 2 + (dx / len) * bow;
      const lit = !!activeProvince && (a === activeProvince || b === activeProvince);
      result.push({
        id: `${a}|${b}`,
        d: `M${ax.toFixed(1)},${ay.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${bx.toFixed(1)},${by.toFixed(1)}`,
        lit, dim: !!zoneFocus && !lit,
      });
    }
    return result;
  }, [zones, activeProvince, zoneFocus]);

  const isFocusEdge = (edge: {source: string; target: string}) =>
    !!focusId && (edge.source === focusId || edge.target === focusId);

  const isPathEdge = (edge: {source: string; target: string}) =>
    pathPairs.has([edge.source, edge.target].sort().join('|'));

  /**
   * 关系线标签：同一个节点扇出的几条线会在曲线中段挤成一坨，
   * 所以按曲线法线依次错开，直到既不压脸、也不压已经放好的标签。
   */
  const labelItems = useMemo(() => {
    const wanted = new Set<string>();
    const ranked = [...edges].sort((a, b) => b.count - a.count);
    for (const edge of ranked) {
      if (isFocusEdge(edge) && isPathEdge(edge)) wanted.add(edge.id);
      else if (isFocusEdge(edge) && edge.count >= 3) wanted.add(edge.id);
      else if (!focusId && wanted.size < 4 && edge.count >= 4) wanted.add(edge.id);
      if (wanted.size >= 5) break;
    }
    if (!wanted.size) return [];
    const places = [...positions.values()].filter(place => place.size > 0);
    const placed: {x: number; y: number; w: number}[] = [];
    const items: {id: string; x: number; y: number; text: string; color: string; focus: boolean; width: number}[] = [];
    for (const edge of edges) {
      if (!wanted.has(edge.id)) continue;
      const meta = relationMeta[edge.type];
      const text = edge.count > 1 ? `${meta.label} ×${edge.count}` : meta.label;
      const width = text.length * 11 + 12;
      // 沿曲线取不同的参数点：同一个节点扇出的几条线本来就越走越开，
      // 把标签放到不同"半径"上，比在同一个中点上下错位要干净得多。
      const at = (t: number) => {
        const mt = 1 - t;
        return {
          x: mt * mt * edge.ax + 2 * mt * t * edge.cx + t * t * edge.bx,
          y: mt * mt * edge.ay + 2 * mt * t * edge.cy + t * t * edge.by,
        };
      };
      // 打分挑位：避开已有标签最重要（100），其次避开人脸（30），
      // 同分取更靠外的那一段。密集的省里六个候选都挤在一起时，至少取最不坏的一个。
      let spot = at(0.86);
      let bestScore = -Infinity;
      for (const t of [0.86, 0.72, 0.94, 0.6, 0.5, 0.42]) {
        const cand = at(t);
        const onLabel = placed.some(p => Math.abs(p.x - cand.x) < (p.w + width) / 2 + 8 && Math.abs(p.y - cand.y) < 21);
        const onFace = places.some(place => Math.hypot(place.x - cand.x, place.y - cand.y) < 58);
        const score = (onLabel ? 0 : 100) + (onFace ? 0 : 30) + t;
        if (score > bestScore) { bestScore = score; spot = cand; }
        if (!onLabel && !onFace) break;
      }
      placed.push({x: spot.x, y: spot.y, w: width});
      items.push({id: edge.id, x: spot.x, y: spot.y, text, color: meta.color, focus: isFocusEdge(edge) || isPathEdge(edge), width});
    }
    return items;
  }, [edges, focusId, path, positions]);

  const hotEdges = useMemo(() => {
    if (!focusId) return new Set<string>();
    return new Set(edges.filter(edge => edge.source === focusId || edge.target === focusId)
      .sort((a, b) => b.count - a.count).slice(0, 10).map(edge => edge.id));
  }, [edges, focusId]);

  const visibleNodes = useMemo(() => data.nodes.filter(node => positions.has(node.id) && positions.get(node.id)!.size > 0), [data.nodes, positions]);
  const nodesByProvince = useMemo(()=>{
    const groups=new Map<string,typeof visibleNodes>();
    for(const node of visibleNodes){const region=positions.get(node.id)!.province;const group=groups.get(region)||[];group.push(node);groups.set(region,group);}
    return groups;
  },[visibleNodes,positions]);
  const orderedEdges=useMemo(()=>[...edges].sort((a,b)=>Number(isFocusEdge(a))-Number(isFocusEdge(b))),[edges,focusId]);
  // 厂牌线走波浪路径，其余走原贝塞尔：四条线型（实/长虚/点/波浪）在小缩放下也能分开。
  const edgePaths=useMemo(()=>new Map(edges.map(edge=>[edge.id, edge.type === 'affiliation' ? edgePathWave(edge) : edgePath(edge)])),[edges]);

  return <div className={`board ${focusId ? 'has-focus' : ''} ${dragging ? 'is-interacting' : ''}`}>
    <div className={`board-viewport ${dragging ? 'dragging' : ''}`} ref={viewport}>
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
          {/* 省际底纹：压在省份框下面，只表达方位邻接，不与人物关系线抢注意力。 */}
          <svg className="board-ties" width={world.width} height={world.height}
            viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
            {zoneTies.map(tie => <path key={tie.id} d={tie.d}
              className={`${tie.lit ? 'is-lit' : ''} ${tie.dim ? 'is-dim' : ''}`} />)}
          </svg>
          {/* 斑块形状裁切：框内镜头放大到超出轮廓时，按斑块本身的形状裁，不用一个圆糊过去。 */}
          <svg className="board-clips" width="0" height="0" aria-hidden="true">
            <defs>
              {zones.map((zone, index) => <clipPath key={zone.def.province} id={`zc-${index}`} clipPathUnits="objectBoundingBox">
                <path d={zone.def.shape} transform="scale(0.005)" />
              </clipPath>)}
            </defs>
          </svg>
          {zones.map((zone, zoneIndex) => {
            const def = zone.def;
            const size = Math.round(def.r * 2);
            const members = nodesByProvince.get(def.province) || [];
            const lit = hoverProvince === def.province;
            const pinned = pinnedProvince === def.province;
            return <div key={def.province} data-province={def.province}
              tabIndex={0} role="group"
              aria-label={`${provinceLabel(def.province)}，${zone.count} 人，回车放大这一块`}
              onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); focusZone(def); } }}
              className={`bz ${def.mini ? 'mini' : ''} ${def.empty ? 'empty' : ''} ${lit ? 'is-zone-lit' : ''} ${pinned ? 'is-zone-selected' : ''} ${zoneFocus && !zoneFocus.has(def.province) ? 'is-zone-dim' : ''}`}
              style={{left: def.x - def.r, top: def.y - def.r, width: size, height: size,
                ['--c' as string]: def.color,
                zIndex: pinned || lit ? 4 : undefined}}
              onPointerDown={event => beginZoneDrag(event, def)}
              onPointerMove={moveZoneDrag}
              onPointerUp={endZoneDrag}
              onPointerCancel={endZoneDrag}
              // 触屏点完没有 leave：只有鼠标驱动高亮，否则省块会一直亮着。
              // 拖动期间不切高亮，否则指针划过别的斑块会让整张图闪。
              onPointerOver={event => { if (event.pointerType === 'mouse' && !zoneDrag.current && !event.currentTarget.contains(event.relatedTarget as Node)) setHoverProvince(def.province); }}
              onPointerOut={event => { if (event.pointerType === 'mouse' && !zoneDrag.current && !event.currentTarget.contains(event.relatedTarget as Node)) setHoverProvince(null); }}>
              <svg className="bz-shape" viewBox="0 0 200 200" aria-hidden="true">
                <path d={def.shape} />
              </svg>
              <span className="bz-label">
                <em>{provinceLabel(def.province)}</em>
                {zone.count > 0 && <i>{zone.count}</i>}
              </span>
              {/* zone-inner 是框内镜头：框内滚轮只缩放这一层，不缩放整张地图。 */}
              <div className="zone-nodes" data-province={def.province}
                style={{['--clip' as string]: `url(#zc-${zoneIndex})`}}>
                <div className="zone-inner">
                {members.map(node => {
                  const place = positions.get(node.id)!;
                  const active = node.id === selected;
                  const inBeef = beefIds.has(node.id);
                  const dim = !!focusId && node.id !== focusId && !neighbours.has(node.id) && !path?.includes(node.id);
                  const zoneDim = !!zoneFocus && !zoneFocus.has(place.province);
                  const zoneLit = activeProvince === place.province;
                  const latin = /^[\x20-\x7F]+$/.test(node.name);
                  const featured = node.kind === 'group';
                  // 每个人的漂浮轨迹都不同，但同一个人永远同一条轨迹。
                  const drift = driftOf(node.id, place.size, def.r);
                  return <button key={node.id}
                    className={`bn ${place.mini ? 'mini' : ''} ${active ? 'is-active' : ''} ${node.id === focusId ? 'is-focus' : ''} ${neighbours.has(node.id) ? 'is-neighbour' : ''} ${dim ? 'is-dim' : ''} ${zoneDim ? 'is-zone-dim' : ''} ${zoneLit ? 'is-zone-lit' : ''} ${featured ? 'is-group' : ''} ${inBeef ? 'has-beef' : ''}`}
                    data-node-id={node.id}
                    style={{left: place.x - def.x + def.r - place.size / 2, top: place.y - def.y + def.r - place.size / 2,
                      ['--c' as string]: place.color, ['--s' as string]: `${place.size}px`,
                      ['--dx' as string]: `${drift.x}px`, ['--dy' as string]: `${drift.y}px`,
                      ['--ddur' as string]: `${drift.duration}s`, ['--ddelay' as string]: `${drift.delay}s`,
                      zIndex: zoneLit ? 5 : undefined}}
                    onClick={() => { if (suppressClick.current) return; onSelect(node.id); }}
                    onMouseEnter={() => setHover(node.id)} onMouseLeave={() => setHover(null)}
                    title={`${node.name} · ${provinceLabel(provinceOf(node.city))}`}>
                    <span className="bn-focus-base" aria-hidden="true" />
                    <span className="bn-pic"><Avatar node={node} thumbnail />
                      {featured && <span className="bn-flag">CREW</span>}
                      {inBeef && <span className="bn-beef-ring" aria-hidden="true" />}
                      {inBeef && <span className="bn-beef-flag">⚡BEEF</span>}
                    </span>
                    <span className="bn-name" style={{fontSize: latin ? (node.name.length > 9 ? 9 : 10) : place.dense ? 9.5 : 11}}>
                      {node.name}
                    </span>
                  </button>;
                })}
                </div>
              </div>
            </div>;
          })}

          {/* 透视地面压在省份框之上、连线与节点之下：有焦点时才显影，不接收指针事件。 */}
          <div className="board-floor" aria-hidden="true" />

          <svg className="board-edges" width={world.width} height={world.height} viewBox={`0 0 ${world.width} ${world.height}`} aria-hidden="true">
            {/* 焦点线先垫一层深色描边：暖色细线压在斑块和头像的杂色底上会糊掉，
                垫一圈暗底之后线身无论压到什么背景都有清晰轮廓。 */}
            <g className="edge-casing" aria-hidden="true">
              {orderedEdges.filter(edge => isFocusEdge(edge) || isPathEdge(edge)).map(edge => (
                <path key={`casing-${edge.id}`} d={edgePaths.get(edge.id)}
                  fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round"
                  strokeWidth={edge.type === 'affiliation' ? 3.4 : 5.6} className="edge-casing-line" />
              ))}
            </g>
            {orderedEdges.map(edge => {
              const focus = isFocusEdge(edge);
              const onPath = isPathEdge(edge);
              const color = relationMeta[edge.type].color;
              const strong = hotEdges.has(edge.id);
              const inspected = !!hover && hover!==selected && (edge.source===hover || edge.target===hover);
              // 省份 hover：只让与该省直连的线发亮，其余压到近乎不可见。
              const zoneEdge = !!activeProvince && (
                positions.get(edge.source)?.province === activeProvince ||
                positions.get(edge.target)?.province === activeProvince
              );
              // 厂牌线是波浪线（合约的起伏），其余是单线；波浪本身已有形态差，线宽只略微加强。
              const wobble = edge.type === 'affiliation';
              return <g key={edge.id} data-source={edge.source} data-target={edge.target} data-relation={edge.type}>
                <path d={edgePaths.get(edge.id)} fill="none" vectorEffect="non-scaling-stroke"
                  stroke={onPath ? '#ffffff' : color}
                  strokeWidth={(inspected ? 3.4 : onPath ? 3 : focus ? 2.5 : 1.35) * (wobble ? 1.25 : 1)}
                  strokeOpacity={inspected ? 1 : hover && selected && hover!==selected ? .26 : onPath ? .98 : focus ? .95 : zoneFocus ? .16 : .55}
                  strokeDasharray={edgeDash(edge.type)}
                  strokeLinecap="round"
                  style={{color: onPath ? '#ffffff' : color}}
                  className={focus || onPath ? `edge-live edge-focus ${onPath ? 'edge-path' : ''}` : zoneEdge ? 'edge-zone-live' : focusId ? 'edge-rest' : inspected ? 'edge-hover' : 'edge-main'} />
              </g>;
            })}
            {/* Selected person: light runs along every connected line, inward toward the face. */}
            {selected && edges.filter(edge => hotEdges.has(edge.id)).slice(0,8).map((edge, index) => {
              // 省份降噪时，选中人物的流光若落在无关省份也一起隐去。
              if (zoneFocus && !zoneFocus.has(positions.get(edge.source)?.province || '') && !zoneFocus.has(positions.get(edge.target)?.province || '')) return null;
              const color = relationMeta[edge.type].color;
              // 波浪线只有 A→B 一个方向的路径，反向流动靠 animation-direction 翻转。
              const wobble = edge.type === 'affiliation';
              const inward = edge.target === selected;
              // Edges are drawn from the alphabetically-first end; reverse when needed so the
              // dash flow always travels *into* the selected node.
              const d = wobble ? edgePaths.get(edge.id)
                : inward
                  ? edgePath(edge)
                  : `M${edge.bx.toFixed(1)},${edge.by.toFixed(1)} Q${edge.cx.toFixed(1)},${edge.cy.toFixed(1)} ${edge.ax.toFixed(1)},${edge.ay.toFixed(1)}`;
              return <g key={`flow-${edge.id}`} style={{['--c' as string]: color}}>
                <path d={d} fill="none" stroke={color} strokeWidth={4} strokeOpacity={0.09} strokeLinecap="round" />
                <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinecap="round" className="edge-flow"
                  style={{animationDelay: `${(index % 7) * 0.17}s`, animationDuration: `${1.85 + (index % 3) * 0.4}s`,
                    animationDirection: wobble && !inward ? 'reverse' : undefined}} />
              </g>;
            })}
            {labelItems.map(item => (
              <g key={`label-${item.id}`} transform={`translate(${item.x.toFixed(1)},${item.y.toFixed(1)})`} opacity={item.focus ? 1 : 0.8}>
                <rect x={-item.width / 2} y={-8} width={item.width} height={16} rx={3} fill="#070b12" stroke={item.color} strokeOpacity={item.focus ? 0.95 : 0.5} />
                <text textAnchor="middle" y={3.4} fill={item.color} fontSize={9.5} fontFamily="'JetBrains Mono','Microsoft YaHei',monospace" letterSpacing="0.6">{item.text}</text>
              </g>
            ))}

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
          return <button key={type} data-type={type} className={on ? 'on' : ''} style={{['--c' as string]: meta.color}}
            onClick={() => onToggleType(type)} title={`${meta.label} ${meta.tag}`} aria-pressed={on}>
            <i className="rail-line" /><span>{meta.tag}</span>
          </button>;
        })}
      </div>
      <div className="rail-group">
        <button onClick={onLocate} title="地域待考据名单"><Search size={15} /><span>?</span></button>
        <button onClick={resetArrangement} title="恢复初始布局（取消手动拖动的省份）"><LayoutGrid size={15} /><span>复位</span></button>
        <button onClick={fit} title="缩放至整张地图"><RotateCcw size={15} /><span>FIT</span></button>
      </div>
      <div className="rail-meter">
        <Sparkles size={12} />
        <b>{edges.length}</b>
        <small>LINKS</small>
      </div>
    </div>

    <div className="board-title">
      <h2>中文说唱圈关系网</h2>
      <p>{narrow ? '拖动斑块重排 · 双指缩放 · 搜索定位人物' : '文化地形示意 · 拖动省份块自由重排 · 点击放大 · 选中人物看关系'}</p>
    </div>

    <div className="board-timeline">
      <div className="bt-legend" aria-label="关系类型">
        {(Object.keys(relationMeta) as RelationType[]).map(type => {
          const meta = relationMeta[type];
          const on = types.includes(type);
          return <button key={type} data-type={type} className={on ? 'on' : ''} style={{['--c' as string]: meta.color}}
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
