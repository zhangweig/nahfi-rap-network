import type {ArtistNode, RelationType} from '../data/types';
import {ALL_PROVINCES, PROVINCE_NAMES, UNKNOWN_PROVINCE, provinceOf} from './province';

/** The board is a flat design space; the viewport scales it to fit. */
export const BOARD = {width: 1260, height: 650};

/** Minimum canvas — real size grows with the number of people so no zone gets squeezed. */
const RECT = {x: 56, y: 56, w: 1148, h: 586};

/** Every artist gets this much design space; a province box is the sum of its members. */
const AREA_PER_PERSON = 2450;
/** Header + breathing room for one box, regardless of headcount. */
const AREA_PER_ZONE = 7200;
/** Keep the canvas close to the original aspect ratio as it grows. */
const CANVAS_RATIO = BOARD.width / BOARD.height;

export interface ZoneDef {
  province: string;
  code: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Archive card wall with compact tiles. */
  mini?: boolean;
  /** No artist located here yet — dim placeholder. */
  empty?: boolean;
  /** Too small for the full name tag. */
  tiny?: boolean;
  /** Seeded corner radius so zones don't share one uniform shape. */
  radius?: number;
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
  /** Name plate width cap so neighbours never collide. */
  labelW: number;
  /** Dense zones get a smaller label. */
  dense: boolean;
  /** Cell too narrow for a name plate unless focused. */
  tight: boolean;
  /** Name plate line budget. */
  lines: 1 | 2;
}

/** Short codes + neon colors. Provinces with located artists get a distinct hue; the rest stay slate. */
const PROVINCE_CODE: Record<string, string> = {
  北京: 'BJ', 天津: 'TJ', 河北: 'HE', 山西: 'SX', 内蒙古: 'NM', 辽宁: 'LN', 吉林: 'JL', 黑龙江: 'HL',
  上海: 'SH', 江苏: 'JS', 浙江: 'ZJ', 安徽: 'AH', 福建: 'FJ', 江西: 'JX', 山东: 'SD', 河南: 'HA',
  湖北: 'HB', 湖南: 'HN', 广东: 'GD', 广西: 'GX', 海南: 'HI', 重庆: 'CQ', 四川: 'SC', 贵州: 'GZ',
  云南: 'YN', 西藏: 'XZ', 陕西: 'SA', 甘肃: 'GS', 青海: 'QH', 宁夏: 'NX', 新疆: 'XJ',
  香港: 'HK', 澳门: 'MO', 台湾: 'TW',
};
const PROVINCE_COLOR: Record<string, string> = {
  四川: '#ff3d6e', 重庆: '#ffc93c', 湖南: '#35ff9e', 新疆: '#ff8a3d', 上海: '#35d6ff', 福建: '#b07cff',
  陕西: '#ff5964', 江苏: '#4f7cff', 广东: '#b8f135', 吉林: '#ff4dd8', 台湾: '#5ee0c8', 北京: '#f4d35e',
};
const EMPTY_COLOR = '#42607a';
const ARCHIVE_COLOR = '#8ea8bd';

interface Rect {x: number; y: number; w: number; h: number}

interface Weighted<T> {item: T; area: number}

/** Squarified treemap: area ∝ weight, aspect ratios kept as close to 1 as possible. */
function squarify<T>(items: T[], weight: (item: T) => number, rect: Rect): [T, Rect][] {
  const total = items.reduce((sum, item) => sum + weight(item), 0);
  if (!items.length || total <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const rest: Weighted<T>[] = items
    .map(item => ({item, area: weight(item) * scale}))
    .sort((a, b) => b.area - a.area);
  const out: [T, Rect][] = [];
  let {x, y, w, h} = rect;

  const worst = (areas: number[], side: number) => {
    const sum = areas.reduce((a, b) => a + b, 0);
    const thickness = sum / side;
    let max = 0;
    for (const area of areas) {
      const len = area / thickness;
      max = Math.max(max, thickness / len, len / thickness);
    }
    return max;
  };

  while (rest.length) {
    const side = Math.min(w, h);
    const row: Weighted<T>[] = [rest.shift()!];
    while (rest.length) {
      const current = worst(row.map(r => r.area), side);
      const next = worst([...row.map(r => r.area), rest[0].area], side);
      if (next > current) break;
      row.push(rest.shift()!);
    }
    const rowArea = row.reduce((sum, r) => sum + r.area, 0);
    const thickness = rowArea / side;
    let offset = 0;
    for (const r of row) {
      const len = r.area / thickness;
      out.push(w >= h
        ? [r.item, {x, y: y + offset, w: thickness, h: len}]
        : [r.item, {x: x + offset, y, w: len, h: thickness}]);
      offset += len;
    }
    if (w >= h) {x += thickness; w -= thickness;} else {y += thickness; h -= thickness;}
  }
  return out;
}

const GAP = 4;

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

/**
 * Every one of the 34 province-level regions gets a zone; its area is proportional to how
 * many artists are located there. Regions without anyone stay visible as dim placeholders.
 * The archive zone （地域待考据） gets a fixed weight so it stays usable without dwarfing the map.
 */
export function boardLayout(nodes: ArtistNode[], filter: string, narrow = false): BoardLayout {
  const visible = nodes.filter(node => filter === ALL_PROVINCES || provinceOf(node.city) === filter);
  const groups = new Map<string, ArtistNode[]>();
  for (const node of visible) {
    const province = provinceOf(node.city);
    groups.set(province, [...(groups.get(province) || []), node]);
  }

  interface ZoneSeed {
    province: string;
    weight: number;
    count: number;
    mini: boolean;
  }
  const seeds: ZoneSeed[] = [];
  for (const province of PROVINCE_NAMES) {
    const count = (groups.get(province) || []).length;
    if (filter !== ALL_PROVINCES && province !== filter) continue;
    if (filter === ALL_PROVINCES || count > 0 || true) {
      // 框面积随人数线性增长；空省份只保留一个最小占位框。
      seeds.push({
        province, count, mini: false,
        weight: count > 0 ? AREA_PER_ZONE + count * AREA_PER_PERSON : AREA_PER_ZONE * 0.16,
      });
    }
  }
  const archive = groups.get(UNKNOWN_PROVINCE) || [];
  if (archive.length && (filter === ALL_PROVINCES || filter === UNKNOWN_PROVINCE)) {
    // 不设上限：待考据有 110 人，框就该装下 110 人。
    seeds.push({
      province: UNKNOWN_PROVINCE, count: archive.length, mini: true,
      weight: AREA_PER_ZONE + archive.length * AREA_PER_PERSON,
    });
  }

  const positions = new Map<string, NodePlace>();
  const zones: ZoneView[] = [];

  if (narrow) {
    // Phones: a vertical stack sorted by headcount — full-width rows, four columns.
    const width = 660;
    let y = 64;
    const ordered = [...seeds].sort((a, b) => b.count - a.count);
    for (const seed of ordered) {
      const people = groups.get(seed.province) || [];
      const cols = seed.mini ? 4 : Math.min(4, Math.max(1, seed.count));
      const rows = Math.ceil(people.length / cols);
      const height = seed.count === 0 ? 48 : 58 + rows * (seed.mini ? 108 : 122) + 10;
      const def: ZoneDef = {
        province: seed.province, code: seed.mini ? 'ARCHIVE' : PROVINCE_CODE[seed.province] || '?',
        color: seed.mini ? ARCHIVE_COLOR : seed.count ? (PROVINCE_COLOR[seed.province] || EMPTY_COLOR) : EMPTY_COLOR,
        x: 30, y, w: width - 60, h: height, mini: seed.mini, empty: seed.count === 0,
      };
      y += height + 14;
      placeNodes(def, people, seed.count, cols, rows, positions);
      zones.push({def, count: seed.count});
    }
    return {zones, positions, world: {width, height: y + 20}};
  }

  // A single province keeps a comfortable card size instead of stretching edge to edge.
  const totalWeight = seeds.reduce((sum, seed) => sum + seed.weight, 0);
  const boardRatio = filter === ALL_PROVINCES ? CANVAS_RATIO : 1.6;
  const worldW = Math.max(BOARD.width, Math.round(Math.sqrt(totalWeight * boardRatio)));
  const worldH = Math.max(BOARD.height, Math.round(Math.sqrt(totalWeight / boardRatio)));
  const rect = filter === ALL_PROVINCES
    ? {x: GAP, y: GAP, w: worldW - GAP * 2, h: worldH - GAP * 2}
    : {x: GAP, y: GAP, w: worldW - GAP * 2, h: worldH - GAP * 2};
  const laid = squarify(seeds, seed => seed.weight, rect);
  for (const [seed, zoneRect] of laid) {
    // Scattered, hand-placed look: each zone shrinks and drifts inside its own cell,
    // so the treemap weighting stays intact but nothing lines up on a grid.
    const rng = seededRng(seed.province + seed.count);
    const pad = Math.min(GAP / 2, zoneRect.w * 0.08, zoneRect.h * 0.08);
    const innerW = Math.max(0.5, zoneRect.w - pad * 2);
    const innerH = Math.max(0.5, zoneRect.h - pad * 2);
    // Never exceed the cell: slivers would otherwise spill into their neighbour.
    const w = innerW * (0.84 + rng() * 0.13);
    const h = innerH * (0.84 + rng() * 0.13);
    const x = zoneRect.x + pad + rng() * (innerW - w);
    const y = zoneRect.y + pad + rng() * (innerH - h);
    const def: ZoneDef = {
      province: seed.province,
      code: seed.mini ? 'ARCHIVE' : PROVINCE_CODE[seed.province] || '?',
      color: seed.mini ? ARCHIVE_COLOR : seed.count ? (PROVINCE_COLOR[seed.province] || EMPTY_COLOR) : EMPTY_COLOR,
      x, y, w, h,
      mini: seed.mini,
      empty: seed.count === 0,
      tiny: w < 108 || h < 74,
      radius: 6 + Math.round(rng() * 14),
    };
    const people = groups.get(seed.province) || [];
    const count = people.length;
    const cols = count
      ? Math.max(1, Math.min(seed.mini ? 6 : 5, Math.round(Math.sqrt(count * (w / h))) || 1))
      : 1;
    const rows = Math.ceil(count / cols);
    placeNodes(def, people, count, cols, rows, positions);
    zones.push({def, count});
  }

  return {zones, positions, world: {width: worldW, height: worldH}};
}

function placeNodes(
  def: ZoneDef,
  people: ArtistNode[],
  count: number,
  cols: number,
  rows: number,
  positions: Map<string, NodePlace>,
) {
  if (!count) return;
  const ordered = [...people].sort((a, b) => {
    const groupA = a.kind === 'group' ? 0 : 1;
    const groupB = b.kind === 'group' ? 0 : 1;
    return groupA - groupB || b.name.length - a.name.length;
  });
  const padX = def.mini ? 12 : 12;
  const headH = def.mini ? 40 : def.tiny ? 30 : 42;
  const padY = def.mini ? 8 : 12;
  const cellW = (def.w - padX * 2) / cols;
  const cellH = (def.h - headH - padY * 2) / rows;
  let size = def.mini
    ? Math.min(52, Math.max(30, Math.min(cellW, cellH) * 0.5))
    : Math.min(96, Math.max(22, Math.min(cellW, cellH) * 0.46));
  const dense = cellW < 74;
  /** Narrow cells drop the plate entirely; it appears on hover / selection. */
  const tight = cellW < 62;
  // 小省份的格子很窄，名字牌必须跟着收窄，否则会溢出框外压到邻居。
  // tight 格子默认只在 hover / 选中时显示名字，这里给一个不至于挤成竖排的安全下限。
  const labelW = tight ? 30 : Math.max(44, Math.min(132, cellW * 0.86));
  /** How many wrapped lines fit under the avatar without touching the next row. */
  let lines: 1 | 2 = cellH - size - 8 >= 28 ? 2 : 1;
  // Prefer a readable two-line plate over a bigger avatar.
  if (lines === 1 && cellH - size * 0.76 - 8 >= 26) {
    size = Math.round(size * 0.76);
    lines = 2;
  }
  const nodeRng = seededRng(def.province + count);
  ordered.forEach((node, index) => {
    const row = Math.floor(index / cols);
    const col = index % cols;
    const inRow = Math.min(cols, count - row * cols);
    // Slight organic scatter inside each cell — keeps plates readable, kills the spreadsheet feel.
    const jx = (nodeRng() - 0.5) * Math.min(10, cellW * 0.08);
    const jy = (nodeRng() - 0.5) * Math.min(8, cellH * 0.07);
    // 牌子以头像为中心展开，边缘列向框内收，避免伸到相邻省份框里。
    const halfPlate = tight ? 14 : Math.min(labelW / 2, 60);
    const rawX = def.x + padX + cellW * (col + (cols - inRow) / 2 + 0.5) + jx;
    const x = Math.min(Math.max(rawX, def.x + padX + halfPlate), def.x + def.w - padX - halfPlate);
    positions.set(node.id, {
      x,
      y: def.y + headH + padY + cellH * (row + 0.5) + jy,
      size,
      province: def.province,
      mini: !!def.mini,
      color: def.color,
      labelW,
      dense,
      tight,
      lines,
    });
  });
}

export const relationMeta: Record<RelationType, {label: string; tag: string; color: string}> = {
  member: {label: '组合成员', tag: 'CREW', color: '#35d6ff'},
  collaboration: {label: '歌曲合作', tag: 'FEAT', color: '#ffc93c'},
  production: {label: '幕后制作', tag: 'PROD', color: '#b07cff'},
  affiliation: {label: '厂牌关联', tag: 'TIES', color: '#35ff9e'},
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

export const firstYearOf = (nodeId: string, relations: any[]) => {
  let best: number | null = null;
  for (const relation of relations) {
    if (relation.source !== nodeId && relation.target !== nodeId) continue;
    const y = relationYear(relation);
    if (y && (best === null || y < best)) best = y;
  }
  return best;
};
