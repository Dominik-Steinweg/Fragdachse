import { vi } from 'vitest';
import { StinkPlagueRuntime, type PlagueApplication, type PlagueTarget } from '../src/systems/StinkPlagueRuntime';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { StinkPlagueConfig } from '../src/loadout/StinkPlagueConfig';
import { getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';

export function plagueConfig(patch: Partial<StinkPlagueConfig> = {}): StinkPlagueConfig {
  const utility = UTILITY_CONFIGS.STINK_CLOUD;
  if (utility.type !== 'stinkcloud' || !utility.plague) throw Error('Missing authored plague');
  const duration = getCoopDefenseUpgradeDefinition('stink_cloud_infection')!.effects
    .find(effect => effect.stat === 'utility.STINK_CLOUD.plague.directDurationMs')!.value;
  return { ...utility.plague, directDurationMs: duration, ...patch };
}
export function plagueSource(ownerId = 'p1', patch: Partial<StinkPlagueConfig> = {}, damageMultiplier = 1): PlagueApplication {
  return { ownerId, config: plagueConfig(patch), damageMultiplier };
}
export function plagueTarget(id = 'e1', x = 0, y = 0, radius = 10, generation = 1, boss = false): PlagueTarget {
  return { ref: { kind: 'enemy', id, instance: { entityGeneration: generation }, scope: { worldRevision: 1, runtimeGeneration: 1 } },
    x, y, radius, boss };
}
export function plagueHarness() {
  const damage = vi.fn(), vulnerability = vi.fn(), canReach = vi.fn(() => true), canTransfer = vi.fn(() => true);
  const runtime = new StinkPlagueRuntime({ damage, vulnerability, canReach, canTransfer, areAllies: (a,b) => a === b || b === 'ally' });
  return { runtime, damage, vulnerability, canReach, canTransfer };
}
