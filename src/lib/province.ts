import type {ArtistNode} from '../data/types';

/** Artists without a reliable province live on the archive island instead of being guessed. */
export const UNKNOWN_PROVINCE = '未定';
export const ALL_PROVINCES = '全部省份';

export type Theme = 'desert' | 'bamboo' | 'stone' | 'soil' | 'tea' | 'city' | 'mist' | 'plain';

export interface Spot {
  name: string;
  label: string;
  /** Approximate position only. This is a stylised settlement map, not a geographic outline. */
  x: number;
  y: number;
  theme: Theme;
}

/** World space is centred on 0,0 so the canvas can fit and centre without extra offsets. */
export const WORLD = {width: 1500, height: 820};

export const provinceSpots: Record<string, Spot> = {
  新疆: {name: '新疆', label: '新疆', x: -470, y: -40, theme: 'desert'},
  西藏: {name: '西藏', label: '西藏', x: -500, y: -250, theme: 'plain'},
  青海: {name: '青海', label: '青海', x: -360, y: -190, theme: 'plain'},
  甘肃: {name: '甘肃', label: '甘肃', x: -350, y: -40, theme: 'desert'},
  宁夏: {name: '宁夏', label: '宁夏', x: -255, y: -25, theme: 'plain'},
  内蒙古: {name: '内蒙古', label: '内蒙古', x: -170, y: -300, theme: 'plain'},
  陕西: {name: '陕西', label: '陕西', x: -245, y: 55, theme: 'plain'},
  山西: {name: '山西', label: '山西', x: -140, y: -35, theme: 'plain'},
  河北: {name: '河北', label: '河北', x: -80, y: -140, theme: 'plain'},
  北京: {name: '北京', label: '北京', x: -30, y: -185, theme: 'city'},
  天津: {name: '天津', label: '天津', x: 40, y: -155, theme: 'city'},
  辽宁: {name: '辽宁', label: '辽宁', x: 160, y: -235, theme: 'plain'},
  吉林: {name: '吉林', label: '吉林', x: 245, y: -310, theme: 'plain'},
  黑龙江: {name: '黑龙江', label: '黑龙江', x: 110, y: -355, theme: 'plain'},
  山东: {name: '山东', label: '山东', x: 130, y: -85, theme: 'plain'},
  河南: {name: '河南', label: '河南', x: -85, y: 65, theme: 'plain'},
  四川: {name: '四川', label: '四川', x: -350, y: 150, theme: 'bamboo'},
  重庆: {name: '重庆', label: '重庆', x: -180, y: 60, theme: 'stone'},
  湖北: {name: '湖北', label: '湖北', x: -25, y: 45, theme: 'plain'},
  湖南: {name: '湖南', label: '湖南', x: -150, y: 255, theme: 'soil'},
  江西: {name: '江西', label: '江西', x: 20, y: 185, theme: 'plain'},
  安徽: {name: '安徽', label: '安徽', x: 95, y: 35, theme: 'plain'},
  江苏: {name: '江苏', label: '江苏', x: 180, y: -45, theme: 'plain'},
  上海: {name: '上海', label: '上海', x: 290, y: 10, theme: 'city'},
  浙江: {name: '浙江', label: '浙江', x: 205, y: 105, theme: 'tea'},
  福建: {name: '福建', label: '福建', x: 250, y: 235, theme: 'tea'},
  台湾: {name: '台湾', label: '台湾', x: 430, y: 305, theme: 'tea'},
  广东: {name: '广东', label: '广东', x: 90, y: 305, theme: 'plain'},
  广西: {name: '广西', label: '广西', x: -55, y: 315, theme: 'plain'},
  贵州: {name: '贵州', label: '贵州', x: -235, y: 265, theme: 'plain'},
  云南: {name: '云南', label: '云南', x: -390, y: 295, theme: 'plain'},
  海南: {name: '海南', label: '海南', x: -25, y: 400, theme: 'tea'},
  香港: {name: '香港', label: '香港', x: 125, y: 345, theme: 'city'},
  澳门: {name: '澳门', label: '澳门', x: 75, y: 360, theme: 'city'},
  [UNKNOWN_PROVINCE]: {name: UNKNOWN_PROVINCE, label: '待考据之岛', x: 648, y: 120, theme: 'mist'},
};

/** Only used to group settlements. Cities never appear on the map itself. */
export const cityProvince: Record<string, string> = {
  成都: '四川', 绵阳: '四川', 重庆: '重庆', 长沙: '湖南', 喀什: '新疆', 乌鲁木齐: '新疆',
  福州: '福建', 厦门: '福建', 泉州: '福建', 上海: '上海', 北京: '北京', 天津: '天津',
  广州: '广东', 深圳: '广东', 珠海: '广东', 杭州: '浙江', 宁波: '浙江', 温州: '浙江',
  南京: '江苏', 苏州: '江苏', 无锡: '江苏', 武汉: '湖北', 郑州: '河南', 青岛: '山东',
  济南: '山东', 西安: '陕西', 昆明: '云南', 贵阳: '贵州', 南宁: '广西', 海口: '海南',
  合肥: '安徽', 南昌: '江西', 太原: '山西', 石家庄: '河北', 兰州: '甘肃', 西宁: '青海',
  银川: '宁夏', 呼和浩特: '内蒙古', 拉萨: '西藏', 沈阳: '辽宁', 长春: '吉林',
  哈尔滨: '黑龙江', 台北: '台湾', 高雄: '台湾', 台中: '台湾', 香港: '香港', 澳门: '澳门',
};

/** Province-level locations (e.g. city recorded as just 广东) resolve to the province itself. */
export const PROVINCE_NAMES = Object.keys(provinceSpots).filter(name => name !== UNKNOWN_PROVINCE);

export const provinceOf = (city?: string): string => {
  if (!city || city === '未标注') return UNKNOWN_PROVINCE;
  if (cityProvince[city]) return cityProvince[city];
  return PROVINCE_NAMES.includes(city) ? city : UNKNOWN_PROVINCE;
};

export const provinceLabel = (province: string) =>
  province === UNKNOWN_PROVINCE ? '地域待考据' : province;

export const spotOf = (province: string): Spot =>
  provinceSpots[province] || provinceSpots[UNKNOWN_PROVINCE];

export interface Cluster {
  spot: Spot;
  ids: string[];
  cols: number;
  rows: number;
  gapX: number;
  gapY: number;
  rx: number;
  ry: number;
  top: number;
  sprite: number;
}

export interface Placed {
  x: number;
  y: number;
  size: number;
  province: string;
}

const CAMP = {cols: 7, gapX: 33, gapY: 35, sprite: 26};

/**
 * Settlements are loose gatherings: no borders, no roads between "regions" other than the
 * paths the map draws. Every node is pinned to its spot, so no simulation can shake it loose.
 */
export function layoutNodes(nodes: ArtistNode[], filter: string) {
  const groups = new Map<string, ArtistNode[]>();
  for (const node of nodes) {
    const province = provinceOf(node.city);
    if (filter !== ALL_PROVINCES && filter !== province) continue;
    const list = groups.get(province) || [];
    list.push(node);
    groups.set(province, list);
  }
  const positions = new Map<string, Placed>();
  const clusters: Cluster[] = [];
  const ordered = [...groups.entries()].sort((a, b) => spotOf(a[0]).x - spotOf(b[0]).x);
  for (const [province, list] of ordered) {
    const spot = spotOf(province);
    const camp = province === UNKNOWN_PROVINCE;
    const people = [...list].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const count = people.length;
    if (camp) {
      // A ring of strangers around a campfire reads better than a roster grid.
      const inner = Math.min(18, count);
      const outer = count - inner;
      people.forEach((node, index) => {
        const ring = index < inner ? 0 : 1;
        const slot = ring === 0 ? index : index - inner;
        const slots = ring === 0 ? inner : outer;
        const angle = (slot / Math.max(1, slots)) * Math.PI * 2 - Math.PI / 2 + (ring ? Math.PI / Math.max(1, outer) : 0);
        const radius = ring === 0 ? 84 : 128;
        positions.set(node.id, {
          x: spot.x + Math.cos(angle) * radius * 1.08,
          y: spot.y + Math.sin(angle) * radius * 0.74,
          size: CAMP.sprite,
          province,
        });
      });
      clusters.push({
        spot, ids: people.map(node => node.id), cols: 0, rows: 0, gapX: 0, gapY: 0,
        rx: 164, ry: 116, top: spot.y - 116 - 44, sprite: CAMP.sprite,
      });
      continue;
    }
    const cols = Math.min(4, Math.max(1, Math.round(Math.sqrt(count))));
    const rows = Math.ceil(count / cols);
    const gapX = count <= 2 ? 72 : count <= 4 ? 76 : 84;
    const gapY = 64;
    const startY = spot.y - ((rows - 1) * gapY) / 2;
    people.forEach((node, index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const inRow = Math.min(cols, count - row * cols);
      const x = spot.x + (col - (inRow - 1) / 2) * gapX;
      const y = startY + row * gapY;
      positions.set(node.id, {x, y, size: 34, province});
    });
    clusters.push({
      spot,
      ids: people.map(node => node.id),
      cols,
      rows,
      gapX,
      gapY,
      rx: Math.max(64, ((cols - 1) * gapX) / 2 + 44),
      ry: Math.max(48, ((rows - 1) * gapY) / 2 + 38),
      top: startY - 40,
      sprite: 34,
    });
  }
  return {clusters, positions};
}

export const provinceOptions = (nodes: ArtistNode[]) => {
  const names = [...new Set(nodes.map(node => provinceOf(node.city)))];
  return names.sort((a, b) => (a === UNKNOWN_PROVINCE ? 1 : b === UNKNOWN_PROVINCE ? -1 : a.localeCompare(b, 'zh-CN')));
};
