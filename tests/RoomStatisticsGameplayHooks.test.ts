import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { ULTIMATE_CONFIGS, UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { POWERUP_DEFS } from '../src/powerups/PowerUpConfig';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';
import { PlayerUltimateBehaviorRuntime } from '../src/world/PlayerUltimateBehaviorRuntime';

function makeUtilityRuntime(config: any, placeableUse = vi.fn(() => true)) {
  const player = { x: 10, y: 10, color: 0xffffff, displaySize: 32 };
  const noteUtilityUsed = vi.fn();
  const recordUtilityUsed = vi.fn();
  const recordConstructionBuilt = vi.fn();
  const utility = new PlayerUtilityActionRuntime({
    projectileManager: { spawnProjectile: vi.fn() } as any,
    combatSystem: { resolveMeleeSwing: vi.fn(() => true) } as any,
    actor: {
      getPlayer: vi.fn(() => player),
      canInteract: vi.fn(() => true),
      isAlive: vi.fn(() => true),
      isUtilityBlocked: vi.fn(() => false),
    },
    loadout: {
      getEquippedUtilityConfig: vi.fn(() => config),
      resolveUtilityConfig: vi.fn((_playerId: string, value: any) => value),
      noteUtilityUsed,
    },
    heldAction: {
      start: vi.fn(() => true),
      consume: vi.fn(() => ({ elapsedMs: 0, chargeFraction: 1 })),
      clearPlayer: vi.fn(),
    },
    translocator: null,
    decoy: { activate: vi.fn(() => true), breakStealth: vi.fn() } as any,
    stinkCloud: null,
    gameAudioSystem: { playSound: vi.fn() } as any,
    network: {
      loadout: {
        publishUtilityCooldownUntil: vi.fn(),
        publishTemporaryUtilityInstances: vi.fn(),
        publishHeldUtilityId: vi.fn(),
      },
      roundStats: { recordUtilityUsed, recordConstructionBuilt },
    },
    dropBeer: vi.fn(),
    nukeStrike: vi.fn(() => true),
    placeable: { use: placeableUse },
  });
  return { utility, noteUtilityUsed, recordUtilityUsed, recordConstructionBuilt, placeableUse };
}

describe('room-statistics gameplay hooks', () => {
  it('records successful utilities once at the semantic utility boundary and ignores cooldown use', () => {
    const { utility, noteUtilityUsed, recordUtilityUsed } = makeUtilityRuntime(UTILITY_CONFIGS.ZEUS_TASER);

    expect(utility.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 10, targetY: 10, hostNowMs: 100 }))
      .toEqual({ ok: true });
    expect(noteUtilityUsed).toHaveBeenCalledWith('p1', 100);
    expect(recordUtilityUsed).toHaveBeenCalledWith('p1');

    expect(utility.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 10, targetY: 10, hostNowMs: 200 }))
      .toEqual({ ok: false, reason: 'cooldown' });
    expect(recordUtilityUsed).toHaveBeenCalledOnce();
  });

  it('observes construction-mode utility only after its placement handler succeeds', () => {
    const config = { ...UTILITY_CONFIGS.SPORE_TURRET, cooldown: 0 };
    const { utility, recordUtilityUsed, recordConstructionBuilt, placeableUse } = makeUtilityRuntime(config);

    expect(utility.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 10, targetY: 10, hostNowMs: 100 }))
      .toEqual({ ok: true });
    expect(recordUtilityUsed).toHaveBeenCalledWith('p1');
    expect(recordConstructionBuilt).toHaveBeenCalledWith('p1');

    placeableUse.mockReturnValue(false);
    expect(utility.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 10, targetY: 10, hostNowMs: 200 }))
      .toEqual({ ok: false, reason: 'blocked' });
    expect(recordUtilityUsed).toHaveBeenCalledOnce();
  });

  it('counts Gauss only on a fully charged release, never on press or aborted charge', () => {
    const cfg = ULTIMATE_CONFIGS.GAUSS_RIFLE;
    const rage = new Map([['p1', 200]]);
    const ultimateUsed = vi.fn();
    const fireGauss = vi.fn(() => true);
    const behavior = new PlayerUltimateBehaviorRuntime({
      playerManager: {
        getPlayer: () => ({ id: 'p1', x: 0, y: 0, color: 0xffffff }),
        getAllPlayers: () => [],
      } as any,
      combatSystem: { addArmor: vi.fn(), applyAoeDamage: vi.fn() },
      resourceSystem: {
        getRage: (playerId: string) => rage.get(playerId) ?? 0,
        getMaxRage: () => 600,
        addRage: (playerId: string, amount: number) => rage.set(playerId, (rage.get(playerId) ?? 0) + amount),
      },
      loadout: { getEquippedUltimateConfig: () => cfg },
      physics: { addRecoil: vi.fn() },
      gaussExecution: { fireGauss },
      canInteract: () => true,
      isAlive: () => true,
      isUltimateBlocked: () => false,
      network: {
        teams: { isEnemyPair: () => false },
        roundStats: { recordUltimateUsed: ultimateUsed },
      },
    });

    expect(behavior.execute(
      { category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 1000, params: { ultimateAction: 'press', gaussChargeId: 'charge-a' } },
    )).toEqual({ ok: true });
    expect(ultimateUsed).not.toHaveBeenCalled();
    expect(behavior.execute(
      { category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 1100, params: { ultimateAction: 'release', gaussChargeId: 'charge-a', attemptId: 'gauss-commit-a' } },
    ).ok).toBe(false);
    expect(ultimateUsed).not.toHaveBeenCalled();

    expect(behavior.execute(
      { category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 2000, params: { ultimateAction: 'press', gaussChargeId: 'charge-b' } },
    ).ok).toBe(true);
    expect(behavior.execute(
      { category: 'ultimate', playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 3600, params: { ultimateAction: 'release', gaussChargeId: 'charge-b', attemptId: 'gauss-commit-b' } },
    ).ok).toBe(true);
    expect(ultimateUsed).toHaveBeenCalledOnce();
    expect(fireGauss).toHaveBeenCalledOnce();
  });

  it('notifies pickup collection only after a real item is consumed', () => {
    const collected = vi.fn();
    const combat = {
      healToFull: vi.fn(),
      addArmor: vi.fn(),
      isAlive: vi.fn(() => true),
      isBurrowed: vi.fn(() => false),
      applyDamage: vi.fn(),
      applyExplosionDamage: vi.fn(),
    };
    const system = new PowerUpSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      combat,
      { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] },
      { onPickupCollected: collected },
    );
    const uid = (system as any).spawnPowerUpDef(POWERUP_DEFS.HEALTH_PACK, 200, 240);

    expect(system.tryPickup('p1', uid, 200, 240)).toBe(true);
    expect(collected).toHaveBeenCalledOnce();
    expect(system.tryPickup('p1', uid, 200, 240)).toBe(false);
    expect(collected).toHaveBeenCalledOnce();
  });
});
