/** 投稿审核表的字段定义。init 用它建表，pull 用它读回，字段名只在这里定义一次。 */
export const STATUS_PENDING = '待审核';
export const STATUS_APPROVED = '已通过';
export const STATUS_REJECTED = '已退回';

export const FIELDS = {
  id: '编号',
  status: '状态',
  kind: '类型',
  title: '标题',
  source: '起点',
  target: '终点',
  relationType: '关系类型',
  year: '年份',
  city: '城市',
  aliases: '别名',
  description: '简介',
  avatar: '头像',
  sourceTitle: '来源标题',
  sourceUrl: '来源链接',
  sourceNote: '证据说明',
  contributor: '投稿人',
  message: '备注',
  reviewNote: '审核意见',
  submittedAt: '提交时间',
  json: '数据',
};

const relationLabels = {
  member: '组合成员',
  collaboration: '歌曲合作',
  production: '幕后制作',
  affiliation: '历史关联',
};
export const relationLabelToKey = Object.fromEntries(
  Object.entries(relationLabels).map(([key, label]) => [label, key]),
);

export const TABLE_NAME = '投稿审核';

/** 表单里要展示的列（「数据」「审核意见」由程序写，不放进表单）。 */
export const FORM_FIELDS = [
  FIELDS.kind, FIELDS.title, FIELDS.city, FIELDS.aliases, FIELDS.description, FIELDS.avatar,
  FIELDS.source, FIELDS.target, FIELDS.relationType, FIELDS.year,
  FIELDS.sourceTitle, FIELDS.sourceUrl, FIELDS.sourceNote, FIELDS.contributor, FIELDS.message,
];

/** 飞书多维表格字段类型：1 文本 / 2 数字 / 3 单选 / 5 日期 / 15 超链接 */
export const TABLE_FIELDS = [
  {field_name: FIELDS.id, type: 1, description: '投稿编号。留空则自动生成，勿手改已通过的编号'},
  {
    field_name: FIELDS.status, type: 3,
    property: {options: [{name: STATUS_PENDING}, {name: STATUS_APPROVED}, {name: STATUS_REJECTED}]},
    description: '改成「已通过」后，下一次 npm run feishu:pull 就会上线',
  },
  {
    field_name: FIELDS.kind, type: 3,
    property: {options: [{name: '新增人物'}, {name: '修改人物'}, {name: '新增关系'}, {name: '修改关系'}]},
    description: '决定下面哪些列有意义',
  },
  {field_name: FIELDS.title, type: 1, description: '人物投稿填艺名；关系投稿填关系说明，如《曲名》录音室合作'},
  {field_name: FIELDS.source, type: 1, description: '关系起点：填艺人名或 id，名称会自动转成 id'},
  {field_name: FIELDS.target, type: 1, description: '关系终点：填艺人名或 id'},
  {
    field_name: FIELDS.relationType, type: 3,
    property: {options: Object.values(relationLabels).map(name => ({name}))},
  },
  {field_name: FIELDS.year, type: 2, description: '作品年份或资料年份'},
  {field_name: FIELDS.city, type: 1, description: '人物用。填城市名，会自动归入省份聚落'},
  {field_name: FIELDS.aliases, type: 1, description: '人物用。多个别名用顿号隔开'},
  {field_name: FIELDS.description, type: 1, description: '人物用。一句话简介，须能被来源支持'},
  {field_name: FIELDS.avatar, type: 1, description: '人物用。可选，/avatars/xxx.png 或 https 图片地址'},
  {field_name: FIELDS.sourceTitle, type: 1},
  {field_name: FIELDS.sourceUrl, type: 15},
  {field_name: FIELDS.sourceNote, type: 1, description: '该来源具体支持哪些信息'},
  {field_name: FIELDS.contributor, type: 1},
  {field_name: FIELDS.message, type: 1},
  {field_name: FIELDS.reviewNote, type: 1, description: '退回时写原因'},
  {field_name: FIELDS.submittedAt, type: 5},
  {field_name: FIELDS.json, type: 1, description: '程序读取这一列为准；有值时优先于上面的拆列。建议在表单里隐藏'},
];

/** 把记录单元格里的富文本结构压平成普通字符串。 */
export function plain(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(plain).join('');
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.link === 'string') return value.link;
  }
  return '';
}

/** 单元格里的「歌曲合作」→ collaboration；已经是英文 key 时原样返回。 */
export function relationKeyOf(value) {
  const label = plain(value).trim();
  if (relationLabels[label]) return label;
  return relationLabelToKey[label] || 'collaboration';
}

/** 超链接列读出来是 {link, text}，取 href。 */
export function linkOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(linkOf).find(Boolean) || '';
  return (value.link || value.text || '').trim();
}
