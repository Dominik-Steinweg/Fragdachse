import { describe, expect, it, vi } from 'vitest';

// Charakterisierungstests fuer den ersten Player-Gameplay-Runtime-Cutover (Plan Phase 1).
// Sie fixieren die heutige Semantik der riskantesten Loadout-Pfade, bevor spaetere Teilphasen
// (3B Resource/Readiness-Zeit, 5 Construction-Readiness, 6A Player-Action-Owner,
// 8B Negev-Behavior, 8C Shotgun-Reactions) sie verschieben. Kein Zielvertrag – nur Ist-Zustand.

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

import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ConstructionReadinessRuntime } from '../src/world/ConstructionReadinessRuntime';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';

type AnyManager = LoadoutManager & Record<string, any>;

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

/** Baut einen LoadoutManager ohne Konstruktorlauf und injiziert nur die vom Weapon-Owner gelesenen Felder. */
function makeWeaponUseManager(options: {
  weapon: unknown;
  adrenaline?: number;
  adrenalineCost?: number;
}): { manager: AnyManager; dispatch: ReturnType<typeof vi.fn>; drain: ReturnType<typeof vi.fn> } {
  const manager = Object.create(LoadoutManager.prototype) as AnyManager;
  const dispatch = vi.fn(() => true);
  const drain = vi.fn();
  Object.defineProperty(manager, 'dispatchWeaponFire', { value: dispatch });

  const player = { x: 111, y: 222, color: 0xffffff, body: undefined, displayObject: { displayWidth: 32 } };
  manager.okResult = { ok: true };
  manager.loadouts = new Map([['p1', {
    weapon1: options.weapon,
    weapon2: { config: projectileWeaponConfig({ id: 'CHAR_TEST_WEAPON_2' }), decaySpread() { /* noop */ } },
  }]]);
  manager.decoySystem = null;
  manager.itemRuntimeChargeConsumer = null;
  manager.heldFireSlots = new Map();
  manager.heldItemSlots = { noteWeaponUsed: vi.fn(), noteUtilityUsed: vi.fn() };
  manager.physicsSystem = null;
  manager.bridge = { broadcastShotFx: vi.fn() };
  manager.playerManager = { getPlayer: vi.fn(() => player) };
  manager.resourceSystem = {
    resolveAdrenalineCost: vi.fn((_id: string, amount: number) => options.adrenalineCost ?? amount),
    getAdrenaline: vi.fn(() => options.adrenaline ?? 100),
    drainAdrenaline: drain,
  };
  return { manager, dispatch, drain };
}

describe('LoadoutManager.activateWeapon – Client-Position im Waffen-Pfad', () => {
  it('nimmt clientX/clientY als Schussursprung, wenn der Client sie liefert', () => {
    const { manager, dispatch } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse: vi.fn() },
    });

    const result = manager.activateWeapon('p1', 'weapon1', 640, 480, 0, 900, 900, 1_000);

    expect(result).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1]).toBe(640);
    expect(dispatch.mock.calls[0][2]).toBe(480);
  });

  it('faellt ohne Client-Position auf die autoritative Host-Position zurueck', () => {
    const { manager, dispatch } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse: vi.fn() },
    });

    manager.activateWeapon('p1', 'weapon1', 111, 222, 0, 900, 900, 1_000);

    expect(dispatch.mock.calls[0][1]).toBe(111);
    expect(dispatch.mock.calls[0][2]).toBe(222);
  });
});

describe('LoadoutManager.activateWeapon – Commit-Reihenfolge von Readiness und Ressource', () => {
  it('zahlt weder Adrenalin noch startet den Cooldown, wenn die Waffe auf Cooldown ist', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const { manager, dispatch, drain } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => true, getDynamicSpread: () => 0, addSpread, recordUse },
    });

    const result = manager.activateWeapon('p1', 'weapon1', 111, 222, 0, 0, 0, 1_000);

    expect(result).toEqual({ ok: false, reason: 'cooldown' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
    expect(addSpread).not.toHaveBeenCalled();
  });

  it('laesst bei zu wenig Adrenalin Cooldown und Bloom unveraendert', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const { manager, dispatch, drain } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread, recordUse },
      adrenaline: 1,
      adrenalineCost: 5,
    });

    const result = manager.activateWeapon('p1', 'weapon1', 111, 222, 0, 0, 0, 1_000);

    expect(result).toEqual({ ok: false, reason: 'resource', resourceKind: 'adrenaline' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
    expect(addSpread).not.toHaveBeenCalled();
  });

  it('bucht Adrenalin und Cooldown erst nach einem erfolgreichen Fire-Dispatch ab', () => {
    const recordUse = vi.fn();
    const addSpread = vi.fn();
    const { manager, dispatch, drain } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread, recordUse },
      adrenaline: 100,
      adrenalineCost: 5,
    });

    const result = manager.activateWeapon('p1', 'weapon1', 111, 222, 0, 0, 0, 1_000);

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
    const { manager, dispatch, drain } = makeWeaponUseManager({
      weapon: { config: projectileWeaponConfig(), isOnCooldown: () => false, getDynamicSpread: () => 0, addSpread: vi.fn(), recordUse },
    });
    dispatch.mockReturnValue(false);

    const result = manager.activateWeapon('p1', 'weapon1', 111, 222, 0, 0, 0, 1_000);

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(drain).not.toHaveBeenCalled();
    expect(recordUse).not.toHaveBeenCalled();
  });
});

describe('LoadoutManager – Shotgun-Lightning-Queue lebt heute im Loadout (Migrationsziel 8C)', () => {
  function makeShotgunManager() {
    const combatSystem = { applyAoeDamage: vi.fn() };
    const bridge = { broadcastExplosionEffect: vi.fn() };
    const manager = Object.create(LoadoutManager.prototype) as AnyManager;
    const shotgunConfig = {
      id: 'SHOTGUN',
      killHeal: 0,
      killAdrenaline: 0,
      shotgunLightningRadius: 80,
      shotgunLightningDamage: 30,
      shotgunChainEnabled: 0,
    };
    manager.loadouts = new Map([['p1', {
      weapon1: { config: { id: 'W1' } },
      weapon2: { config: shotgunConfig },
    }]]);
    manager.shotgunLightningQueue = [];
    manager.combatSystem = combatSystem;
    manager.resourceSystem = { addAdrenaline: vi.fn() };
    manager.bridge = bridge;
    return { manager, combatSystem, bridge };
  }

  it('reiht einen Lightning-Einschlag auf einen Shotgun-Kill ein', () => {
    const { manager } = makeShotgunManager();

    manager.handleKill('p1', 'SHOTGUN', 10, 20);

    expect(manager.shotgunLightningQueue).toHaveLength(1);
    expect(manager.shotgunLightningQueue[0]).toMatchObject({ ownerId: 'p1', x: 10, y: 20, generation: 0 });
  });

  it('loest die eingereihten Einschlaege als AoE-Schaden plus Broadcast auf', () => {
    const { manager, combatSystem, bridge } = makeShotgunManager();
    manager.handleKill('p1', 'SHOTGUN', 10, 20);

    manager.processShotgunLightningQueue();

    expect(manager.shotgunLightningQueue).toHaveLength(0);
    expect(combatSystem.applyAoeDamage).toHaveBeenCalledWith(
      10, 20, 80, 30, 'p1', false, expect.objectContaining({ category: 'explosion', sourceId: 'weapon.SHOTGUN.lightning' }),
    );
    expect(bridge.broadcastExplosionEffect).toHaveBeenCalledWith(10, 20, 80, 0x78dfff, 'lightning');
  });
});

describe('ConstructionReadinessRuntime – Construction-/Management-Readiness (Phase 5)', () => {
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
