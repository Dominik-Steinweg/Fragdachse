import { getCoopDefenseUpgradeDefinition } from '../utils/coopDefenseUpgrades';

export interface SlimeTrailConfig {
  readonly enabled: boolean;
  readonly cellSize: number;
  readonly lingerDurationMs: number;
  readonly effectDurationMs: number;
  readonly tickIntervalMs: number;
  readonly damagePerTick: number;
  readonly slowFraction: number;
  readonly deathBurstSearchRadius: number;
  readonly deathBurstPatchCount: number;
}

/** Both the walking unlock and standalone plague bursts read the same authored upgrade effects. */
export function getSlimeTrailBaseline(): SlimeTrailConfig {
  const read = (id: string, field: string): number => {
    const effect = getCoopDefenseUpgradeDefinition(id)?.effects.find(e => e.stat === `player.slimeTrail.${field}`);
    if (!effect) throw new Error(`Missing authored slime baseline: ${id}.${field}`);
    return effect.value;
  };
  return {
    enabled: false,
    cellSize: read('slime_trail', 'cellSize'),
    lingerDurationMs: read('slime_trail', 'lingerDurationMs'),
    effectDurationMs: read('slime_trail', 'effectDurationMs'),
    tickIntervalMs: read('slime_trail', 'tickIntervalMs'),
    damagePerTick: read('slime_trail', 'damagePerTick'),
    slowFraction: read('slime_trail', 'slowFraction'),
    deathBurstSearchRadius: read('slime_trail_bloom', 'deathBurstSearchRadius'),
    deathBurstPatchCount: 0,
  };
}
