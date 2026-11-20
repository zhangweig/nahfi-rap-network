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

/**
 * 站点种子条目：中文说唱 Beef 时间线（18 条）。
 *
 * 数据来源：站长整理提供的公开事件年表。字段约定：
 * - sides 只填库里真实存在的 nodeId，缺失的人物用 null 并在 note 保留名字，不新建节点。
 * - moments 按时间排序，kind 区分 diss / response / statement / reconcile / other。
 * - 年表自带的存疑、阵营归属、防误读提示一字不漏写进 note。
 * - status 统一 unverified：涉及真人负面事件，站长尚未逐条附公开来源链接前不标「已核实」。
 */
export const SEED_BEEFS: BeefEvent[] = [
  // 1. 2003 · 双子 vs 隐藏（双子库内缺失）
  {
    id: 'beef-2003-shuangzi-yincang',
    sides: [{nodeId: 'pending-170', note: '隐藏'}, null],
    title: '双子 vs 隐藏',
    status: 'unverified',
    moments: [
      {year: 2003, kind: 'other', label: '隐藏《在北京》对老北京文化的描绘引发争执', evidence: []},
      {year: 2003, kind: 'statement', label: '被视为早期 beef 起源之一，存疑', evidence: []},
    ],
    evidence: [],
    note: '对手「双子」在库中暂无对应节点，待补充。本条为早期 beef 起源说法，存疑。',
  },
  // 2. 2005–2011 · 幼稚园杀手 vs 全圈（全圈非具体人物，用单方）
  {
    id: 'beef-2005-youzhayuanshou',
    sides: [{nodeId: 'pending-177', note: '幼稚园杀手'}, null],
    title: '幼稚园杀手 vs 全圈',
    status: 'unverified',
    moments: [
      {year: 2005, kind: 'diss', label: '神秘马甲发 diss 扫射全圈', evidence: []},
      {year: 2011, kind: 'statement', label: '身份至今未证实，赵辰龙否认自己是幼杀', evidence: []},
    ],
    evidence: [],
    note: '对手为「全圈」，非具体人物，故留空。幼稚园杀手身份至今未证实，赵辰龙已否认。',
  },
  // 3. 2014 · 谢帝 vs 热狗、顽童
  {
    id: 'beef-2014-xiedi-hotdog',
    sides: [{nodeId: 'xiedi', note: '谢帝'}, {nodeId: 'hotdog', note: '热狗 / MC HotDog'}],
    title: '谢帝 vs 热狗、顽童',
    status: 'unverified',
    moments: [
      {year: 2014, kind: 'other', label: '颁奖礼热狗迟到早退，谢帝认为耍大牌', evidence: []},
      {year: 2014, kind: 'diss', label: '谢帝《R.E.S.P.E.C.T》', evidence: []},
      {year: 2014, kind: 'response', label: '法老随后回击谢帝', evidence: []},
      {year: 2019, kind: 'statement', label: '法老 2019 年称后悔', evidence: []},
    ],
    evidence: [],
    note: '参与方还涉及顽童 MJ116（库内节点 pending-045），因 sides 仅两方未列入。法老回击谢帝是同期的另一条支线。',
  },
  // 4. 2014 · 徐真真、茶米 vs CDC
  {
    id: 'beef-2014-xuzhenzhen-cdc',
    sides: [{nodeId: 'pending-009', note: '徐真真'}, {nodeId: 'cdc', note: 'CDC 说唱会馆'}],
    title: '徐真真、茶米 vs CDC',
    status: 'unverified',
    moments: [
      {year: 2014, kind: 'diss', label: '徐真真《Snapbacks & Tattoos》remix 阴阳谢帝遮纹身', evidence: []},
      {year: 2014, kind: 'response', label: 'CDC 全员回击，徐真真后无回应', evidence: []},
      {year: 2015, kind: 'statement', label: '余波引出 GAI–CDC', evidence: []},
    ],
    evidence: [],
    note: '参与方「茶米」库中暂无对应节点。此事件余波引出后续的 GAI–CDC 冲突。',
  },
  // 5. 2015 · 大陆 rapper vs 台湾俊升（俊升库内缺失）
  {
    id: 'beef-2015-junsheng',
    sides: [{nodeId: 'beibei', note: '贝贝（回击方代表）'}, null],
    title: '大陆 rapper vs 台湾俊升',
    status: 'unverified',
    moments: [
      {year: 2015, kind: 'other', label: '俊升在《康熙来了》freestyle 扫射大陆人，又出《玻璃娃娃》', evidence: []},
      {year: 2015, kind: 'diss', label: '贝贝《bia7俊升》、CDC《道理》mixtape 回击', evidence: []},
      {year: 2015, kind: 'statement', label: '台湾方面后无回应', evidence: []},
    ],
    evidence: [],
    note: '对手「俊升」库中暂无对应节点，第二方留空。sides 第一项用回击方代表贝贝（beibei）以便连线；CDC（cdc）亦参与回击。',
  },
  // 6. 2015–2016 · 法老 vs 谢帝、CDC、海尔兄弟
  {
    id: 'beef-2015-pharaoh-xiedi',
    sides: [{nodeId: 'pharaoh', note: '法老'}, {nodeId: 'xiedi', note: '谢帝'}],
    title: '法老 vs 谢帝、CDC、海尔兄弟',
    status: 'unverified',
    moments: [
      {year: 2015, kind: 'other', label: '谢帝踩奖事件；法老点赞针对 DZknow（KnowKnow）的 diss', evidence: []},
      {year: 2015, kind: 'diss', label: '法老《请跟这烂圈子说再见》《W.D.G.A.F》', evidence: []},
      {year: 2016, kind: 'response', label: '海尔兄弟（Higher Brothers）《D.F.W.M.C》×2', evidence: []},
      {year: 2016, kind: 'statement', label: '2016 年底告一段落，此后只剩口头争执', evidence: []},
    ],
    evidence: [],
    note: 'sides 只列主要双方法老与谢帝；CDC、海尔兄弟（库内 higher）为谢帝一方声援。此条为 2015–2016 法老与谢帝线，与第 3 条 2014 谢帝颁奖礼事件相关但不同。',
  },
  // 7. 2016 · GAI vs 马思唯、CDC（升级原 beef-ma-gai）
  {
    id: 'beef-ma-gai',
    sides: [{nodeId: 'gai', note: 'GAI'}, {nodeId: 'ma', note: '马思唯'}],
    title: 'GAI vs 马思唯、CDC',
    status: 'unverified',
    moments: [
      {year: 2016, kind: 'other', label: '嫩桃参与徐真真 remix，GAI 微博骂人，马思唯回「你瓜」', evidence: []},
      {year: 2016, kind: 'diss', label: '马思唯《要冷格嘛》、GAI《斩马刀》、马思唯《Back to Back》、CDC《该挨》', evidence: []},
      {year: 2016, kind: 'statement', label: 'GAI 退出 GOSH 开始巡演；普遍评价 CDC 歌上占优，无正式裁决', evidence: []},
    ],
    evidence: [],
    note: '时间为 2016 年前后（月日未核实），不是 2024 年的新 beef。CDC 说唱会馆（cdc）为马思唯一方。',
  },
  // 8. 2017.2 · 光光 vs GAI（卷入十余人）
  {
    id: 'beef-2017-guangguang-gai',
    sides: [{nodeId: 'guangguang', note: 'MC光光'}, {nodeId: 'gai', note: 'GAI'}],
    title: '光光 vs GAI（卷入弹壳、Jony J 等十余人）',
    status: 'unverified',
    moments: [
      {year: 2017, kind: 'other', label: '光光微博「多读书，少装社会大哥」，GAI 对号入座', evidence: []},
      {year: 2017, kind: 'diss', label: '光光《Gay爷只打字》、弹壳《Thug Life》、Jony J《陪你做个秀》、光光《谢谢你》', evidence: []},
      {year: 2017, kind: 'statement', label: 'GAI 发声明退出；光光–Jony J 未真正和解', evidence: []},
    ],
    evidence: [],
    note: 'sides 列主双方光光与 GAI。卷入者弹壳（danko）、Jony J（jonyj）等十余人，未逐一列入 sides。',
  },
  // 9. 2017 夏秋 · GAI vs PG One、红花会
  {
    id: 'beef-2017-gai-pgone',
    sides: [{nodeId: 'gai', note: 'GAI'}, {nodeId: 'pgone', note: 'PG One'}],
    title: 'GAI vs PG One、红花会',
    status: 'unverified',
    moments: [
      {year: 2017, kind: 'diss', label: 'PG One《H.M.E》点名「表里不一的社会 GAI」', evidence: []},
      {year: 2017, kind: 'reconcile', label: '决赛 2017-09-09 两人并列总冠军，台上握手言和', evidence: []},
      {year: 2019, kind: 'statement', label: 'PG One 陷《圣诞夜》风波，红花会 2019 年 8 月解散', evidence: []},
    ],
    evidence: [],
    note: '红花会（hhh）为 PG One 所属厂牌，未列入两方 sides。',
  },
  // 10. 2017 底–2018 · CDC vs SUP、C-BLOCK
  {
    id: 'beef-2017-cdc-cblock',
    sides: [{nodeId: 'cdc', note: 'CDC'}, {nodeId: 'cblock', note: 'C-BLOCK'}],
    title: 'CDC vs SUP、C-BLOCK',
    status: 'unverified',
    moments: [
      {year: 2017, kind: 'other', label: 'TSP 与龙泽宇口角，功夫胖阴阳海尔兄弟「假表」', evidence: []},
      {year: 2017, kind: 'diss', label: 'Buzzy《不是太想写一首通俗易懂的Diss》、大傻《一挑五》收尾', evidence: []},
      {year: 2018, kind: 'reconcile', label: '握手言和，涂鸦改为「CSC love CDC」', evidence: []},
    ],
    evidence: [],
    note: 'SUP MUSIC（crew-supmusic）与 C-BLOCK 同属一方；功夫胖（kungfu）、Buzzy（pending-112）、大傻/盛宇（shengyu）为参与成员，未逐一列入 sides。TSP、龙泽宇库中暂无节点。',
  },
  // 11. 2015 起 · NOUS（派克特）vs 红花会（弹壳）
  {
    id: 'beef-2015-nous-hhh',
    sides: [{nodeId: 'pact', note: '派克特 / NOUS'}, {nodeId: 'danko', note: '弹壳 / 红花会'}],
    title: 'NOUS（派克特）vs 红花会（弹壳）',
    status: 'unverified',
    moments: [
      {year: 2015, kind: 'other', label: '「干一票」新人 freestyle 呛派克特', evidence: []},
      {year: 2020, kind: 'statement', label: '传 2020 年和解，说法仅见短视频口述，存疑', evidence: []},
    ],
    evidence: [],
    note: '无公开 diss 曲，未发展成明面 beef。和解说法仅见短视频口述，存疑。',
  },
  // 12. 2019.10 · 杨和苏、法老、活死人 vs Kisos、平西
  {
    id: 'beef-2019-keyng-kisos',
    sides: [{nodeId: 'keyng', note: '杨和苏'}, null],
    title: '杨和苏、法老、活死人 vs Kisos、平西',
    status: 'unverified',
    moments: [
      {year: 2019, kind: 'other', label: '黄昭 diss 福克斯，Kisos 参战；叠加 Listen Up 冠军含金量争议', evidence: []},
      {year: 2019, kind: 'diss', label: '杨和苏《不到三分钟的热度》（2019-10-17）', evidence: []},
      {year: 2019, kind: 'statement', label: '普遍评价杨和苏一首占优，无正式裁决', evidence: []},
    ],
    evidence: [],
    note: '法老（pharaoh）、活死人（huosiren）与杨和苏是同一阵营，不是对手。对手 Kisos、平西库中暂无节点，故第二方留空。黄昭（pending-194）、福克斯（pending-075）为事件起点。',
  },
  // 13. 2022.7 · 宝石Gem + 派克特 vs 全圈（合作，非互beef）
  {
    id: 'beef-2022-gem-pact',
    sides: [{nodeId: 'gem', note: '宝石Gem'}, {nodeId: 'pact', note: '派克特'}],
    title: '宝石Gem + 派克特 vs 全圈',
    status: 'unverified',
    moments: [
      {year: 2022, kind: 'diss', label: '《巅峰对决》2v2 组队无差别扫射圈内乱象《你也是个Rapper》', evidence: []},
      {year: 2022, kind: 'statement', label: '第二轮 30 分落败', evidence: []},
    ],
    evidence: [],
    note: '这是宝石Gem 与派克特的合作组队扫射全圈，不是两人互 beef。sides 两方仅表示联名参与，非对立关系。',
  },
  // 14. 2022.3 · 贝贝 vs 赵辰龙、幼稚园杀手
  {
    id: 'beef-2022-beibei-zhaochenlong',
    sides: [{nodeId: 'beibei', note: '贝贝'}, {nodeId: 'pending-188', note: '赵辰龙'}],
    title: '贝贝 vs 赵辰龙、幼稚园杀手',
    status: 'unverified',
    moments: [
      {year: 2022, kind: 'other', label: '「活着的传奇」梗与同名专辑之争（3月11–28日）', evidence: []},
      {year: 2022, kind: 'diss', label: '贝贝《爆K幼稚园杀手》Part1、Part2', evidence: []},
      {year: 2022, kind: 'response', label: '赵辰龙小号《大棍子》回击', evidence: []},
      {year: 2022, kind: 'statement', label: '无胜负裁决，不了了之；赵辰龙否认是幼杀', evidence: []},
    ],
    evidence: [],
    note: '幼稚园杀手（pending-177）为赵辰龙马甲争议对象，未列入 sides。赵辰龙否认自己是幼杀。',
  },
  // 15. 2024.3–4 · 诺米 vs 谢帝（诺米库内缺失）
  {
    id: 'beef-2024-nuomi-xiedi',
    sides: [{nodeId: 'xiedi', note: '谢帝'}, null],
    title: '诺米 vs 谢帝',
    status: 'unverified',
    moments: [
      {year: 2024, kind: 'other', label: '海选谢帝淘汰诺米，误称写给爷爷的歌为写给奶奶的歌', evidence: []},
      {year: 2024, kind: 'diss', label: '诺米《谢天谢帝》', evidence: []},
      {year: 2024, kind: 'reconcile', label: '「成都迪士尼」成梗，谢帝未回歌，后同台玩梗', evidence: []},
    ],
    evidence: [],
    note: '「诺米」库中暂无对应节点，故第二方留空，人名记于标题。',
  },
  // 16. 2024.6 · DIGI GHETTO vs 活死人（第一轮）
  {
    id: 'beef-2024-digi-huosiren-r1',
    sides: [{nodeId: 'digi', note: 'DIGI GHETTO'}, {nodeId: 'huosiren', note: '活死人'}],
    title: 'DIGI GHETTO vs 活死人（第一轮）',
    status: 'unverified',
    moments: [
      {year: 2024, kind: 'other', label: '杨和苏《麻瓜》用 Digi 押韵「低级」', evidence: []},
      {year: 2024, kind: 'response', label: 'Mac + Sakee《高级》、法老《27 狗子 来了！》', evidence: []},
      {year: 2024, kind: 'diss', label: 'Asen《人上人Pt.2》（6-28 00:17）', evidence: []},
      {year: 2024, kind: 'statement', label: '《人上人Pt.2》上架约 16 小时即全网删除；双方删歌，杨和苏取关 Asen，暂时平息', evidence: []},
    ],
    evidence: [],
    note: '第一轮（6月16–28日）。sides 列阵营 DIGI GHETTO 与活死人；Mac（pending-089）、Sakee（sakee）、法老（pharaoh）、Asen（asen）为 DIGI 一方，杨和苏（keyng）为活死人一方。与第 18 条 2025 第二轮相续。',
  },
  // 17. 2024.8 · 派克特 vs 乙游圈（乃万谷子争议）
  {
    id: 'beef-2024-pact-ziyou',
    sides: [{nodeId: 'pact', note: '派克特'}, null],
    title: '派克特 vs 乙游圈',
    status: 'unverified',
    moments: [
      {year: 2024, kind: 'other', label: '乃万乙游「谷子」争议，派克特为同厂牌乃万出头（8月21–26日）', evidence: []},
      {year: 2024, kind: 'diss', label: '派克特 diss 歌（8-26）', evidence: []},
      {year: 2024, kind: 'statement', label: '叠纸声明要求删文道歉，派克特删原版、换黑底版、再删，无胜负', evidence: []},
    ],
    evidence: [],
    note: '对手为「乙游圈 / 叠纸」，非具体人物，故第二方留空。乃万（nineone）为派克特声援对象，非对手。',
  },
  // 18. 2025.10–11 · Asen vs 杨和苏、法老、活死人（第二轮，升级原 beef-asen-keyng）
  {
    id: 'beef-asen-keyng',
    sides: [{nodeId: 'asen', note: '艾志恒 Asen'}, {nodeId: 'keyng', note: '杨和苏'}],
    title: 'Asen vs 杨和苏、法老、活死人（第二轮）',
    status: 'unverified',
    moments: [
      {year: 2025, kind: 'other', label: 'Asen 新专《英雄》重提 2024 年 beef（10月15–30日，延续至11月1日）', evidence: []},
      {year: 2025, kind: 'diss', label: '小李PISSY《给Asen的信》、Jarstick《阴雄》、Asen《Everybody Knows》、杨和苏《志得小人》、2Night《给法老的信》', evidence: []},
      {year: 2025, kind: 'statement', label: '未和解，仍在发酵，「谁赢」无共识', evidence: []},
    ],
    evidence: [],
    note: '第二轮，与第 16 条 2024 第一轮相续。法老（pharaoh）、活死人（huosiren）为杨和苏一方。没找到名为《大招》的 diss 曲，请勿当作曲名。Jarstick（jarstick）库中节点已列入时间线。',
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
