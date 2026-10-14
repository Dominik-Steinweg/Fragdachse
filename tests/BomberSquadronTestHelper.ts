import { vi } from 'vitest';
import { createFireControlWorldFixture } from './FireControlTestHelper';
import { ULTIMATE_CONFIGS } from '../src/loadout/LoadoutConfig';
import { WorldBomberSquadronBinding } from '../src/world/WorldBomberSquadronBinding';
import type { PlayerCombatIntegrationPort } from '../src/world/PlayerCombatIntegrationPort';
import type { WorldMetrics } from '../src/world/WorldMetrics';
import type { BomberSquadronUltimateConfig } from '../src/loadout/LoadoutTypes';
import { bomberDrops } from '../src/systems/bomberSquadron/BomberSquadronPlan';

export const bomberConfig = ULTIMATE_CONFIGS.BOMBER_SQUADRON as BomberSquadronUltimateConfig;

export function createBomberCombatFixture(overrides: Partial<BomberSquadronUltimateConfig> = {},
  metrics = { widthPx: 5000, heightPx: 5000, offsetX: -500, offsetY: -500 } as WorldMetrics) {
  const world = createFireControlWorldFixture();
  const config = { ...bomberConfig, ...overrides };
  const owner = { x: 1000, y: 1000, color: 1 };
  let available = true, multiplier = 1;
  const chunks = vi.fn();
  const power = vi.spyOn(world.combat, 'getPlayerRuntimeDamageMultiplier').mockImplementation(() => multiplier);
  const explode = vi.spyOn(world.combat, 'applyExplosionDamage');
  const binding = new WorldBomberSquadronBinding({ combat: world.combat, metrics,
    playerCombat: { fireChunks: { hostCreateFireChunkBurst: chunks } } as unknown as PlayerCombatIntegrationPort,
    readTargets: () => [], readOwner: () => available ? owner : null });
  const activate = (nowMs = 1000) => binding.runtime.tryActivate({ playerId: 'inspector', nowMs, angle: 0, config });
  const plan = () => {
    const squadron = binding.runtime.getSnapshot().squadrons[0];
    return Array.from({ length: config.droneCount }, (_, drone) => bomberDrops(squadron, drone, { ...owner, aimOffset: 0, aimAngle: 0 })).flat();
  };
  return { world, binding, config, owner, metrics, chunks, power, explode, activate, plan,
    setAvailable: (value: boolean) => { available = value; }, setMultiplier: (value: number) => { multiplier = value; },
    destroy: () => { binding.destroy(); world.destroy(); } };
}
