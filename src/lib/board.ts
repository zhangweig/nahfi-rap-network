import type {ArtistNode, RelationType} from '../data/types';
import {ALL_PROVINCES, PROVINCE_NAMES, UNKNOWN_PROVINCE, provinceOf, provinceSpots} from './province';

/** The board is a flat design space; the viewport scales it to fit. */
export const BOARD = {width: 1180, height: 660};

/** 斑块之间至少留这么多空白，保证虚线轮廓永不粘连。 */
const ZONE_GAP = 24;
/** 空省份的最小占位半径。 */
const EMPTY_R = 20;
/** 斑块半径 ∝ √人数：面积随人数线性增长，形状由人数决定。 */
const rOf = (count: number) => 26 + 11.2 * Math.sqrt(count);

/**
 * 不规则斑块：同一省份永远生成同一个形状（种子 = 省份名）。
 * 轮廓是闭合的三次贝塞尔，半径由两条不同频率的正弦叠加，再归一化到 1，
 * 这样最外点恰好落在半径 r 上 —— 碰撞检测与视觉边界完全一致。
 */
interface BlobShape {d: string; radial: number[]}
const SHAPE_SAMPLES = 20;
const shapeCache = new Map<string, BlobShape>();

const blobShape = (key: string): BlobShape => {
  const cached = shapeCache.get(key);
  if (cached) return cached;
  const rng = seededRng(`blob|${key}`);
  const phase = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  // 两个不同频率的谐波叠加：低频给"大瓣"，高频给手绘毛边。
  // 低频固定 3 波（2 波会变成鸡蛋），高频 5-6 波。
  const amp1 = 0.13 + rng() * 0.11;
  const amp2 = 0.05 + rng() * 0.07;
  const k1 = 3;
  const k2 = 5 + Math.floor(rng() * 2);
  let radial = Array.from({length: SHAPE_SAMPLES}, (_, index) => {
    const t = (index / SHAPE_SAMPLES) * Math.PI * 2;
    return 1 - amp1 * (0.5 - 0.5 * Math.cos(k1 * t + phase)) - amp2 * (0.5 - 0.5 * Math.sin(k2 * t + phase2));
  });
  // 不再额外做平滑：Catmull-Rom 转贝塞尔本身就把 20 个采样点连成光滑曲线，
  // 再平滑一轮会把 3 瓣的低频起伏削掉（实测振幅只剩 9%），轮廓就退化成圆了。
  const peak = Math.max(...radial);
  radial = radial.map(value => value / peak);
  const radius = 100;
  const points = radial.map((value, index) => {
    const t = (index / SHAPE_SAMPLES) * Math.PI * 2;
    return [100 + Math.cos(t) * value * radius, 100 + Math.sin(t) * value * radius];
  });
  let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let index = 0; index < SHAPE_SAMPLES; index += 1) {
    const p0 = points[(index - 1 + SHAPE_SAMPLES) % SHAPE_SAMPLES];
    const p1 = points[index];
    const p2 = points[(index + 1) % SHAPE_SAMPLES];
    const p3 = points[(index + 2) % SHAPE_SAMPLES];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const shape = {d: `${d}Z`, radial};
  shapeCache.set(key, shape);
  return shape;
};

/** 形状在角度 θ 上的半径系数（0..1），用于把人物撒在轮廓内。 */
const radialAt = (shape: BlobShape, theta: number) => {
  const total = shape.radial.length;
  const turns = (((theta / (Math.PI * 2)) % 1) + 1) % 1;
  const exact = turns * total;
  const index = Math.floor(exact) % total;
  const next = (index + 1) % total;
  const k = exact - Math.floor(exact);
  return shape.radial[index] * (1 - k) + shape.radial[next] * k;
};

export interface ZoneDef {
  province: string;
  code: string;
  color: string;
  /** 斑块中心（世界坐标）。 */
  x: number;
  y: number;
  /** 斑块半径，面积 ∝ 人数。 */
  r: number;
  /** SVG 路径，坐标系 0 0 200 200，最外点正好 200 的内切圆。 */
  shape: string;
  /** 地域待考据：浅色虚线大岛。 */
  mini?: boolean;
  /** 还没有定位到人，只留一个点。 */
  empty?: boolean;
}

export interface ZoneView {
  def: ZoneDef;
  count: number;
}

export interface NodePlace {
  x: number;
  y: number;
  size: number;
  province: string;
  mini: boolean;
  color: string;
  /** 头像太小，名字牌只在放大/悬停时出现。 */
  dense: boolean;
}

/** Short codes + warm colors. Provinces with located artists get a distinct hue; the rest stay slate. */
const PROVINCE_CODE: Record<string, string> = {
  北京: 'BJ', 天津: 'TJ', 河北: 'HE', 山西: 'SX', 内蒙古: 'NM', 辽宁: 'LN', 吉林: 'JL', 黑龙江: 'HL',
  上海: 'SH', 江苏: 'JS', 浙江: 'ZJ', 安徽: 'AH', 福建: 'FJ', 江西: 'JX', 山东: 'SD', 河南: 'HA',
  湖北: 'HB', 湖南: 'HN', 广东: 'GD', 广西: 'GX', 海南: 'HI', 重庆: 'CQ', 四川: 'SC', 贵州: 'GZ',
  云南: 'YN', 西藏: 'XZ', 陕西: 'SA', 甘肃: 'GS', 青海: 'QH', 宁夏: 'NX', 新疆: 'XJ',
  香港: 'HK', 澳门: 'MO', 台湾: 'TW',
};
/* FLOWLINE warm palette — low-saturation earth/ochre tones keep provinces distinguishable */
const PROVINCE_COLOR: Record<string, string> = {
  四川: '#e4572e', 重庆: '#d9a05b', 湖南: '#b8703a', 新疆: '#c96f3f', 上海: '#e08a5c', 福建: '#a85d4a',
  陕西: '#d4563a', 江苏: '#c9a873', 广东: '#9c8555', 吉林: '#b5626a', 台湾: '#c98f6a', 北京: '#e0b877',
};
const EMPTY_COLOR = '#6b6358';
const ARCHIVE_COLOR = '#9a8f7d';

/** Deterministic per-province RNG so the "hand placed" look survives every render. */
function seededRng(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export interface BoardLayout {
  zones: ZoneView[];
  positions: Map<string, NodePlace>;
  world: {width: number; height: number};
}

interface ZoneSeed {
  province: string;
  count: number;
  mini: boolean;
  r: number;
  x: number;
  y: number;
  ax: number;
  ay: number;
}

/**
 * 斑块地图：每个省份是一块由人数决定大小的不规则斑块。
 * 位置从一个"方位锚点"出发（省会经纬度的简化投影），再用圆-圆松弛把互相挤压的斑块
 * 推开到刚好不相交 —— 于是地图既保留真实方位（新疆在西、黑龙江在北、广东在南），
 * 又是紧凑的一大团，不会像台账表格那样彼此隔得很远。
 * 省份块的位置与形状只和「人数 + 省份名」有关，选中人物不会让地图重排。
 */
export function boardLayout(nodes: ArtistNode[], filter: string, narrow = false, degree?: Map<string, number>): BoardLayout {
  const groups = new Map<string, ArtistNode[]>();
  for (const node of nodes) {
    const province = provinceOf(node.city);
    if (filter !== ALL_PROVINCES && province !== filter) continue;
    const list = groups.get(province) || [];
    list.push(node);
    groups.set(province, list);
  }

  const solo = filter !== ALL_PROVINCES;
  const provinces = solo ? [filter] : [...PROVINCE_NAMES, UNKNOWN_PROVINCE];
  const seeds: ZoneSeed[] = provinces.map(province => {
    const count = (groups.get(province) || []).length;
    const spot = provinceSpots[province] || provinceSpots[UNKNOWN_PROVINCE];
    // 单省视图：只有一块斑块，放大到舒服的阅读尺寸。
    const r = count === 0 ? EMPTY_R : solo ? Math.min(320, Math.max(96, rOf(count) * 1.7)) : rOf(count);
    // 锚点压缩：真实经纬投影里的空档太大，压一点才像一张紧凑的文化地图；
    // 纵向压得更狠一些，让整张图是横构图，正好铺满宽屏。
    const ax = solo ? 0 : spot.x * 0.94;
    const ay = solo ? 0 : spot.y * 0.74;
    return {province, count, mini: province === UNKNOWN_PROVINCE, r, x: ax, y: ay, ax, ay};
  });

  if (!solo) {
    // 圆-圆松弛：把重叠的斑块推开，同时用弱弹簧拽回地理锚点（保住方位）。
    for (let pass = 0; pass < 320; pass += 1) {
      let moved = false;
      for (let i = 0; i < seeds.length; i += 1) {
        for (let j = i + 1; j < seeds.length; j += 1) {
          const a = seeds[i];
          const b = seeds[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const min = a.r + b.r + ZONE_GAP;
          let dist = Math.hypot(dx, dy);
          if (dist >= min) continue;
          if (dist < 0.5) {
            // 锚点几乎重合（如京津、港澳）：用一个固定偏移把它们掰开。
            const nudge = 1 + (i * 7 + j * 13) % 5;
            dx = Math.cos(nudge) * 6;
            dy = Math.sin(nudge) * 6;
            dist = Math.hypot(dx, dy);
          }
          const push = (min - dist) / 2;
          const ux = dx / dist, uy = dy / dist;
          a.x -= ux * push; a.y -= uy * push;
          b.x += ux * push; b.y += uy * push;
          moved = true;
        }
      }
      for (const seed of seeds) {
        seed.x += (seed.ax - seed.x) * 0.028;
        seed.y += (seed.ay - seed.y) * 0.028;
      }
      if (!moved) break;
    }
  }

  const positions = new Map<string, NodePlace>();
  const zones: ZoneView[] = [];

  for (const seed of seeds) {
    const people = groups.get(seed.province) || [];
    const def: ZoneDef = {
      province: seed.province,
      code: seed.mini ? 'ARCHIVE' : PROVINCE_CODE[seed.province] || '?',
      color: seed.mini ? ARCHIVE_COLOR : seed.count ? (PROVINCE_COLOR[seed.province] || EMPTY_COLOR) : EMPTY_COLOR,
      x: seed.x, y: seed.y, r: seed.r,
      shape: blobShape(seed.province).d,
      mini: seed.mini,
      empty: seed.count === 0,
    };
    placeBlob(def, people, positions, degree);
    zones.push({def, count: seed.count});
  }

  // 世界尺寸：包住所有斑块 + 给轮廓外的省份标签留一条边。
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const zone of zones) {
    minX = Math.min(minX, zone.def.x - zone.def.r);
    minY = Math.min(minY, zone.def.y - zone.def.r);
    maxX = Math.max(maxX, zone.def.x + zone.def.r);
    maxY = Math.max(maxY, zone.def.y + zone.def.r);
  }
  const pad = 46;
  const shiftX = pad - minX;
  const shiftY = pad + 16 - minY;
  for (const zone of zones) { zone.def.x += shiftX; zone.def.y += shiftY; }
  for (const place of positions.values()) { place.x += shiftX; place.y += shiftY; }

  return {
    zones, positions,
    world: {
      width: Math.round(Math.max(BOARD.width * 0.72, maxX - minX + pad * 2)),
      height: Math.round(Math.max(BOARD.height * 0.62, maxY - minY + pad * 2 + 16)),
    },
  };
}

/**
 * 框内人物：在斑块轮廓内做 best-candidate 采样（蓝噪声），
 * 结果是「随机但互不重叠」的散布，而不是网格。
 * 头像尺寸由可用间距决定，所以人多的省自然头像小、人少的省头像大。
 */
function placeBlob(def: ZoneDef, people: ArtistNode[], positions: Map<string, NodePlace>, degree?: Map<string, number>) {
  const count = people.length;
  if (!count) return;
  const rng = seededRng(`scatter|${def.province}|${count}`);
  const shape = blobShape(def.province);
  const ordered = [...people].sort((a, b) => {
    const groupA = a.kind === 'group' ? 0 : 1;
    const groupB = b.kind === 'group' ? 0 : 1;
    return groupA - groupB || a.name.localeCompare(b.name, 'zh-CN');
  });

  // 可用面积按轮廓内缩 0.78 估算；间距由人数决定。
  // 0.76 的系数是刻意留白：头像之间要能透出底色，斑块才像"星图"而不是色块。
  const usable = Math.PI * def.r * def.r * 0.55;
  const separation = count > 1 ? Math.sqrt(usable / count) : def.r * 0.9;
  const base = Math.max(11, Math.min(26, separation * 0.76, def.r * 0.56));

  const points: {x: number; y: number}[] = [];
  for (let index = 0; index < count; index += 1) {
    let best = {x: 0, y: 0, gap: -1};
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const theta = rng() * Math.PI * 2;
      const reach = Math.sqrt(rng()) * radialAt(shape, theta) * 0.82 * def.r;
      const x = Math.cos(theta) * reach;
      const y = Math.sin(theta) * reach;
      let gap = Infinity;
      for (const point of points) {
        const d = Math.hypot(point.x - x, point.y - y);
        if (d < gap) gap = d;
        if (gap <= best.gap) break;
      }
      // 取所有候选里"离别人最远"的那个，而不是第一个达标的：
      // 提前收手会让结果偏向随机方向，斑块里就出现一块密一块空。
      if (gap > best.gap) best = {x, y, gap};
    }
    points.push({x: best.x, y: best.y});
  }

  ordered.forEach((node, index) => {
    const point = points[index];
    // 关系多的人略大一圈：地图上自然长出几个"枢纽"，与参考图里的大圆点同构。
    const weight = 1 + Math.min(0.4, (degree?.get(node.id) || 0) / 46);
    const size = Math.round(Math.min(def.r * 0.8, base * weight) * 10) / 10;
    positions.set(node.id, {
      x: def.x + point.x,
      y: def.y + point.y,
      size,
      province: def.province,
      mini: !!def.mini,
      color: def.color,
      dense: size < 13,
    });
  });
}

export const relationMeta: Record<RelationType, {label: string; tag: string; color: string}> = {
  member: {label: '组合成员', tag: 'CREW', color: '#e4572e'},
  collaboration: {label: '歌曲合作', tag: 'FEAT', color: '#d9a05b'},
  production: {label: '幕后制作', tag: 'PROD', color: '#b8703a'},
  // 厂牌签约单独一支冷色：四条线型里只有它是暖色系之外的，扫一眼就能分出来。
  affiliation: {label: '厂牌签约', tag: 'LABEL', color: '#6fb3a6'},
};

/** 每条关系的线型：实线 / 长虚 / 点线 / 波浪（厂牌）。 */
export const edgeDash = (type: RelationType): string | undefined =>
  type === 'member' ? undefined : type === 'collaboration' ? '6 5' : type === 'production' ? '2 4' : undefined;

/**
 * 厂牌波浪线：沿二次曲线等距采样，按法线做正弦位移。
 * 波数取整，两端用 fade 收拢，保证线头仍精确落在两个人的头像上，
 * 不会因为相位差在端点处跳开。用折线采样（约 5px 一段）而不是弧线逼近，
 * 是因为 non-scaling-stroke 下波浪的密度要跟曲线弧长走，折线最好控。
 */
export const edgePathWave = (edge: BoardEdge, amplitude = 3.9, wavelength = 30) => {
  const {ax, ay, cx, cy, bx, by} = edge;
  const rough = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy) || 1;
  const steps = Math.max(18, Math.min(180, Math.round(rough / 5)));
  // 波数取整：t=0 与 t=1 的相位都归零，端点才落在原始曲线上。
  const waves = Math.max(1, Math.round(rough / wavelength));
  let path = '';
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const it = 1 - t;
    const x = it * it * ax + 2 * it * t * cx + t * t * bx;
    const y = it * it * ay + 2 * it * t * cy + t * t * by;
    const tx = 2 * it * (cx - ax) + 2 * t * (bx - cx);
    const ty = 2 * it * (cy - ay) + 2 * t * (by - cy);
    const len = Math.hypot(tx, ty) || 1;
    const fade = Math.min(1, Math.min(t, 1 - t) / 0.14);
    const offset = Math.sin(t * Math.PI * 2 * waves) * amplitude * fade;
    const px = x + (-ty / len) * offset;
    const py = y + (tx / len) * offset;
    path += `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
  }
  return path;
};

export const relationYear = (relation: {track?: {year?: number}; observedYear?: number; startYear?: number}) =>
  relation.track?.year ?? relation.observedYear ?? relation.startYear ?? null;

export interface BoardEdge {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  count: number;
  year: number | null;
  labels: string[];
  /** Quadratic control point, pre-computed for drawing and label placement. */
  ax: number; ay: number; bx: number; by: number; cx: number; cy: number;
}

const hash = (value: string) => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) % 997;
  return h;
};

export function buildEdges(
  data: {nodes: ArtistNode[]; relations: any[]},
  types: RelationType[],
  filter: string,
  year: number | null,
  positions: Map<string, NodePlace>,
): BoardEdge[] {
  const allowed = new Set<string>(positions.keys());
  const bundles = new Map<string, BoardEdge>();
  for (const relation of data.relations) {
    if (!types.includes(relation.type)) continue;
    if (!allowed.has(relation.source) || !allowed.has(relation.target)) continue;
    const [source, target] = [relation.source, relation.target].sort();
    const key = `${source}|${target}|${relation.type}`;
    const existing = bundles.get(key);
    if (existing) {
      existing.count += 1;
      existing.labels.push(relation.label);
      const y = relationYear(relation);
      if (y && (existing.year === null || y < existing.year)) existing.year = y;
      continue;
    }
    bundles.set(key, {
      id: key, source, target, type: relation.type, count: 1,
      year: relationYear(relation), labels: [relation.label],
      ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0,
    });
  }

  const edges: BoardEdge[] = [];
  for (const edge of bundles.values()) {
    const a = positions.get(edge.source);
    const b = positions.get(edge.target);
    if (!a || !b) continue;
    if (year !== null && (edge.year === null || edge.year > year)) continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const sameZone = a.province === b.province;
    const bow = sameZone ? 22 + (hash(edge.id) % 4) * 10 : ((hash(edge.id) % 9) - 4) * 14;
    edge.ax = a.x; edge.ay = a.y; edge.bx = b.x; edge.by = b.y;
    edge.cx = (a.x + b.x) / 2 + (-dy / len) * bow;
    edge.cy = (a.y + b.y) / 2 + (dx / len) * bow;
    edges.push(edge);
  }
  return edges;
}

export const edgePath = (edge: BoardEdge) =>
  `M${edge.ax.toFixed(1)},${edge.ay.toFixed(1)} Q${edge.cx.toFixed(1)},${edge.cy.toFixed(1)} ${edge.bx.toFixed(1)},${edge.by.toFixed(1)}`;

/** Point on the quadratic curve at t=.5, used to pin the relation label. */
export const edgeMid = (edge: BoardEdge) => ({
  x: (edge.ax + 2 * edge.cx + edge.bx) / 4,
  y: (edge.ay + 2 * edge.cy + edge.by) / 4,
});

/**
 * BEEF 链的锯齿/闪电折线：沿二次曲线采样，逐点沿法线交替偏移，形成电流感的折线。
 * 与普通关系的平滑曲线形成强对比，让 beef 在 526 条暖色线里一眼可辨。
 * amplitude 与段数由线长决定，短链也至少有 6 个齿。
 */
export const beefPath = (a: {x: number; y: number}, b: {x: number; y: number}, c: {x: number; y: number}) => {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(6, Math.min(28, Math.round(dist / 16)));
  const amp = Math.min(9, Math.max(5, dist / 40));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const it = 1 - t;
    // 曲线上的点
    const px = it * it * a.x + 2 * it * t * c.x + t * t * b.x;
    const py = it * it * a.y + 2 * it * t * c.y + t * t * b.y;
    // 曲线切线 → 法线
    let dx = 2 * it * (c.x - a.x) + 2 * t * (b.x - c.x);
    let dy = 2 * it * (c.y - a.y) + 2 * t * (b.y - c.y);
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    // 端点不偏移（要接在头像上），中间点交替正负
    const offset = i === 0 || i === steps ? 0 : (i % 2 === 0 ? amp : -amp);
    pts.push(`${(px + nx * offset).toFixed(1)},${(py + ny * offset).toFixed(1)}`);
  }
  return `M${pts.join(' L')}`;
};

export const firstYearOf = (nodeId: string, relations: any[]) => {
  let best: number | null = null;
  for (const relation of relations) {
    if (relation.source !== nodeId && relation.target !== nodeId) continue;
    const y = relationYear(relation);
    if (y && (best === null || y < best)) best = y;
  }
  return best;
};
