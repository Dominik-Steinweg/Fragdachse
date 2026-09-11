import { MG_TURRET_RULES } from './mgTurretRules';
export { MG_TURRET_RULES } from './mgTurretRules';
import { COOP_DEFENSE_CONSTRUCTIONS } from './coopDefenseConstructions';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';

export const MG_STAT_PREFIX = 'construction.machine_gun_turret.';

export interface MgTurretStats {
  readonly damage: number;
  readonly cooldownMs: number;
  readonly targetRange: number;
  readonly projectileRange: number;
  readonly perHitPercent: number;
  readonly maximumPercent: number;
  readonly network: boolean;
  readonly bleedLevel: number;
  readonly transferFraction: number;
}

/** The same owner projection feeds construction previews, live turrets and combat rules. */
export function resolveMgTurretStats(
  numeric: (stat: string) => number = () => 0,
  percentage: (stat: string) => number = () => 0,
): MgTurretStats {
  // The authored upgrade definitions and profile sanitizer own level limits.
  const finitePositive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const read = (suffix: string) => finitePositive(numeric(MG_STAT_PREFIX + suffix));
  const ratio = (suffix: string) => finitePositive(percentage(MG_STAT_PREFIX + suffix));
  const network = read('network') > 0;
  const range = 1 + ratio('range');
  return {
    damage: MG_TURRET_RULES.damage,
    cooldownMs: MG_TURRET_RULES.cooldownMs / (1 + ratio('frequency')),
    targetRange: COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.kind === 'turret'
      ? COOP_DEFENSE_CONSTRUCTIONS.machine_gun_turret.targetRange * range : 0,
    projectileRange: WEAPON_CONFIGS.TURRET_MG.range * range,
    perHitPercent: read('perHitPercent'),
    maximumPercent: MG_TURRET_RULES.baseMaximumPercent + read('maximumPercent'),
    network,
    bleedLevel: network ? read('bleedLevel') : 0,
    transferFraction: network ? ratio('transfer') : 0,
  };
}
