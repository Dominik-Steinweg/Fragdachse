import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { HeldItemSlotTracker } from '../src/loadout/HeldItemSlotTracker';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ULTIMATE_CONFIGS, UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { POWERUP_DEFS } from '../src/powerups/PowerUpConfig';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';

function makeLoadoutHookHarness() {
  const manager = Object.create(LoadoutManager.prototype) as any;
  manager.okResult = { ok: true };
  manager.bridge = {
    publishUtilityCooldownUntil: vi.fn(),
  };
  manager.heldItemSlots = new HeldItemSlotTracker();
  manager.decoySystem = { activate: vi.fn(() => true) };
  manager.placeableRockHandler = vi.fn(() => true);
  manager.utilityUsedCallback = vi.fn();
  manager.utilityUsedObserver = vi.fn();
  manager.ultimateUsedObserver = vi.fn();
  manager.ultimateStates = new Map();
  manager.projectileManager = { spawnProjectile: vi.fn() };
  manager.physicsSystem = { addRecoil: vi.fn() };
  manager.resourceSystem = {
    getRage: vi.fn(() => 200),
    addRage: vi.fn(),
  };
  return manager;
}

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
    const manager = makeLoadoutHookHarness();
    const cfg = ULTIMATE_CONFIGS.GAUSS_RIFLE;

    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 1000, 0xffffff, undefined, { ultimateAction: 'press' },
    )).toEqual({ ok: true });
    expect(manager.ultimateUsedObserver).not.toHaveBeenCalled();
    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 1100, 0xffffff, manager.ultimateStates.get('p1'),
      { ultimateAction: 'release', ultimateChargeFraction: 0.5 },
    ).ok).toBe(false);
    expect(manager.ultimateUsedObserver).not.toHaveBeenCalled();

    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 2000, 0xffffff, manager.ultimateStates.get('p1'), { ultimateAction: 'press' },
    ).ok).toBe(true);
    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 3600, 0xffffff, manager.ultimateStates.get('p1'),
      { ultimateAction: 'release', ultimateChargeFraction: 1 },
    ).ok).toBe(true);
    expect(manager.ultimateUsedObserver).toHaveBeenCalledOnce();
    expect(manager.projectileManager.spawnProjectile).toHaveBeenCalledOnce();
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
