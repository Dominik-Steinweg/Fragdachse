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
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import { PlayerUltimateBehaviorRuntime } from '../src/world/PlayerUltimateBehaviorRuntime';

function makeUtilityRuntime(config: any, placeableUse = vi.fn(() => true), heldAction?: HostHeldActionSystem) {
  const cooldown = vi.fn();
  const player = { x: 10, y: 10, color: 0xffffff, displaySize: 32 };
  const noteUtilityUsed = vi.fn();
  const recordUtilityUsed = vi.fn();
  const recordConstructionBuilt = vi.fn();
  const utility = new PlayerUtilityActionRuntime({
    captureSmokeDamage: () => ({ sourceDamageMultiplier: 1 }),
    projectileSpawn: { spawnProjectile: vi.fn() } as any,
    combatSystem: { resolveImmediateAttack: vi.fn(() => ({ accepted: true })) } as any,
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
    heldAction: heldAction ?? {
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
        publishUtilityCooldownUntil: cooldown,
        publishTemporaryUtilityInstances: vi.fn(),
        publishHeldUtilityId: vi.fn(),
      },
      roundStats: { recordUtilityUsed, recordConstructionBuilt },
    },
    dropBeer: vi.fn(),
    nukeStrike: vi.fn(() => true),
    placeable: { use: placeableUse },
  });
  return { utility, cooldown, noteUtilityUsed, recordUtilityUsed, recordConstructionBuilt, placeableUse };
}

describe('room-statistics gameplay hooks', () => {
  it.each([0.5, 1])('selects the Zeus form from host charge time, not the client fraction (%s)', fraction => {
    const cfg = UTILITY_CONFIGS.ZEUS_TASER;
    if (cfg.activation.type !== 'charged_alternate') throw new Error('Zeus activation');
    const held = new HostHeldActionSystem();
    const { utility, cooldown } = makeUtilityRuntime(cfg, undefined, held);
    const activate = vi.fn(() => true);
    utility.setZeusPort({ activate, removePlayer: vi.fn() });
    const request = { category: 'utility' as const, playerId: 'p1', angle: 0, targetX: 0, targetY: 0,
      hostNowMs: 100 + cfg.activation.fullChargeDuration * fraction,
      params: { heldActionId: 'charge', utilityChargeFraction: fraction < 1 ? 1 : 0, attemptId: 'commit' } };
    expect(utility.execute(request).ok).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(utility.startHeldAction('p1', 'charge', 'charged_alternate', 100)).toBe(true);
    expect(utility.execute(request).ok).toBe(true);
    expect(activate.mock.calls[0].at(-1)).toBe(fraction >= 1);
    expect(cooldown).toHaveBeenLastCalledWith('p1', request.hostNowMs + cfg.cooldown, cfg.id);
    utility.execute(request);
    expect(activate).toHaveBeenCalledOnce();
    utility.destroy();
  });
  it('refunds only a running Zeus cooldown, clamps at ready and publishes the new deadline', () => {
    const base = UTILITY_CONFIGS.ZEUS_TASER;
    if (base.type !== 'taser') throw new Error('Zeus config');
    const config = { ...base, cooldown: 1000, zeus: { ...base.zeus, dynamoRefundMs: 300 } };
    const { utility, cooldown } = makeUtilityRuntime(config);
    const activate = vi.fn(() => true);
    utility.setZeusPort({ activate, removePlayer: vi.fn() });
    const use = (now: number) => utility.execute({ category: 'utility', playerId: 'p1', angle: 0, targetX: 10, targetY: 10, hostNowMs: now });
    utility.onZeusDashStarted('p1', 10); // Nothing is banked before the first use.
    expect(use(100).ok).toBe(true);
    expect(cooldown).toHaveBeenLastCalledWith('p1', 1100, config.id);
    utility.onZeusDashStarted('p1', 200);
    expect(cooldown).toHaveBeenLastCalledWith('p1', 800, config.id);
    expect(use(799)).toEqual({ ok: false, reason: 'cooldown' });
    expect(activate).toHaveBeenCalledOnce();
    utility.onZeusDashStarted('p1', 750);
    expect(cooldown).toHaveBeenLastCalledWith('p1', 750, config.id);
    utility.onZeusDashStarted('p1', 751);
    expect(use(752).ok).toBe(true);
    expect(cooldown).toHaveBeenLastCalledWith('p1', 1752, config.id);
  });

  it('does not commit a rejected Zeus activation or consume its cooldown', () => {
    const { utility, cooldown, noteUtilityUsed } = makeUtilityRuntime(UTILITY_CONFIGS.ZEUS_TASER);
    const activate = vi.fn(() => false);
    utility.setZeusPort({ activate, removePlayer: vi.fn() });
    const request = { category: 'utility' as const, playerId: 'p1', angle: 0, targetX: 0, targetY: 0, hostNowMs: 100 };
    expect(utility.execute(request).ok).toBe(false);
    expect(cooldown.mock.calls.every(call => call[1] === 0)).toBe(true); // Initial equipment sync may clear the old HUD.
    expect(noteUtilityUsed).not.toHaveBeenCalled();
    activate.mockReturnValue(true);
    expect(utility.execute(request).ok).toBe(true);
  });

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
      relationship: { isEnemyPair: () => false },
      roundStats: { recordUltimateUsed: ultimateUsed },
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
