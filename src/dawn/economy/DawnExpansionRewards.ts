import { DAWN_EXPANSION_CONFIG, type DawnExpansionConfig } from '../../config/dawn/expansion';
import { PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE } from '../../persistentBase/PersistentBaseCore';
import type { PersistentBaseRewardId } from '../../persistentBase/PersistentBaseRewardTypes';

/**
 * Dawn expansion track (D-46): expansions 1..4 grow the base radius (7..10 cells); every later
 * expansion (threat 6..10) adds core HP and, as a placeholder, unlocks one more plasma turret.
 */
export const DAWN_EXPANSION_PLASMA_TURRET_REWARDS = [
  'base_plasma_turret_dawn_1', 'base_plasma_turret_dawn_2', 'base_plasma_turret_dawn_3',
  'base_plasma_turret_dawn_4', 'base_plasma_turret_dawn_5',
] as const satisfies readonly PersistentBaseRewardId[];

export type DawnExpansionReward =
  | { readonly kind: 'radius'; readonly level: number; readonly radiusCells: number }
  | { readonly kind: 'core'; readonly level: number; readonly coreHpBonus: number; readonly totalCoreHpBonus: number;
      readonly plasmaTurretRewardId: PersistentBaseRewardId };

const clampLevel = (level: number, config: DawnExpansionConfig) =>
  Number.isSafeInteger(level) ? Math.max(0, Math.min(config.maxExpansionLevel, level)) : 0;

/** What reaching `level` grants; null for level 0 or beyond the track. */
export function resolveDawnExpansionReward(level: number, config: DawnExpansionConfig = DAWN_EXPANSION_CONFIG):
  DawnExpansionReward | null {
  if (!Number.isSafeInteger(level) || level < 1 || level > config.maxExpansionLevel) return null;
  if (level <= config.radiusExpansionLevels) {
    return { kind: 'radius', level, radiusCells: 4 + PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE + level };
  }
  const index = level - config.radiusExpansionLevels - 1;
  const total = config.coreHpBonusByLevel[index];
  return { kind: 'core', level, totalCoreHpBonus: total, coreHpBonus: total - (index > 0 ? config.coreHpBonusByLevel[index - 1] : 0),
    plasmaTurretRewardId: DAWN_EXPANSION_PLASMA_TURRET_REWARDS[index] };
}

/** Cumulative core HP bonus the host freezes into a Dawn World (0 within the radius track). */
export function resolveDawnExpansionCoreHpBonus(level: number, config: DawnExpansionConfig = DAWN_EXPANSION_CONFIG): number {
  const coreLevels = clampLevel(level, config) - config.radiusExpansionLevels;
  return coreLevels > 0 ? config.coreHpBonusByLevel[coreLevels - 1] : 0;
}

/** Personal plasma turret placeholders derived from the expansion level (never stored separately). */
export function resolveDawnExpansionRewardUnlocks(level: number, config: DawnExpansionConfig = DAWN_EXPANSION_CONFIG):
  readonly PersistentBaseRewardId[] {
  const coreLevels = Math.max(0, clampLevel(level, config) - config.radiusExpansionLevels);
  return DAWN_EXPANSION_PLASMA_TURRET_REWARDS.slice(0, coreLevels);
}
