/**
 * 热度权重：关系数与作品数是主要热度，评分人数作为补充。
 *
 * 数据长尾很重（325 人里 186 人零关系），开平方压缩后头部约为零线索者的 30 倍，
 * 保底的 1 保证任何人都还有机会被抽到，而不是永远只出那几十个热门。
 *
 * 今日卡片的加权抽取与人物卡的 sorts 共用这一个口径：关系多、作品多、
 * 评分高的人排在前、也更容易被抽中，但冷门人物不会因为零线索而被埋掉。
 */
export function heatWeight(rel: number, work: number, rating?: {average: number; count: number}) {
  const heat = rel * 2 + work * 1.5 + Math.min(rating?.count || 0, 30) * 0.6
    + ((rating?.average || 0) >= 4 ? 4 : 0);
  return 1 + Math.sqrt(heat) * 3;
}
