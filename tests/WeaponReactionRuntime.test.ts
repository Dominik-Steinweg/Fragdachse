import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { WeaponReactionRuntime } from '../src/world/WeaponReactionRuntime';
import type { WeaponConfig } from '../src/loadout/LoadoutConfig';

function makeRuntime(config: Record<string, unknown> = {}) {
  const weaponConfig = {
    id: 'SHOTGUN',
    shotgunLightningRadius: 80,
    shotgunLightningDamage: 30,
    shotgunChainEnabled: 0,
    shotgunChainDamageRetention: 0.5,
    shotgunChainRadiusRetention: 0.5,
    ...config,
  } as WeaponConfig;
  const loadout = {
    getEquippedWeaponConfig: vi.fn((_playerId: string, slot: 'weapon1' | 'weapon2') => (
      slot === 'weapon2' ? weaponConfig : undefined
    )),
  };
  const combatSystem = {
    heal: vi.fn(),
    applyAoeDamage: vi.fn(),
  };
  const resourceSystem = { addAdrenaline: vi.fn() };
  const network = { broadcastExplosionEffect: vi.fn() };
  const runtime = new WeaponReactionRuntime({ loadout, combatSystem, resourceSystem, network });
  return { runtime, weaponConfig, loadout, combatSystem, resourceSystem, network };
}

describe('WeaponReactionRuntime – Shotgun Lightning und einfache Kill-Reaktionen', () => {
  it('führt eine Shotgun-Kill-Reaktion als AoE-Schaden plus Lightning-Broadcast aus', () => {
    const { runtime, combatSystem, network } = makeRuntime({
      shotgunLightningAppliesSlow: 1,
      shotgunSlowFraction: 0.25,
      shotgunSlowDurationMs: 900,
    });

    runtime.registerKill({ killerId: 'p1', sourceId: 'SHOTGUN', x: 10, y: 20 });
    runtime.update();

    expect(combatSystem.applyAoeDamage).toHaveBeenCalledWith(
      10,
      20,
      80,
      30,
      'p1',
      false,
      expect.objectContaining({
        category: 'explosion',
        allowTeamDamage: false,
        sourceId: 'weapon.SHOTGUN.lightning',
        sourceSlot: 'weapon2',
        enemySlowFraction: 0.25,
        enemySlowDurationMs: 900,
        killSource: { shotgunLightningGeneration: 0 },
      }),
    );
    expect(network.broadcastExplosionEffect).toHaveBeenCalledWith(10, 20, 80, 0x78dfff, 'lightning');
  });

  it('erhält Chain-Generation und Retention für Lightning-Kills', () => {
    const { runtime, combatSystem } = makeRuntime({
      shotgunChainEnabled: 1,
      shotgunChainDamageRetention: 0.5,
      shotgunChainRadiusRetention: 0.25,
    });

    runtime.registerKill({
      killerId: 'p1',
      sourceId: 'weapon.SHOTGUN.lightning',
      x: 30,
      y: 40,
      source: { shotgunLightningGeneration: 1 },
    });
    runtime.update();

    expect(combatSystem.applyAoeDamage).toHaveBeenCalledWith(
      30,
      40,
      5,
      7.5,
      'p1',
      false,
      expect.objectContaining({ killSource: { shotgunLightningGeneration: 2 } }),
    );
  });

  it('führt config-getriebene Heal- und Adrenalin-Reaktionen nur für die ausgerüstete Quelle aus', () => {
    const { runtime, loadout, combatSystem, resourceSystem } = makeRuntime({
      id: 'PRIMARY',
      killHeal: 12,
      killAdrenaline: 7,
    });
    loadout.getEquippedWeaponConfig.mockImplementation((_playerId, slot) => (
      slot === 'weapon1' ? { id: 'PRIMARY', killHeal: 12, killAdrenaline: 7 } as WeaponConfig : undefined
    ));

    runtime.registerKill({ killerId: 'p1', sourceId: 'PRIMARY', x: 0, y: 0 });
    runtime.registerKill({ killerId: 'p1', sourceId: 'OTHER', x: 0, y: 0 });

    expect(combatSystem.heal).toHaveBeenCalledOnce();
    expect(combatSystem.heal).toHaveBeenCalledWith('p1', 12);
    expect(resourceSystem.addAdrenaline).toHaveBeenCalledOnce();
    expect(resourceSystem.addAdrenaline).toHaveBeenCalledWith('p1', 7);
  });

  it('verwirft ausstehende Reaktionen bei Reset/Remove und nach Destroy', () => {
    const first = makeRuntime();
    first.runtime.registerKill({ killerId: 'p1', sourceId: 'SHOTGUN', x: 1, y: 2 });
    first.runtime.resetPlayer('p1');
    first.runtime.update();
    expect(first.combatSystem.applyAoeDamage).not.toHaveBeenCalled();

    const second = makeRuntime();
    second.runtime.registerKill({ killerId: 'p1', sourceId: 'SHOTGUN', x: 1, y: 2 });
    second.runtime.removePlayer('p1');
    second.runtime.update();
    expect(second.combatSystem.applyAoeDamage).not.toHaveBeenCalled();

    second.runtime.destroy();
    second.runtime.registerKill({ killerId: 'p1', sourceId: 'SHOTGUN', x: 1, y: 2 });
    second.runtime.update();
    expect(second.combatSystem.applyAoeDamage).not.toHaveBeenCalled();
  });
});
