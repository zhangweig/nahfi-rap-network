import type {ArtistNode, Relationship} from './types';

/**
 * Data extracted from the public GitHub report
 * 《中文说唱十年研究报告 2017-2026》(whisky26/A_Ten-Year_Research_Report_on_Chinese_Rap_2017-2026).
 * Everything here is marked 'seed-reference': the report is the single source, and its own
 * caveat applies — label membership changes often, so nothing below claims permanent status.
 */
const REPORT = {
  title: '《中文说唱十年研究报告 2017-2026》（GitHub 公开报告）',
  url: 'https://github.com/whisky26/A_Ten-Year_Research_Report_on_Chinese_Rap_2017-2026',
};
const ev = (note: string) => [{...REPORT, note}];

const pink = '#ff5c8a', cyan = '#35d6ff', gold = '#ffc93c', grape = '#b07cff', lime = '#8be05e';

export const reportNodes: ArtistNode[] = [
  // ── 成都 / 四川 ──────────────────────────────────────────────
  {id: 'cdc', name: 'CDC说唱会馆', aliases: ['成都集团'], kind: 'group', city: '成都', category: 'CDC', color: pink, initials: 'CD',
    description: '成都说唱厂牌。报告将成都描述为十年间的产业中心，CDC 是其代表性厂牌之一。'},
  {id: 'digi', name: 'Digi Ghetto', kind: 'group', city: '成都', category: 'Digi Ghetto', color: pink, initials: 'DG',
    description: '成都新生代厂牌。报告称 2022 年同名 Mixtape 强化了其声量，2024 年后成员转向个人化发展。'},
  {id: 'defjam', name: 'Def Jam China', aliases: ['Def Jam Recordings China'], kind: 'group', city: '成都', category: '国际厂牌', color: pink, initials: 'DJ',
    description: '报告称 2026 年 Def Jam Recordings China 落地成都，谢帝、王以太、邓典果任特邀召集人。'},
  {id: 'lierxin', name: '李尔新', kind: 'artist', city: '成都', category: 'CDC', color: pink, initials: '李',
    description: '报告在成都场景人物名单中列名李尔新。'},
  {id: 'jackzebra', name: 'jackzebra', kind: 'artist', city: '成都', category: '实验说唱', color: pink, initials: 'JZ',
    description: '报告称 2024 年其作品获 Pitchfork 评论，列为"全球地下"赛道代表。'},
  {id: 'thome', name: 'Thomeboydontkill', aliases: ['偷米'], kind: 'artist', city: '成都', category: 'Digi Ghetto', color: pink, initials: 'TH',
    description: '报告列为 Digi Ghetto 成员。'},
  {id: 'sakee', name: 'Mula Sakee', kind: 'artist', city: '成都', category: 'Digi Ghetto', color: pink, initials: 'MS',
    description: '报告列为 Digi Ghetto 成员。'},
  // ── 重庆 ────────────────────────────────────────────────────
  // ── 西安 / 陕西 ─────────────────────────────────────────────
  {id: 'nous', name: 'NOUS', aliases: ['NOUS Underground'], kind: 'group', city: '西安', category: 'NOUS', color: grape, initials: 'NO',
    description: '西安厂牌。报告称红花会解散后西安声量分散，"NOUS 路线更重作品与制作"。'},
  {id: 'hhh', name: '红花会', aliases: ['GDLF'], kind: 'group', city: '西安', category: '红花会', color: grape, initials: '红',
    description: '西安厂牌，报告称 2017 前后影响力极强，2019 年解散；此处保留其历史成员关系。'},
  {id: 'pact', name: '派克特', aliases: ['PACT'], kind: 'artist', city: '西安', category: 'NOUS', color: grape, initials: '派',
    description: '报告列为西安 NOUS 代表人物。'},
  {id: 'beibei', name: '贝贝', aliases: ['李京泽'], kind: 'artist', city: '西安', category: '红花会', color: grape, initials: '贝',
    description: '报告列为红花会代表成员（历史关系）。'},
  {id: 'pgone', name: 'PG One', aliases: ['王唯楚'], kind: 'artist', city: '西安', category: '红花会', color: grape, initials: 'PG',
    description: '报告称 2017 年《中国有嘻哈》双冠军之一；红花会成员身份为历史关系（红花会 2019 年解散）。'},
  {id: 'dingfei', name: '丁飞', kind: 'artist', city: '西安', category: '红花会', color: grape, initials: '丁',
    description: '报告列为红花会代表成员（历史关系）。'},
  {id: 'mai', name: 'Mai', aliases: ['Mai 神'], kind: 'artist', city: '西安', category: '红花会', color: grape, initials: 'MA',
    description: '报告列为红花会成员，以制作人身份活跃（历史关系）。'},
  // ── 南京 / 江苏 ─────────────────────────────────────────────
  {id: 'freeout', name: 'Free-Out', kind: 'group', city: '南京', category: 'Free-Out', color: cyan, initials: 'FO',
    description: '南京厂牌。报告称其"通过综艺和稳定巡演建立全国性厂牌粉丝"，以厂牌 Cypher 著称。'},
  {id: 'erwan', name: '贰万', kind: 'artist', city: '南京', category: 'Free-Out', color: cyan, initials: '贰',
    description: '报告列为南京 Free-Out 成员。'},
  {id: 'kc', name: 'Kc', aliases: ['左元杰'], kind: 'artist', city: '南京', category: 'Free-Out', color: cyan, initials: 'KC',
    description: '报告列为南京 Free-Out 成员。'},
  // ── 新疆 ────────────────────────────────────────────────────
  {id: 'liuxuanting', name: '刘炫廷', kind: 'artist', city: '乌鲁木齐', category: '说唱音乐人', color: lime, initials: '刘',
    description: '报告列为新疆代表音乐人之一。'},
  {id: 'shark', name: 'SHarK米尔艾力', aliases: ['SHarK'], kind: 'artist', city: '乌鲁木齐', category: '说唱音乐人', color: lime, initials: 'SH',
    description: '报告记其为《新说唱2025》冠军，列为新疆新生代代表。'},
  // ── 东北 / 吉林 ─────────────────────────────────────────────
  // ── 广东 / 大湾区 ───────────────────────────────────────────
  {id: 'ar', name: 'AR刘夫阳', aliases: ['刘夫阳'], kind: 'artist', city: '广东', category: '说唱音乐人', color: cyan, initials: 'AR',
    description: '报告列为广东/大湾区代表力量之一。'},
  {id: 'lanlao', name: '揽佬', aliases: ['SKAI ISYOURGOD'], kind: 'artist', city: '广东', category: '说唱音乐人', color: gold, initials: '揽',
    description: '报告记《八方来财》2025 年全球爆红（Spotify 月听众超 302 万），以 Memphis 骨架与广府/客家语感形成"本土到极致反而更国际"的案例。'},
  {id: 'shouheng', name: '瘦恒', aliases: ['SoulHan'], kind: 'artist', city: '广东', category: '说唱音乐人', color: cyan, initials: '瘦',
    description: '报告列为广东/大湾区代表力量之一。'},
  // ── 上海 / 江浙 ─────────────────────────────────────────────
  {id: 'sfg', name: '直火帮', aliases: ['Straight Fire Gang'], kind: 'group', city: '上海', category: '直火帮', color: grape, initials: '直',
    description: '报告列为上海/江浙代表，称该区域"更像个人艺术家和制作网络"。'},
  {id: 'gali', name: 'GALI', aliases: ['蒋文涵'], kind: 'artist', city: '上海', category: '说唱音乐人', color: cyan, initials: 'GA',
    description: '报告列为"现场口碑型"代表，并以上海/江浙"城市新中产与国际化视觉"描述其路线。'},
  {id: 'manshuke', name: '满舒克', aliases: ['Young Jack'], kind: 'artist', city: '上海', category: '说唱音乐人', color: grape, initials: '满',
    description: '报告将满舒克列于上海/江浙代表，并记其与 MDSK 的阶段性签约。'},
  // ── 福建 ────────────────────────────────────────────────────
  {id: 'wanida', name: '万妮达', aliases: ['Vinida'], kind: 'artist', city: '福州', category: '说唱音乐人', color: pink, initials: '万',
    description: '报告以"福州/南方气质"标注万妮达，列为流行融合赛道代表。'},
  // ── 平台 / 经纪公司（地域未标注） ─────────────────────────────
  {id: 'huosiren', name: '活死人', aliases: ['Walking Dead'], kind: 'group', city: '未标注', category: '活死人', color: grape, initials: '活',
    description: '法老主理的厂牌。报告未标注其地域，此处不推定。'},
  {id: 'w8ves', name: 'W8VES', kind: 'group', city: '未标注', category: 'W8VES', color: cyan, initials: 'W8',
    description: '报告记其为 B 站 × 88rising 平台厂牌，2020 年成立。'},
  {id: 'dmg', name: '种梦音乐', aliases: ['D.M.G', '种梦音乐 D.M.G'], kind: 'group', city: '未标注', category: '经纪公司', color: gold, initials: 'DM',
    description: '报告记其为经纪公司，2025 年与腾讯音乐深度合作；合作关系随时间变化，此处仅记录报告所述。'},
  {id: 'mdsk', name: 'MDSK', aliases: ['摩登天空 MDSK'], kind: 'group', city: '未标注', category: '厂牌', color: grape, initials: 'MD',
    description: '报告记其为摩登天空旗下厂牌（2016 年成立），与多位艺人为阶段性合作/签约关系。'},
  {id: 'yanghesu', name: '杨和苏', aliases: ['KeyNG'], kind: 'artist', city: '未标注', category: '活死人', color: lime, initials: '杨',
    description: '报告记其 2019 年《中国新说唱》夺冠，列为活死人成员。'},
  {id: 'jarstick', name: 'JarStick', kind: 'artist', city: '未标注', category: '活死人', color: gold, initials: 'JS',
    description: '报告列为活死人成员。'},
  {id: 'landuo', name: '懒惰', aliases: ['Landuo'], kind: 'artist', city: '未标注', category: 'W8VES', color: cyan, initials: '懒',
    description: '报告记其 2020 年《说唱新世代》夺冠，列为 W8VES 成员。'},
  {id: 'yuzhen', name: '于贞', aliases: ['Infun'], kind: 'artist', city: '未标注', category: 'W8VES', color: grape, initials: '于',
    description: '报告列为 W8VES 成员，女性表达赛道代表。'},
  {id: 'subs', name: 'Subs张毅成', aliases: ['Subs'], kind: 'artist', city: '未标注', category: 'W8VES', color: lime, initials: 'SU',
    description: '报告列为 W8VES 成员。'},
  {id: 'shengda', name: '圣代', aliases: ['Sundae'], kind: 'artist', city: '未标注', category: 'W8VES', color: gold, initials: '圣',
    description: '报告列为 W8VES 成员。'},
  {id: 'lidaben', name: '李大奔', aliases: ['Benzo'], kind: 'artist', city: '未标注', category: '说唱音乐人', color: lime, initials: '李',
    description: '报告记其与 MDSK 的阶段性合作。'},
  {id: 'jd', name: 'JD', aliases: ['华明杰'], kind: 'artist', city: '未标注', category: '说唱音乐人', color: lime, initials: 'JD',
    description: '报告记其 2020 年《说唱听我的》夺冠；未标注地域。'},
  {id: 'lijialong', name: '李佳隆', aliases: ['JelloRio'], kind: 'artist', city: '未标注', category: '说唱音乐人', color: grape, initials: '佳',
    description: '报告记其 2020 年《中国新说唱》夺冠；未标注地域。'},
];

/** Report-sourced city corrections for nodes the seed data deliberately left unmarked. */
export const reportOverrides: Record<string, Partial<ArtistNode>> = {
  asen: {city: '成都'},
  xiedi: {city: '成都'},
  ty: {city: '成都'},
  ddg: {city: '成都'},
  vava: {city: '成都'},
  lianma: {
    city: '成都',
    category: '五人组',
    description: '五人组成员，与 JinJiBeWater_隼（隼）为双胞胎亲兄弟。作品档案收录《舔狗》、《譚sir》等曲目。合作记录以具体版本署名为准。',
  },
  wudu: {city: '重庆'},
  wangqiming: {city: '重庆'},
  pact: {city: '西安'},
  danko: {city: '西安'},
  creamd: {city: '西安'},
  gaotianzuo: {city: '南京'},
  zaoan: {city: '南京'},
  icepaper: {city: '南京'},
  guangguang: {city: '南京'},
  huangxu: {city: '乌鲁木齐'},
  nawukere: {city: '乌鲁木齐'},
  gem: {city: '长春'},
  hotdog: {city: '台湾'},
  eso: {city: '台湾'},
  kenzy: {city: '台湾'},
  muta: {city: '台湾'},
  softlipa: {city: '台湾'},
  kumachan: {city: '台湾'},
};

const member = (group: string, ids: string[], label: string, year: number, note: string): Relationship[] =>
  ids.map(id => ({
    id: `${group}-${id}`, source: group, target: id, type: 'member' as const,
    label, observedYear: year, evidence: ev(note), status: 'seed-reference' as const,
  }));
const ties = (group: string, ids: string[], label: string, year: number, note: string): Relationship[] =>
  ids.map(id => ({
    id: `${group}-${id}-tie`, source: group, target: id, type: 'affiliation' as const,
    label, observedYear: year, evidence: ev(note), status: 'seed-reference' as const,
  }));

export const reportRelations: Relationship[] = [
  ...member('cdc', ['xiedi', 'ty', 'lierxin', 'ddg', 'higher', 'yitai'], '厂牌成员（报告厂牌章节）', 2026,
    '报告厂牌章节将谢帝、Higher Brothers、Ty.、王以太、李尔新、邓典果列入 CDC说唱会馆/成都集团；成员关系随时间变化，不视为当前合约。'),
  ...member('digi', ['asen', 'thome', 'sakee'], '厂牌成员（报告厂牌章节）', 2022,
    '报告将 Asen、Thomeboydontkill、Mula Sakee、Mac Ova Seas、KIV、Toyoki 列为 Digi Ghetto 成员；此处收录报告点名的核心成员。'),
  ...ties('defjam', ['xiedi', 'yitai', 'ddg'], '特邀召集人（2026）', 2026,
    '报告记 2026 年 Def Jam Recordings China 落地成都，谢帝、王以太、邓典果任特邀召集人。'),
  ...member('nous', ['pact'], '厂牌代表（报告厂牌章节）', 2026,
    '报告将派克特列为西安 NOUS 代表（"派克特等"）。'),
  ...member('hhh', ['danko', 'beibei', 'pgone', 'dingfei', 'mai'], '历史成员（红花会 2019 年解散）', 2017,
    '报告将弹壳、贝贝、PG One、丁飞、Mai 列为红花会成员；红花会/GDLF 于 2019 年解散，此处仅保留历史关系。'),
  ...member('freeout', ['gaotianzuo', 'zaoan', 'icepaper', 'erwan', 'kc'], '厂牌成员（报告厂牌章节）', 2026,
    '报告将高天佐、早安、Ice Paper、贰万、Kc 列为南京 Free-Out 成员。'),
  ...member('huosiren', ['pharaoh', 'yanghesu', 'elfin', 'jarstick'], '厂牌成员（报告厂牌章节）', 2026,
    '报告将法老（主理人）、杨和苏、小精灵、JarStick 列为活死人成员。'),
  ...member('w8ves', ['landuo', 'shayiting', 'yuzhen', 'subs', 'shengda'], '平台厂牌成员（2020 年成立）', 2020,
    '报告记 W8VES 为 B 站 × 88rising 平台厂牌，成员包括懒惰、沙一汀、于贞、Subs、圣代。'),
  ...ties('dmg', ['gai', 'vava', 'air', 'bridge', 'zaoan'], '经纪合作（报告厂牌章节）', 2025,
    '报告将 GAI、VaVa、艾热、Bridge、早安列为种梦音乐 D.M.G 合作艺人；合作关系随时间变化。'),
  ...ties('mdsk', ['tizzyt', 'manshuke', 'huangxu', 'lidaben'], '阶段性签约/合作（报告厂牌章节）', 2026,
    '报告记 MDSK 与 Tizzy T、满舒克、黄旭、李大奔等为阶段性合作/签约关系。'),
  {
    id: 'hhh-mai-production', source: 'hhh', target: 'mai', type: 'production',
    label: '厂牌制作（报告厂牌章节）', observedYear: 2017,
    evidence: ev('报告将 Mai 列入红花会成员名单；Mai 以制作人身份参与说唱作品，此处把成员关系之外的另一层身份单独记录。'),
    status: 'seed-reference',
  },
  ...member('gosh', ['wangqiming', 'wudu'], '厂牌成员（报告厂牌章节）', 2026,
    '报告将王齐铭、雾都 L4WUDU 列为重庆 GOSH 代表成员；后期成员转向个人化发展。'),
];

/** One line per year on the board timeline, straight from the report's chronicle. */
export const YEAR_NOTES: Record<number, string> = {
  2017: '《中国有嘻哈》引爆 · GAI/PG One 双冠军',
  2018: '监管收紧更名新说唱 · 艾热夺冠',
  2019: '《野狼disco》出圈 · 红花会解散',
  2020: '三档综艺同台 · W8VES 成立',
  2021: '细分赛道 · 《黑怕女孩》女子厂牌',
  2022: '巅峰对决联赛 · Digi Ghetto 同名带',
  2023: '全明星联赛延续 · 资源向头部集中',
  2024: '隼夺冠 · 环球×爱奇艺全球发行',
  2025: '《八方来财》全球爆红 · SHarK 夺冠',
  2026: '十周年 · Def Jam China 落地成都',
};
