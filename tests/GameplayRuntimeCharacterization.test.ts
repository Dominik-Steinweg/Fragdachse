import { describe, expect, it, vi } from 'vitest';

// Charakterisierungstests fuer die riskantesten Player-Gameplay-Loadout-Pfade.
// Sie dokumentieren beobachtbare Runtime-Semantik und bleiben bewusst frei von Source-Shape-
// Assertions; dauerhafte Ownership-Grenzen gehoeren in die Architecture-Suite.

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    DegToRad: Math.PI / 180,
  },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
}));

import { PlayerWeaponActivationRuntime } from '../src/world/PlayerWeaponActivationRuntime';
import { ConstructionReadinessRuntime } from '../src/world/ConstructionReadinessRuntime';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';

function projectileWeaponConfig(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'CHAR_TEST_WEAPON',
    cooldown: 100,
    damage: 10,
    range: 500,
    fire: { type: 'projectile', projectileSpeed: 800, projectileSize: 4 },
    adrenalinCost: 5,
    adrenalinGain: 0,
    spreadStanding: 0,
    spreadMoving: 0,
    spreadPerShot: 0,
    maxDynamicSpread: 0,
    spreadRecoveryDelay: 0,
    spreadRecoveryRate: 0,
    warmupBurnThreshold: 0,
    ...overrides,
  };
}

/** Baut den World-owned Weapon-Activation-Pfad mit einem schmalen Equipment-Port. */
function makeWeaponUseManager(options: {
  weapon: unknown;
  adrenaline?: number;
  adrenalineCost?: number;
}): { activation: PlayerWeaponActivationRuntime; dispatch: ReturnType<typeof vi.fn>; drain: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn(() => true);
  const drain = vi.fn();
  const player = { x: 111, y: 222, color: 0xffffff, body: undefined, displayObject: { displayWidth: 32 } };
  const weapon = options.weapon as {
    config: any;
    isOnCooldown: () => boolean;
    getDynamicSpread: () => number;
    addSpread: ReturnType<typeof vi.fn>;
    recordUse: ReturnType<typeof vi.fn>;
  };
  const activation = new PlayerWeaponActivationRuntime({
    playerManager: { getPlayer: vi.fn(() => player) },
    loadout: {
      isWeaponOnCooldown: () => weapon.isOnCooldown(),
      getDynamicSpread: () => weapon.getDynamicSpread(),
      addWeaponSpread: () => weapon.addSpread(),
      recordWeaponUse: (_playerId, _slot, nowMs) => weapon.recordUse(nowMs),
      noteWeaponUsed: vi.fn(),
    },
    resourceSystem: {
      resolveAdrenalineCost: vi.fn((_id: string, amount: number) => options.adrenalineCost ?? amount),
      getAdrenaline: vi.fn(() => options.adrenaline ?? 100),
      drainAdrenaline: drain,
    },
    weaponExecution: { fire: dispatch },
    specializedWeaponExecution: { fire: vi.fn(() => false) },
  });
  return { activation, dispatch, drain };
}

function activateWeapon(
  activation: PlayerWeaponActivationRuntime,
  config: any,
  x: number,
  y: number,
): ReturnType<PlayerWeaponActivationRuntime['activateWeapon']> {
  return activation.activateWeapon({
    playerId: 'p1',
    slot: 'weapon1',
    config,
    x,
    y,
    angle: 0,
    targetX: 900,
    targetY: 900,
    nowMs: 1_000,
  });
}

describe('PlayerWeaponActivationRuntime – Client-Position im Waffen-Pfad', () => {
  it('nimmt clientX/clientY als Schussursprung, wenn der Client sie liefert', () => {
    const config = projectileWeaponConfig();
    const { activation, dispatch } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse: vi.fn() },
    });

    const result = activateWeapon(activation, config, 640, 480);

    expect(result).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]).toMatchObject({ x: 640, y: 480 });
  });

  it('faellt ohne Client-Position auf die autoritative Host-Position zurueck', () => {
    const config = projectileWeaponConfig();
    const { activation, dispatch } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse: vi.fn() },
    });

    activateWeapon(activation, config, 111, 222);

    expect(dispatch.mock.calls[0][1]).toMatchObject({ x: 111, y: 222 });
  });
});

describe('PlayerWeaponActivationRuntime – Commit-Reihenfolge von Readiness und Ressource', () => {
  it('zahlt weder Adrenalin noch startet den Cooldown, wenn die Waffe auf Cooldown ist', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const config = projectileWeaponConfig();
    const { activation, dispatch, drain } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => true, getDynamicSpread: () => 0, addSpread, recordUse },
    });

    const result = activateWeapon(activation, config, 111, 222);

    expect(result).toEqual({ ok: false, reason: 'cooldown' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
    expect(addSpread).not.toHaveBeenCalled();
  });

  it('laesst bei zu wenig Adrenalin Cooldown und Bloom unveraendert', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const config = projectileWeaponConfig();
    const { activation, dispatch, drain } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread, recordUse },
      adrenaline: 1,
      adrenalineCost: 5,
    });

    const result = activateWeapon(activation, config, 111, 222);

    expect(result).toEqual({ ok: false, reason: 'resource', resourceKind: 'adrenaline' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
    expect(addSpread).not.toHaveBeenCalled();
  });

  it('bucht Adrenalin und Cooldown erst nach einem erfolgreichen Fire-Dispatch ab', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const config = projectileWeaponConfig();
    const { activation, dispatch, drain } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread, recordUse },
      adrenaline: 100,
      adrenalineCost: 5,
    });

    const result = activateWeapon(activation, config, 111, 222);

    expect(result).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith('p1', 5, 1_000);
    expect(recordUse).toHaveBeenCalledWith(1_000);
    expect(addSpread).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(drain.mock.invocationCallOrder[0]);
    expect(dispatch.mock.invocationCallOrder[0]).toBeLessThan(recordUse.mock.invocationCallOrder[0]);
  });

  it('startet keinen Cooldown, wenn der Fire-Dispatch nichts abfeuert', () => {
    const recordUse = vi.fn();
    const config = projectileWeaponConfig();
    const { activation, dispatch, drain } = makeWeaponUseManager({
      weapon: { config, isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse },
    });
    dispatch.mockReturnValue(false);

    const result = activateWeapon(activation, config, 111, 222);

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
  });
});

describe('ConstructionReadinessRuntime – Construction-/Management-Readiness', () => {
  function makeReadiness(): ConstructionReadinessRuntime {
    const readiness = new ConstructionReadinessRuntime();
    readiness.attachPlayer('p1');
    readiness.attachPlayer('p2');
    return readiness;
  }

  it('haelt den Bau-Cooldown pro Spieler und Konstruktions-ID getrennt', () => {
    const readiness = makeReadiness();
    const cooldownMs = getCoopDefenseConstructionDefinition('rock_barrier').buildCooldownMs;

    readiness.markConstructionUsed('p1', 'rock_barrier', 1_000);

    expect(readiness.isConstructionOnCooldown('p1', 'rock_barrier', 1_000 + cooldownMs - 1)).toBe(true);
    expect(readiness.isConstructionOnCooldown('p1', 'rock_barrier', 1_000 + cooldownMs)).toBe(false);
    expect(readiness.isConstructionOnCooldown('p1', 'spore_turret', 1_000)).toBe(false);
    expect(readiness.isConstructionOnCooldown('p2', 'rock_barrier', 1_000)).toBe(false);
  });

  it('schluesselt den Management-Cooldown an der Aktion, nicht am bewegten Objekt', () => {
    const readiness = makeReadiness();

    readiness.markManagementActionUsed('p1', 'dismantle', 1_000);

    expect(readiness.getManagementActionCooldownUntil('p1', 'dismantle')).toBe(1_100);
    expect(readiness.isManagementActionOnCooldown('p1', 'dismantle', 1_099)).toBe(true);
    expect(readiness.isManagementActionOnCooldown('p1', 'dismantle', 1_100)).toBe(false);
    expect(readiness.isManagementActionOnCooldown('p1', 'reposition', 1_099)).toBe(false);
  });

  it('raeumt Player-in-World-Readiness beim Detach und World-Teardown auf', () => {
    const readiness = makeReadiness();
    readiness.markConstructionUsed('p1', 'rock_barrier', 1_000);
    readiness.markManagementActionUsed('p1', 'reposition', 1_000);

    readiness.detachPlayer('p1');
    expect(readiness.isConstructionOnCooldown('p1', 'rock_barrier', 1_000)).toBe(false);
    expect(readiness.getManagementActionCooldownUntil('p1', 'reposition')).toBe(0);

    readiness.markConstructionUsed('p2', 'rock_barrier', 1_000);
    readiness.destroy();
    expect(readiness.isConstructionOnCooldown('p2', 'rock_barrier', 1_000)).toBe(false);
  });
});
