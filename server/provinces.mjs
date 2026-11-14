/**
 * 34 个省级行政区白名单，服务端校验用。
 * 必须与 src/lib/province.ts 的 PROVINCE_NAMES 保持一致（前端下拉框就用那份）。
 */
export const PROVINCES = [
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆',
  '香港', '澳门', '台湾',
];

/** 未确定省份的人停在「地域待考据」。 */
export const UNKNOWN_PROVINCE = '未定';

/** 历史数据与旧客户端提交的是城市，这里折回省份。与 src/lib/province.ts 的 cityProvince 一致。 */
export const CITY_PROVINCE = {
  成都: '四川', 绵阳: '四川', 重庆: '重庆', 长沙: '湖南', 喀什: '新疆', 乌鲁木齐: '新疆',
  福州: '福建', 厦门: '福建', 泉州: '福建', 上海: '上海', 北京: '北京', 天津: '天津',
  广州: '广东', 深圳: '广东', 珠海: '广东', 杭州: '浙江', 宁波: '浙江', 温州: '浙江',
  南京: '江苏', 苏州: '江苏', 无锡: '江苏', 武汉: '湖北', 郑州: '河南', 青岛: '山东',
  济南: '山东', 西安: '陕西', 昆明: '云南', 贵阳: '贵州', 南宁: '广西', 海口: '海南',
  合肥: '安徽', 南昌: '江西', 太原: '山西', 石家庄: '河北', 兰州: '甘肃', 西宁: '青海',
  银川: '宁夏', 呼和浩特: '内蒙古', 拉萨: '西藏', 沈阳: '辽宁', 长春: '吉林',
  哈尔滨: '黑龙江', 台北: '台湾', 高雄: '台湾', 台中: '台湾', 香港: '香港', 澳门: '澳门',
};

export const isProvince = value => value === UNKNOWN_PROVINCE || PROVINCES.includes(value);

/** 省份 / 城市 / 空值 → 正式省份名；认不出来返回 ''。 */
export function resolveProvince(value) {
  const text = String(value ?? '').trim();
  if (!text || text === '未标注') return UNKNOWN_PROVINCE;
  if (PROVINCES.includes(text) || text === UNKNOWN_PROVINCE) return text;
  return CITY_PROVINCE[text] || '';
}
