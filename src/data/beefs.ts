/**
 * BEEF 链 · 冲突事件数据层
 *
 * 独立于现有 relations（组合成员/歌曲合作/幕后制作/厂牌关联）——beef 是事件对象，
 * 字段结构与合作关系完全不同，塞进 relations 会污染统计，因此单独成层，可整层删除回退。
 *
 * 数据真实性原则（这站对编造数据零容忍，beef 涉及真人负面指控，标准更严）：
 * - 只写用户明确给出的参与方节点 id，不推断、不补全
 * - 不编造年份、起因、经过、证据链接——一律留空并标记 status:'unverified'
 * - 通过「网友补充」提交的内容存浏览器本地，仅提交者自己可见，不伪装成已审核公开数据
 * - 真正上线需站长核实来源后，把字段填实并把 status 改为 'verified'
 *
 * 数据流（与人物/关系投稿完全同一条管线）：
 *   表单 → POST /api/submissions(kind:'beef') → D1 submissions(pending)
 *   → 站长审核 → approved → compose() 合并进 /api/data.beefs → 全站可见
 * 浏览器本地只保留「离线草稿」：没有连接投稿服务时的暂存，始终标 local，绝不伪装成公开数据。
 */

export type BeefStatus = 'unverified' | 'verified';
export type BeefEventKind = 'diss' | 'response' | 'statement' | 'reconcile' | 'other';

export interface BeefEvidence {
  title: string;
  url: string;
  note?: string;
}

export interface BeefMoment {
  year?: number;
  kind: BeefEventKind;
  label: string;
  evidence: BeefEvidence[];
}

export interface BeefSide {
  /** 参与方节点 id；个人用 artist id，团队用 group id。 */
  nodeId: string;
  /** 团队时可注明涉及人数/成员，仅描述性文字。 */
  note?: string;
}

export interface BeefEvent {
  id: string;
  /** 对阵双方；法老这类只给了一方的，第二项留 null 表示「对手待补充」。 */
  sides: [BeefSide, BeefSide | null];
  title: string;
  status: BeefStatus;
  /** 事件时间线；未核实的内容不写具体年份与经过。 */
  moments: BeefMoment[];
  evidence: BeefEvidence[];
  /** 本地补充标记：true = 网友本地提交、仅自己可见；false = 站点种子条目。 */
  local?: boolean;
  note?: string;
}

/** 站点种子条目：参与方来自用户明确给出的名单，其余字段留空待核实。 */
export const SEED_BEEFS: BeefEvent[] = [
  {
    id: 'beef-ma-gai',
    sides: [{nodeId: 'ma'}, {nodeId: 'gai'}],
    title: '马思唯 vs GAI',
    status: 'unverified',
    moments: [],
    evidence: [],
    note: '参与方由用户提供。具体年份、起因、经过与来源待核实后补充。',
  },
  {
    id: 'beef-asen-keyng',
    sides: [{nodeId: 'asen'}, {nodeId: 'keyng', note: '杨和苏（KeyNG）'}],
    title: '艾志恒 Asen vs 杨和苏',
    status: 'unverified',
    moments: [],
    evidence: [],
    note: '参与方由用户提供。杨和苏采用关系主节点 keyng。具体经过待核实。',
  },
  {
    id: 'beef-pharaoh-open',
    sides: [{nodeId: 'pharaoh'}, null],
    title: '法老 · 对手待补充',
    status: 'unverified',
    moments: [],
    evidence: [],
    note: '仅提供了法老一方。对手与事件待网友补充、站长核实。',
  },
];

const LOCAL_KEY = 'flowline.beefs.local.v1';

/** 读取离线草稿（仅本机可见，不上传、不伪装成公开数据）。 */
export function loadLocalBeefs(): BeefEvent[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLocalBeefs(items: BeefEvent[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    /* private mode — 补充内容只在本次会话有效 */
  }
}

/**
 * 汇总服务端公开数据（种子 + 已审核投稿）+ 本地离线草稿，供渲染使用。
 * 入参 remote 来自 useDataset().data.beefs；静态浏览模式下退回站点种子。
 */
export function allBeefs(remote: BeefEvent[] | undefined, local: BeefEvent[]): BeefEvent[] {
  return [...(remote?.length ? remote : SEED_BEEFS), ...local];
}

/** 某节点卷入的所有 beef（用于节点警戒环、球星卡角标）。 */
export function beefsOf(nodeId: string, beefs: BeefEvent[]): BeefEvent[] {
  return beefs.filter(b => b.sides.some(s => s && s.nodeId === nodeId));
}

/** 卷入 beef 的全部节点 id。 */
export function beefNodeIds(beefs: BeefEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const b of beefs) for (const s of b.sides) if (s) ids.add(s.nodeId);
  return ids;
}
