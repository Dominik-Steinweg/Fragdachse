import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    DegToRad: (degrees: number) => (degrees * Math.PI) / 180,
  },
}));

import * as Phaser from 'phaser';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../src/loadout/LoadoutConfig';
import { TeslaDomeSystem, type TeslaNovaHit, type TeslaStormProjectileRequest } from '../src/systems/TeslaDomeSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { ResourceSystem } from '../src/systems/ResourceSystem';
import type { TeslaDomeTargetType } from '../src/types';

type TeslaConfig = WeaponConfig & { fire: TeslaDomeWeaponFireConfig };

interface TestBase {
  id: string;
  faction: 'friendly' | 'hostile';
  getHp: () => number;
  getNearestSurfacePoint: (x: number, y: number) => { x: number; y: number; distance: number } | null;
}

function makeBase(
  id: string,
  faction: TestBase['faction'],
  hp: number,
  surface: { x: number; y: number; distance: number } | null,
): TestBase {
  return {
    id,
    faction,
    getHp: vi.fn(() => hp),
    getNearestSurfacePoint: vi.fn(() => surface),
  };
}

function makeConfig(
  targetTypes: readonly TeslaDomeTargetType[],
  fireOverrides: Partial<TeslaDomeWeaponFireConfig> = {},
): TeslaConfig {
  return {
    ...WEAPON_CONFIGS.TESLA_DOME,
    fire: {
      ...WEAPON_CONFIGS.TESLA_DOME.fire,
      adrenalineDrainPerSecond: 0,
      targetTypes,
      ...fireOverrides,
    },
  } as TeslaConfig;
}

/** Der Tesla-Turm teilt Fire-Type und System, darf aber keine Spielermechanik erben. */
function makeTurretConfig(targetTypes: readonly TeslaDomeTargetType[]): TeslaConfig {
  return {
    ...WEAPON_CONFIGS.TURRET_TESLA,
    fire: { ...WEAPON_CONFIGS.TURRET_TESLA.fire, targetTypes },
  } as TeslaConfig;
}

function makeSystem(bases: readonly TestBase[] = []) {
  const owner = fakeEntity({ id: 'player-1', x: 0, y: 0, active: true });
  const enemies: { id: string; x: number; y: number }[] = [];
  const damageHandler = vi.fn();
  const lineOfSight = vi.fn(() => true);
  const playerManager = {
    getPlayer: vi.fn(() => owner),
    getAllPlayers: vi.fn(() => [owner]),
  } as unknown as PlayerManager;
  const combatSystem = {
    isAlive: vi.fn(() => true),
    isBurrowed: vi.fn(() => false),
    canDamageTarget: vi.fn(() => true),
    applyDamage: vi.fn(),
  } as unknown as CombatSystem;
  const resourceSystem = {
    getAdrenaline: vi.fn(() => 100),
    drainAdrenaline: vi.fn(),
  } as unknown as ResourceSystem;

  const system = new TeslaDomeSystem(playerManager, combatSystem, resourceSystem);
  system.setLineOfSightChecker(lineOfSight);
  system.setBaseCallbacks(() => bases, damageHandler);
  system.setEnemyTargetProvider(() => enemies);
  // Deterministischer Zufall: die Salve wird dadurch reproduzierbar prüfbar.
  system.setRandomSource(() => 0.5);

  return { system, damageHandler, lineOfSight, owner, enemies, combatSystem };
}

/** Hält die Kuppel wie im Spiel gedrückt und zieht den Host-Frame auf `now`. */
function advance(
  system: TeslaDomeSystem,
  config: TeslaConfig,
  now: number,
): ReturnType<TeslaDomeSystem['hostUpdate']>[number] | undefined {
  system.hostRefresh('player-1', 0, 0, now, config, 0xffffff);
  return system.hostUpdate(now)[0];
}

/** Legt Gegner auf einem Kreis um den Ursprung ab, damit die Reihenfolge nicht über die Nähe entscheidet. */
function spreadEnemies(
  enemies: { id: string; x: number; y: number }[],
  count: number,
  radius: number,
): void {
  for (let index = 0; index < count; index++) {
    const angle = (Math.PI * 2 * index) / count;
    enemies.push({
      id: `enemy-${index}`,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    });
  }
}

describe('Tesla dome base targets', () => {
  it('damages an active hostile base through the ordinary Tesla tick path', () => {
    const base = makeBase('hostile-base', 'hostile', 100, { x: 120, y: 0, distance: 120 });
    const config = makeConfig(['bases']);
    const { system, damageHandler, lineOfSight } = makeSystem([base]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).toHaveBeenCalledWith(
      'hostile-base',
      config.fire.damagePerTick,
      'player-1',
      'weapon2',
    );
    expect(synced[0]?.targets).toContainEqual({
      x: 120,
      y: 0,
      type: 'bases',
      targetKey: 'bases:hostile-base',
      slotIndex: 0,
    });
    expect(base.getNearestSurfacePoint).toHaveBeenCalledWith(0, 0);
    expect(lineOfSight).toHaveBeenCalledWith(0, 0, 120, 0, undefined);
  });

  it('never targets friendly or destroyed bases', () => {
    const friendly = makeBase('friendly-base', 'friendly', 100, { x: 40, y: 0, distance: 40 });
    const destroyed = makeBase('destroyed-base', 'hostile', 0, { x: 50, y: 0, distance: 50 });
    const config = makeConfig(['bases']);
    const { system, damageHandler } = makeSystem([friendly, destroyed]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).not.toHaveBeenCalled();
    expect(synced[0]?.targets).toEqual([]);
    expect(friendly.getNearestSurfacePoint).not.toHaveBeenCalled();
    expect(destroyed.getNearestSurfacePoint).not.toHaveBeenCalled();
  });

  it('uses the nearest surface point for a large base instead of its center', () => {
    // Der gedachte Mittelpunkt liegt außerhalb des Tesla-Radius; die nächstgelegene
    // Oberfläche liegt innerhalb und muss deshalb als Zielpunkt verwendet werden.
    const base = makeBase('large-hostile-base', 'hostile', 100, { x: 180, y: 0, distance: 180 });
    const config = makeConfig(['bases']);
    const { system, damageHandler, lineOfSight } = makeSystem([base]);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(config.fire.tickInterval);

    expect(damageHandler).toHaveBeenCalledTimes(1);
    expect(synced[0]?.targets[0]).toMatchObject({ x: 180, y: 0, type: 'bases' });
    expect(lineOfSight).toHaveBeenCalledWith(0, 0, 180, 0, undefined);
  });
});

describe('Tesla dome target cap and locks', () => {
  it('locks at most the configured number of primary targets', () => {
    const config = makeConfig(['enemies']);
    const { system, enemies } = makeSystem();
    spreadEnemies(enemies, 9, 100);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const synced = system.hostUpdate(0);

    expect(config.fire.maxTargets).toBe(4);
    expect(synced[0]?.targets).toHaveLength(4);
    expect(new Set(synced[0]?.targets.map(target => target.slotIndex))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('keeps existing locks and does not let a closer target displace them', () => {
    const config = makeConfig(['enemies']);
    const { system, enemies } = makeSystem();
    spreadEnemies(enemies, 4, 150);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const before = system.hostUpdate(0)[0]?.targets ?? [];
    expect(before).toHaveLength(4);

    enemies.push({ id: 'enemy-close', x: 5, y: 0 });
    const after = system.hostUpdate(1)[0]?.targets ?? [];

    expect(after.map(target => target.targetKey)).toEqual(before.map(target => target.targetKey));
    expect(after.some(target => target.targetKey === 'enemies:enemy-close')).toBe(false);
  });

  it('refills a freed slot with the nearest available target and keeps the slot index', () => {
    const config = makeConfig(['enemies']);
    const { system, enemies } = makeSystem();
    spreadEnemies(enemies, 4, 150);

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    const before = system.hostUpdate(0)[0]?.targets ?? [];
    const droppedKey = before[1].targetKey;
    const droppedSlot = before[1].slotIndex;

    // Der Nachrücker taucht erst nach dem Lock auf und ist dann der nächstgelegene Kandidat.
    enemies.push({ id: 'enemy-waiting', x: 60, y: 0 });
    enemies.splice(enemies.findIndex(enemy => `enemies:${enemy.id}` === droppedKey), 1);
    const after = advance(system, config, 1)?.targets ?? [];

    expect(after).toHaveLength(4);
    const refilled = after.find(target => target.slotIndex === droppedSlot);
    expect(refilled?.targetKey).toBe('enemies:enemy-waiting');
    for (const target of before) {
      if (target.targetKey === droppedKey) continue;
      expect(after.find(entry => entry.targetKey === target.targetKey)?.slotIndex).toBe(target.slotIndex);
    }
  });

  it('boosts primary damage with focused conductivity for every free beam', () => {
    const config = makeConfig(['enemies'], { focusedDamageBonusPerFreeTarget: 0.03 });
    const { system, enemies, combatSystem } = makeSystem();
    enemies.push({ id: 'enemy-solo', x: 50, y: 0 });

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(config.fire.tickInterval);

    // 4 MaxTargets, 1 aktives Ziel → 3 freie Strahlen → +9 %.
    expect(combatSystem.applyDamage).toHaveBeenCalledWith(
      'enemy-solo',
      config.fire.damagePerTick * 1.09,
      false,
      'player-1',
      'TESLA_DOME',
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('Tesla dome field pulse', () => {
  const chargeConfig = (overrides: Partial<TeslaDomeWeaponFireConfig> = {}): TeslaConfig =>
    makeConfig(['enemies'], { maxChargeStacks: 3, radiusBonusPerCharge: 0.1, ...overrides });

  it('starts on charge zero without a pulse and advances one step per interval', () => {
    const config = chargeConfig();
    const { system } = makeSystem();

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    expect(system.hostUpdate(0)[0]).toMatchObject({ chargeStacks: 0, pulseSequence: 0 });
    expect(advance(system, config, 999)).toMatchObject({ chargeStacks: 0, pulseSequence: 0 });
    expect(advance(system, config, 1000)).toMatchObject({ chargeStacks: 1, pulseSequence: 1 });
    expect(advance(system, config, 2000)).toMatchObject({ chargeStacks: 2, pulseSequence: 2 });
  });

  it('keeps pulsing at max charge and grows the radius per charge step', () => {
    const config = chargeConfig();
    const { system } = makeSystem();

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 1000);
    advance(system, config, 2000);
    const atMax = advance(system, config, 3000);
    expect(atMax).toMatchObject({ chargeStacks: 3, pulseSequence: 3 });
    expect(atMax?.radius).toBeCloseTo(config.fire.radius * 1.3, 5);

    const beyondMax = advance(system, config, 4000);
    expect(beyondMax?.chargeStacks).toBe(3);
    expect(beyondMax?.pulseSequence).toBe(4);
    expect(beyondMax?.radius).toBeCloseTo(config.fire.radius * 1.3, 5);
  });

  it('shortens charge and pulse cadence together with fast charge', () => {
    const config = chargeConfig({ chargeIntervalMs: 700 });
    const { system } = makeSystem();

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    expect(advance(system, config, 699)).toMatchObject({ chargeStacks: 0, pulseSequence: 0 });
    expect(advance(system, config, 700)).toMatchObject({ chargeStacks: 1, pulseSequence: 1 });
    expect(advance(system, config, 1400)).toMatchObject({ chargeStacks: 2, pulseSequence: 2 });
  });

  it('resets charge, pulse and locks on deactivation', () => {
    const config = chargeConfig();
    const { system, enemies } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 1000);
    expect(advance(system, config, 2000)).toMatchObject({ chargeStacks: 2, pulseSequence: 2 });

    system.hostDeactivateForPlayer('player-1');
    system.hostRefresh('player-1', 0, 0, 3000, config, 0xffffff);
    const restarted = system.hostUpdate(3000)[0];
    expect(restarted).toMatchObject({ chargeStacks: 0, pulseSequence: 0 });
  });

  it('raises the runtime movement factor per charge only with field stabilization', () => {
    const withoutStabilization = chargeConfig();
    const { system } = makeSystem();

    system.hostRefresh('player-1', 0, 0, 0, withoutStabilization, 0xffffff);
    system.hostUpdate(0);
    advance(system, withoutStabilization, 1000);
    advance(system, withoutStabilization, 2000);
    expect(system.getChargeStacks('player-1')).toBe(2);
    expect(system.getMovementSlowFactor('player-1')).toBeCloseTo(0.3, 5);

    const stabilized = chargeConfig({ movementRecoveryPerCharge: 0.1 });
    const stabilizedSystem = makeSystem().system;
    stabilizedSystem.hostRefresh('player-1', 0, 0, 0, stabilized, 0xffffff);
    stabilizedSystem.hostUpdate(0);
    advance(stabilizedSystem, stabilized, 1000);
    advance(stabilizedSystem, stabilized, 2000);
    expect(stabilizedSystem.getMovementSlowFactor('player-1')).toBeCloseTo(0.5, 5);

    // Der Faktor bleibt bei voller Geschwindigkeit gedeckelt.
    const cappedConfig = chargeConfig({ maxChargeStacks: 9, movementRecoveryPerCharge: 0.1 });
    const cappedSystem = makeSystem().system;
    cappedSystem.hostRefresh('player-1', 0, 0, 0, cappedConfig, 0xffffff);
    cappedSystem.hostUpdate(0);
    for (let step = 1; step <= 9; step++) advance(cappedSystem, cappedConfig, step * 1000);
    expect(cappedSystem.getMovementSlowFactor('player-1')).toBe(1);
  });

  it('reports no runtime movement factor once the dome is gone', () => {
    const { system } = makeSystem();
    expect(system.getMovementSlowFactor('player-1')).toBeNull();
  });
});

describe('Tesla dome boss effects', () => {
  const bossConfig = (overrides: Partial<TeslaDomeWeaponFireConfig> = {}): TeslaConfig =>
    makeConfig(['enemies'], { maxChargeStacks: 6, radiusBonusPerCharge: 0.1, ...overrides });

  it('applies the overcharge impulse to every locked target on each pulse', () => {
    const config = bossConfig({ overchargePulseEnabled: 1 });
    const { system, enemies, combatSystem } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    (combatSystem.applyDamage as ReturnType<typeof vi.fn>).mockClear();
    advance(system, config, 1000);

    // Erster Impuls auf Charge 1 → (5 + Charge)/2 = 3× des aufgelösten Primärschadens.
    const freeTargets = Math.max(0, (config.fire.maxTargets ?? 0) - 1);
    const focused = 1 + freeTargets * (config.fire.focusedDamageBonusPerFreeTarget ?? 0);
    const impulseMultiplier = (5 + 1) / 2;
    const impulseCalls = (combatSystem.applyDamage as ReturnType<typeof vi.fn>).mock.calls
      .filter(call => call[1] === config.fire.damagePerTick * focused * impulseMultiplier);
    expect(impulseCalls).toHaveLength(1);
  });

  it('does not fire the overcharge impulse without the boss upgrade', () => {
    const config = bossConfig();
    const { system, enemies, combatSystem } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    (combatSystem.applyDamage as ReturnType<typeof vi.fn>).mockClear();
    advance(system, config, 1000);

    const freeTargets = Math.max(0, (config.fire.maxTargets ?? 0) - 1);
    const focused = 1 + freeTargets * (config.fire.focusedDamageBonusPerFreeTarget ?? 0);
    for (const call of (combatSystem.applyDamage as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBeCloseTo(config.fire.damagePerTick * focused, 5);
    }
  });

  it('spawns piercing homing storm projectiles that skip rocks', () => {
    const config = bossConfig({ stormEnabled: 1 });
    const { system, enemies } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });
    const requests: TeslaStormProjectileRequest[] = [];
    system.setStormProjectileSpawner(request => requests.push(request));

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 1000);

    // stormProjectileBaseCount + Charge 1 Projektile, Reichweite = geladener Radius * RangeFactor.
    const expectedCount = (config.fire.stormProjectileBaseCount ?? 0) + 1;
    const chargeFactor = 1 + 1 * (config.fire.radiusBonusPerCharge ?? 0);
    const expectedRange = config.fire.radius * chargeFactor * (config.fire.stormProjectileRangeFactor ?? 1);
    expect(requests).toHaveLength(expectedCount);
    expect(requests[0].rangePx).toBeCloseTo(expectedRange, 5);
    expect(requests[0].damage).toBe(config.fire.stormProjectileDamage);
    expect(requests[0].homing?.maxTurnDegreesPerStep).toBe(
      config.fire.stormProjectileHoming?.maxTurnDegreesPerStep,
    );
    expect(requests[0].homing?.targetTypes).not.toContain('rocks');
  });

  it('fires the salvo as a narrow cone around the aim direction', () => {
    const config = bossConfig({ stormEnabled: 1 });
    const { system, enemies } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });
    const requests: TeslaStormProjectileRequest[] = [];
    system.setStormProjectileSpawner(request => requests.push(request));

    // Blickrichtung nach unten; die gesamte Salve muss ihr folgen.
    const aimAngle = Math.PI / 2;
    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff, aimAngle);
    system.hostUpdate(0);
    system.hostRefresh('player-1', 0, 0, 1000, config, 0xffffff, aimAngle);
    system.hostUpdate(1000);

    const expectedCount = (config.fire.stormProjectileBaseCount ?? 0) + 1;
    expect(requests).toHaveLength(expectedCount);
    const spread = Phaser.Math.DegToRad(config.fire.stormProjectileSpreadDegrees!);
    expect(config.fire.stormProjectileSpreadDegrees).toBeGreaterThan(0);

    // Kein Bolzen verlässt den halben Öffnungswinkel um die Blickrichtung.
    for (const request of requests) {
      expect(Math.abs(request.angle - aimAngle)).toBeLessThanOrEqual(spread / 2 + 1e-9);
    }
    // Gleichmäßig über den Kegel verteilt, mittig auf der Blickrichtung.
    const step = Math.abs(requests[1].angle - requests[0].angle);
    expect(step).toBeCloseTo(spread / (expectedCount - 1), 10);
    expect(requests[Math.floor(expectedCount / 2)].angle).toBeCloseTo(aimAngle, 10);

    // Kurzer seitlicher Versatz quer zur Blickrichtung statt eines gemeinsamen Startpunkts.
    const lateral = requests.map(request => request.x);
    expect(Math.min(...lateral)).toBeCloseTo(-config.fire.stormProjectileLateralOffsetPx!, 6);
    expect(Math.max(...lateral)).toBeCloseTo(config.fire.stormProjectileLateralOffsetPx!, 6);
    for (const request of requests) expect(request.y).toBeCloseTo(0, 6);
  });

  it('scales the storm salvo with the charge level', () => {
    const config = bossConfig({ stormEnabled: 1 });
    const { system, enemies } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });
    const requests: TeslaStormProjectileRequest[] = [];
    system.setStormProjectileSpawner(request => requests.push(request));

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 1000);
    requests.length = 0;
    advance(system, config, 2000);

    expect(requests).toHaveLength((config.fire.stormProjectileBaseCount ?? 0) + 2);
  });

  it('applies nova slow and quadratic knockback falloff without damage', () => {
    const config = bossConfig({ stormEnabled: 1 });
    const { system, enemies } = makeSystem();
    const chargeFactor = 1 + 1 * (config.fire.radiusBonusPerCharge ?? 0);
    const radiusAtChargeOne = config.fire.radius * chargeFactor;
    enemies.push({ id: 'enemy-near', x: 0, y: 0 });
    enemies.push({ id: 'enemy-half', x: radiusAtChargeOne / 2, y: 0 });
    const hits: TeslaNovaHit[] = [];
    system.setNovaHitHandler(hit => hits.push(hit));

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 1000);

    expect(hits).toHaveLength(2);
    const near = hits.find(hit => hit.targetId === 'enemy-near')!;
    const half = hits.find(hit => hit.targetId === 'enemy-half')!;
    expect(near.slowFraction).toBe(config.fire.stormNovaSlowFraction ?? 0);
    expect(near.slowDurationMs).toBe(config.fire.stormNovaSlowDurationMs ?? 0);
    // Charge-Faktor entspricht exakt der Radius-Skalierung.
    expect(near.knockback).toBeCloseTo((config.fire.stormNovaKnockback ?? 0) * chargeFactor, 5);
    expect(half.knockback).toBeCloseTo((config.fire.stormNovaKnockback ?? 0) * chargeFactor * 0.25, 5);
  });

  it('leaves the storm silent below charge one', () => {
    const config = bossConfig({ stormEnabled: 1 });
    const { system, enemies } = makeSystem();
    enemies.push({ id: 'enemy-1', x: 50, y: 0 });
    const requests: TeslaStormProjectileRequest[] = [];
    const hits: TeslaNovaHit[] = [];
    system.setStormProjectileSpawner(request => requests.push(request));
    system.setNovaHitHandler(hit => hits.push(hit));

    system.hostRefresh('player-1', 0, 0, 0, config, 0xffffff);
    system.hostUpdate(0);
    advance(system, config, 500);

    expect(requests).toHaveLength(0);
    expect(hits).toHaveLength(0);
  });
});

describe('Tesla turret construction', () => {
  it('stays dormant without enemies and activates with the shared Tesla dome visual contract', () => {
    const config = makeTurretConfig(['enemies']);
    const { system, enemies, combatSystem } = makeSystem();
    const source = {
      id: 7,
      ownerId: 'player-1',
      x: 100,
      y: 100,
      color: 0x9ae7ff,
      damageMultiplier: 1.5,
      config,
    };
    system.setConstructionSourceProvider(() => [source]);

    expect(system.hostUpdate(0)).toEqual([]);

    enemies.push({ id: 'enemy-1', x: 150, y: 100 });
    const activated = system.hostUpdate(0);
    expect(activated[0]).toMatchObject({
      ownerId: 'tesla-turret:7',
      weaponId: config.id,
      radius: config.fire.radius,
      chargeStacks: 0,
      pulseSequence: 0,
      targets: [{ x: 150, y: 100, type: 'enemies', targetKey: 'enemies:enemy-1', slotIndex: 0 }],
    });

    system.hostUpdate(config.fire.tickInterval);
    expect(combatSystem.applyDamage).toHaveBeenCalledWith(
      'enemy-1',
      config.fire.damagePerTick * 1.5,
      false,
      'player-1',
      'TURRET_TESLA',
      { sourceX: 100, sourceY: 100 },
      { damageKind: 'chain', sourceSlot: 'utility', allowCritical: true },
    );
  });

  it('keeps non-player Tesla variants uncapped, unpulsed and free of focus bonuses', () => {
    const config = makeTurretConfig(['enemies']);
    const { system, enemies, combatSystem } = makeSystem();
    spreadEnemies(enemies, 9, 40);
    system.setConstructionSourceProvider(() => [{
      id: 3,
      ownerId: 'player-1',
      x: 0,
      y: 0,
      color: 0x9ae7ff,
      config,
    }]);

    const activated = system.hostUpdate(0)[0];
    expect(config.fire.maxTargets).toBeUndefined();
    expect(config.fire.overchargePulseEnabled).toBeUndefined();
    expect(activated?.targets).toHaveLength(9);
    expect(activated?.overchargePulseEnabled).toBeUndefined();
    expect(activated?.stormEnabled).toBeUndefined();

    // Auch nach mehreren Sekunden bleibt der Turm auf Charge 0 ohne Puls.
    const later = system.hostUpdate(5000)[0];
    expect(later).toMatchObject({ chargeStacks: 0, pulseSequence: 0 });
    expect(later?.radius).toBe(config.fire.radius);

    for (const call of (combatSystem.applyDamage as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toBeCloseTo(config.fire.damagePerTick, 5);
    }
  });
});
