/** 表格与代码之间的字段映射。导出、导入共用，改列名只改这里。 */

export const KIND_LABEL = {artist: '音乐人', group: '组合'};
export const KIND_BY_LABEL = {'音乐人': 'artist', '组合': 'group', '说唱音乐人': 'artist', '团体': 'group'};

export const RELATION_LABEL = {
  member: '组合成员',
  collaboration: '歌曲合作',
  production: '幕后制作',
  affiliation: '历史关联',
};
export const RELATION_BY_LABEL = Object.fromEntries(
  Object.entries(RELATION_LABEL).map(([key, label]) => [label, key]),
);

export const STATUS_ACTIVE = '在用';
export const STATUS_RETIRED = '下架';

export const ARTIST_COLUMNS = [
  'id', '名字', '别名', '类型', '省份', '简介', '头像', '状态',
];

export const RELATION_COLUMNS = [
  'id', '起点', '终点', '类型', '说明', '年份',
  '作品名', '作品年份', '版本', '证据标题', '证据链接', '证据说明', '来源', '状态',
];

export const RELATION_SOURCE_DERIVED = '自动派生';

/** 表格单元格可能是数字、日期或富文本，统一取成字符串。 */
export function cell(value) {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function year(value) {
  const text = cell(value);
  if (!text) return undefined;
  const match = text.match(/-?\d{4}/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return parsed > 1900 && parsed < 2100 ? parsed : undefined;
}

export function splitAliases(value) {
  return cell(value)
    .split(/[、,，;；|\/]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

export const SHEET_README = [
  ['纳菲说唱关系网 · 数据维护表'],
  [''],
  ['怎么用'],
  ['1. 改完保存，运行 npm run sheet:import；它会把表格覆盖到网站数据上并重建快照。'],
  ['2. 想看当前网站的真实数据，运行 npm run sheet:export 重新导出（会覆盖本文件）。'],
  ['3. 只写「真的改过的行」，没改的行不会进覆盖文件，所以代码里的新数据不会被这张表挡住。'],
  [''],
  ['三张表的分工'],
  ['人物：所有艺人/组合。id 是主键，别改已有 id（改了等于新建一个人）。'],
  ['省份只填 34 个省级行政区名（四川、新疆、北京…），不填城市；不确定就留空，会进「地域待考据」。'],
  ['头像留空就用自动生成的像素头像；以后要换图，填 /avatars/人物id.png 或图片直链即可。'],
  ['关系：人工维护的关系（组合成员、厂牌归属、幕后制作、个别歌曲合作）。'],
  ['说明：就是你正在看的这一页。'],
  [''],
  ['不在这张表里的东西'],
  ['408 条「歌曲合作」是脚本从作品署名两两算出来的，改作品目录才会变，所以不导出。'],
  ['想加一首歌的合作关系？在「关系」页新增一行，类型选「歌曲合作」，填作品名和年份即可。'],
  [''],
  ['填写规则'],
  ['· 类型：音乐人 / 组合；关系类型：组合成员 / 歌曲合作 / 幕后制作 / 历史关联。'],
  ['· 别名多个用「、」隔开。'],
  ['· 起点/终点填艺人名或 id 都行，导入时自动换成 id。'],
  ['· 关系页的证据链接必须 http:// 或 https:// 开头，首页链接会被拦下来；可以不填。'],
  ['· 状态填「下架」= 从网站上移除（连同他的所有关系）；留空或「在用」= 正常显示。'],
  ['· 新增行 id 可以留空，导入时按名字自动生成。'],
  [''],
  ['常见报错'],
  ['「第 37 行：省份「成都市」不认识」——省份只认 34 个省级行政区，改成「四川」即可。'],
  ['导入失败时不会写入任何东西，不用担心把数据改坏。'],
];
