import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { CoopDefenseEnemyAttackSystem } from '../src/systems/CoopDefenseEnemyAttackSystem';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { LoadoutManager } from '../src/loadout/LoadoutManager';
import type { CombatSystem } from '../src/systems/CombatSystem';

const TITAN = getCoopDefenseEnemyConfig('grave-titan');
const VOID_PLASMA = WEAPON_CONFIGS.GRAVE_TITAN_VOID_PLASMA;

interface TestPlayer {
  id: string;
  sprite: { x: number; y: number; active: boolean };
}

interface TestBase {
  faction: 'friendly';
  role: 'main';
  isInert: () => boolean;
  getHp: () => number;
  getTurrets: () => readonly unknown[];
  getNearestSurfacePoint: (x: number, y: number) => { x: number; y: number; distance: number } | null;
}

interface FiredShot {
  weaponId: string;
  targetX: number;
  targetY: number;
}

type TestTitan = EnemyEntity & {
  nextScanAt: number;
  weaponLockouts: Map<string, number>;
};

function createTitan(): TestTitan {
  const weapons: EnemyAttackWeapon[] = TITAN.weapons.map((configured) => ({
    weapon: new GenericWeapon(WEAPON_CONFIGS[configured.weaponId as keyof typeof WEAPON_CONFIGS]),
    targetMode: configured.targetMode,
    minimumFireDurationMs: configured.minimumFireDurationMs ?? 0,
    playerMeleeWindupMs: configured.playerMeleeWindupMs ?? 0,
    attackMovementSpeedFactor: configured.attackMovementSpeedFactor ?? 0,
    minTargetDistancePx: configured.minTargetDistancePx ?? 0,
    salvo: configured.salvo,
  }));

  return {
    id: 'grave-titan-1',
    kind: 'grave-titan',
    faction: 'hostile',
    nextScanAt: 0,
    weaponLockouts: new Map<string, number>(),
    sprite: { x: 100, y: 100, active: true },
    getHp: () => TITAN.maxHp,
    wantsToMove: () => true,
    isPathBlocked: () => false,
    getAttackWeapons: () => weapons,
    getObstacleAttackDelayMs: () => TITAN.obstacleAttackDelayMs,
    isBurrowed: () => false,
    decayWeaponSpread: () => {},
    rollWeaponSpreadOffset: () => 0,
    faceAngle: () => {},
    canScanForAttack(now: number) { return now >= this.nextScanAt; },
    scheduleNextAttackScan(now: number) { this.nextScanAt = now + TITAN.attackScanIntervalMs; },
    isWeaponReady(weapon: GenericWeapon, now: number) {
      return !weapon.isOnCooldown(now) && now >= (this.weaponLockouts.get(weapon.config.id) ?? 0);
    },
    lockWeaponUntil(weapon: GenericWeapon, readyAt: number) {
      this.weaponLockouts.set(weapon.config.id, Math.max(this.weaponLockouts.get(weapon.config.id) ?? 0, readyAt));
    },
    recordWeaponUse: (weapon: GenericWeapon, now: number) => { weapon.recordUse(now); weapon.addSpread(); },
    pauseAttackMovement: () => {},
  } as unknown as TestTitan;
}

function createAttackSystem(
  enemy: TestTitan,
  players: readonly TestPlayer[],
  bases: readonly TestBase[] = [],
) {
  const shots: FiredShot[] = [];
  const system = new CoopDefenseEnemyAttackSystem(
    {
      getAllEnemies: () => [enemy],
      getAlliedEnemies: () => [],
      getEnemy: () => undefined,
      hasEnemy: (id: string) => id === enemy.id,
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager,
    {
      getAllPlayers: () => players,
      getPlayer: (id: string) => players.find((player) => player.id === id),
    } as unknown as PlayerManager,
    {
      getBasesByFaction: (faction: 'friendly' | 'hostile') => faction === 'friendly' ? bases : [],
    } as unknown as BaseManager,
    {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
      hasClearLineOfFire: () => true,
    } as unknown as CombatSystem,
    {
      fireAutomatedWeapon: (
        config: { id: string },
        _originX: number,
        _originY: number,
        _angle: number,
        targetX: number,
        targetY: number,
      ) => {
        shots.push({ weaponId: config.id, targetX, targetY });
        return true;
      },
    } as unknown as LoadoutManager,
    () => [],
  );

  return { system, shots };
}

function runAttackFrames(
  system: CoopDefenseEnemyAttackSystem,
  fromMs: number,
  untilMs: number,
  stepMs = 10,
): void {
  for (let now = fromMs; now <= untilMs; now += stepMs) {
    system.hostUpdate(stepMs, now);
  }
}

describe('Grufttitan Void-Plasma', () => {
  it('uses the current Map 10 rocket salvo balance contract', () => {
    const salvo = TITAN.weapons.find((weapon) => weapon.weaponId === VOID_PLASMA.id)?.salvo;
    const fire = VOID_PLASMA.fire as {
      type?: string;
      projectileSpeed?: number;
      homing?: { maxTurnDegreesPerStep?: number };
    };
    expect(VOID_PLASMA.range).toBe(900);
    expect(VOID_PLASMA.damage).toBe(8);
    expect(VOID_PLASMA.projectileColor).toBe(0xb347ff);
    expect(fire.type).toBe('projectile');
    expect(fire.projectileSpeed).toBe(370);
    expect(VOID_PLASMA.energyBallVariant).toBe('plasma');
    expect(fire.homing?.maxTurnDegreesPerStep).toBe(12);
    expect(salvo).toEqual({
      count: 12,
      intervalMs: 90,
      cooldownMs: 5000,
      targetDistribution: 'round_robin',
    });
    expect(TITAN.weapons.find((weapon) => weapon.weaponId === VOID_PLASMA.id)?.minTargetDistancePx).toBe(200);
  });

  it('waits outside the range band, then fires the balanced salvo over multiple players', () => {
    const players = [
      { id: 'p1', sprite: { x: 500, y: 100, active: true } },
      { id: 'p2', sprite: { x: 700, y: 100, active: true } },
    ];
    const enemy = createTitan();
    const { system, shots } = createAttackSystem(enemy, players);

    players[0].sprite.x = 1_200;
    players[1].sprite.x = 1_300;
    runAttackFrames(system, 1_000, 1_500);
    expect(shots).toEqual([]);

    players[0].sprite.x = 500;
    players[1].sprite.x = 700;
    runAttackFrames(system, 1_510, 2_800);

    expect(shots).toHaveLength(12);
    expect(shots.every((shot) => shot.weaponId === VOID_PLASMA.id)).toBe(true);
    expect(shots.filter((shot) => shot.targetX === 500)).toHaveLength(6);
    expect(shots.filter((shot) => shot.targetX === 700)).toHaveLength(6);
  });

  it('does not target players inside 200 px, including during an active salvo', () => {
    const players = [{ id: 'p1', sprite: { x: 250, y: 100, active: true } }];
    const enemy = createTitan();
    const { system, shots } = createAttackSystem(enemy, players);

    runAttackFrames(system, 1_000, 2_000);
    expect(shots).toEqual([]);

    players[0].sprite.x = 600;
    runAttackFrames(system, 2_010, 2_140);
    expect(shots).toHaveLength(1);

    players[0].sprite.x = 250;
    runAttackFrames(system, 2_070, 2_200);
    expect(shots).toHaveLength(1);
  });

  it('greift eine erreichbare Basis waehrend des Plasma-Cooldowns an und setzt Plasma danach fort', () => {
    const players = [{ id: 'p1', sprite: { x: 500, y: 100, active: true } }];
    const bases: TestBase[] = [{
      faction: 'friendly',
      role: 'main',
      isInert: () => false,
      getHp: () => 1_000,
      getTurrets: () => [],
      getNearestSurfacePoint: () => ({ x: 200, y: 100, distance: 100 }),
    }];
    const enemy = createTitan();
    const { system, shots } = createAttackSystem(enemy, players, bases);

    runAttackFrames(system, 1_000, 7_200);

    const weaponIds = shots.map((shot) => shot.weaponId);
    const firstBiteIndex = weaponIds.indexOf('GRAVE_TITAN_BITE');
    expect(weaponIds.slice(0, 12).every((weaponId) => weaponId === VOID_PLASMA.id)).toBe(true);
    expect(firstBiteIndex).toBeGreaterThanOrEqual(12);
    expect(shots[firstBiteIndex]).toMatchObject({
      weaponId: 'GRAVE_TITAN_BITE',
      targetX: 200,
      targetY: 100,
    });
    expect(weaponIds.slice(firstBiteIndex + 1)).toContain(VOID_PLASMA.id);
  });
});
