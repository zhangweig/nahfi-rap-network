import type {RatingStat} from '../state/Dataset';
export type CardTier = 'R' | 'SR' | 'SSR' | 'UR';
export function cardTier(stat?: RatingStat): CardTier {
  if (!stat || !Number.isFinite(stat.average) || !Number.isFinite(stat.count) || stat.count < 5 || stat.average < 1 || stat.average > 5) return 'R';
  if (stat.average >= 4.5) return 'UR';
  if (stat.average >= 4) return 'SSR';
  if (stat.average >= 3.5) return 'SR';
  return 'R';
}
export const tierFoil = (tier: CardTier): 'silver' | 'blue' | 'amber' | 'violet' => tier === 'SSR' ? 'amber' : tier === 'SR' ? 'blue' : tier === 'UR' ? 'violet' : 'silver';
