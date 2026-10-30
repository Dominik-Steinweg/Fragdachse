import { fakeEntity } from './fakeEntity';
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

import { enemyBodyRadius, getCoopDefenseEnemyConfig, type CoopDefenseEnemyWeaponSalvoConfig } from '../src/config/coopDefenseEnemies';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { CoopDefenseEnemyAttackSystem } from '../src/systems/CoopDefenseEnemyAttackSystem';
import {
  EMPTY_ENEMY_VOLLEY_STATE, enemyVolleyPhaseAt, isEnemyVolleyCancelled, type EnemyVolleyState,
} from '../src/systems/EnemyVolleyState';
import { decodeEnemyUpserts, encodeEnemyUpsert } from '../src/network/enemySnapshotCodec';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import type { AutomatedWeaponExecution } from '../src/world/AutomatedWeaponExecutionAdapter';

const TITAN = getCoopDefenseEnemyConfig('grave-titan');
const VOID_PLASMA = WEAPON_CONFIGS.GRAVE_TITAN_VOID_PLASMA;
const VOID_PLASMA_ATTACK = TITAN.weapons.find((weapon) => weapon.weaponId === VOID_PLASMA.id)!;
const SALVO = VOID_PLASMA_ATTACK.salvo!;
const CHARGE_MS = SALVO.chargeMs ?? 0;
const SLAM_TIMING = TITAN.weapons.find((weapon) => weapon.weaponId === 'GRAVE_TITAN_SLAM')!.meleeTiming!;
const STOMP_RANGE = WEAPON_CONFIGS.GRAVE_TITAN_STOMP.range;
const STOMP_TIMING = TITAN.weapons.find((weapon) => weapon.weaponId === 'GRAVE_TITAN_STOMP')!.meleeTiming!;
const MELEE_IDS = ['GRAVE_TITAN_STOMP', 'GRAVE_TITAN_SLAM'];

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
  volley: EnemyVolleyState;
};

function createTitan(salvoOverride?: CoopDefenseEnemyWeaponSalvoConfig): TestTitan {
  const weapons: EnemyAttackWeapon[] = TITAN.weapons.map((configured) => ({
    weapon: new GenericWeapon(WEAPON_CONFIGS[configured.weaponId as keyof typeof WEAPON_CONFIGS]),
    targetMode: configured.targetMode,
    minimumFireDurationMs: configured.minimumFireDurationMs ?? 0,
    meleeTiming: configured.meleeTiming,
    attackMovementSpeedFactor: configured.attackMovementSpeedFactor ?? 0,
    minTargetDistancePx: configured.minTargetDistancePx ?? 0,
    salvo: configured.salvo && salvoOverride ? salvoOverride : configured.salvo,
    muzzleForwardPx: configured.muzzleForwardPx ?? 0,
    usableDuringPriorityPause: configured.usableDuringPriorityPause,
    structureReachPx: configured.structureReachPx,
  }));

  return {
    id: 'grave-titan-1',
    kind: 'grave-titan',
    faction: 'hostile',
    nextScanAt: 0,
    weaponLockouts: new Map<string, number>(),
    volley: EMPTY_ENEMY_VOLLEY_STATE,
    sprite: { x: 100, y: 100, active: true },
    getHp: () => TITAN.maxHp,
    wantsToMove: () => true,
    isPathBlocked: () => false,
    getAttackWeapons: () => weapons,
    getObstacleAttackDelayMs: () => TITAN.obstacleAttackDelayMs,
    isBurrowed: () => false,
    decayWeaponSpread: () => {},
    rollWeaponSpreadOffset: () => 0,
    getCollisionRadius: () => TITAN.size / 2,
    getAimAngle: () => 0,
    faceAngle: () => {},
    getTurnRateRadPerMs: () => TITAN.turnRateDegPerSec === undefined ? null : TITAN.turnRateDegPerSec * Math.PI / 180_000,
    stopMovement: () => {},
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
    getVolleyState() { return this.volley; },
    applyVolleyState(state: EnemyVolleyState) { if (state.revision > this.volley.revision) this.volley = state; },
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
      canSeeThroughSmoke: () => true,
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
      fire: (config: { id: string }, params: { targetX: number; targetY: number }) => {
        shots.push({ weaponId: config.id, targetX: params.targetX, targetY: params.targetY });
        return true;
      },
    } as unknown as AutomatedWeaponExecution,
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

/** Host times of every plasma shot of one salvo against a single player in the range band. */
function plasmaShotTimes(salvoOverride?: CoopDefenseEnemyWeaponSalvoConfig): number[] {
  const players = [fakeEntity({ id: 'p1', x: 500, y: 100, active: true })];
  const enemy = createTitan(salvoOverride);
  const { system, shots } = createAttackSystem(enemy, players);
  const times: number[] = [];
  for (let now = 1_000; now <= 1_000 + CHARGE_MS + 3_000; now += 10) {
    const before = shots.length;
    system.hostUpdate(10, now);
    if (shots.length > before && shots.at(-1)!.weaponId === VOID_PLASMA.id) times.push(now);
  }
  return times;
}

describe('Grufttitan Void-Plasma', () => {
  it('waits outside the range band, then distributes one configured salvo over multiple players', () => {
    const minTargetDistance = VOID_PLASMA_ATTACK.minTargetDistancePx ?? 0;
    const inRangeDistance = minTargetDistance + 50;
    expect(inRangeDistance).toBeLessThan(VOID_PLASMA.range);
    const players = [
      fakeEntity({ id: 'p1', x: 100 + inRangeDistance, y: 100, active: true }),
      fakeEntity({ id: 'p2', x: 100 + inRangeDistance + 100, y: 100, active: true }),
    ];
    const enemy = createTitan();
    // Only the plasma is under test: both players stand inside the stomp's pressure wave.
    for (const id of MELEE_IDS) enemy.weaponLockouts.set(id, Number.MAX_SAFE_INTEGER);
    const { system, shots } = createAttackSystem(enemy, players);

    players[0].sprite.x = 100 + VOID_PLASMA.range + 100;
    players[1].sprite.x = 100 + VOID_PLASMA.range + 200;
    runAttackFrames(system, 1_000, 1_500);
    expect(shots).toEqual([]);

    players[0].sprite.x = 100 + inRangeDistance;
    players[1].sprite.x = 100 + inRangeDistance + 100;
    runAttackFrames(system, 1_510, 1_510 + TITAN.attackScanIntervalMs + CHARGE_MS + SALVO.intervalMs * (SALVO.count + 2));

    expect(shots).toHaveLength(SALVO.count);
    expect(shots.every((shot) => shot.weaponId === VOID_PLASMA.id)).toBe(true);
    expect(shots.filter((shot) => shot.targetX === players[0].sprite.x)).toHaveLength(Math.ceil(SALVO.count / 2));
    expect(shots.filter((shot) => shot.targetX === players[1].sprite.x)).toHaveLength(Math.floor(SALVO.count / 2));
  });

  it('does not target players inside the configured minimum distance, including during an active salvo', () => {
    const minTargetDistance = VOID_PLASMA_ATTACK.minTargetDistancePx ?? 0;
    const players = [fakeEntity({ id: 'p1', x: 100 + Math.max(0, minTargetDistance - 1), y: 100, active: true })];
    const enemy = createTitan();
    // Only the plasma is under test here; the slam would otherwise reach a player this close.
    for (const id of ['GRAVE_TITAN_STOMP', 'GRAVE_TITAN_SLAM']) enemy.weaponLockouts.set(id, Number.MAX_SAFE_INTEGER);
    const { system, shots } = createAttackSystem(enemy, players);

    runAttackFrames(system, 1_000, 2_000);
    expect(shots).toEqual([]);
    expect(enemy.volley.revision).toBe(0);

    players[0].sprite.x = 100 + minTargetDistance + 1;
    runAttackFrames(system, 2_010, 2_010 + TITAN.attackScanIntervalMs);
    expect(enemyVolleyPhaseAt(enemy.volley, 2_010 + TITAN.attackScanIntervalMs)).toBe('charge');
    const fireAt = enemy.volley.fireAt;
    runAttackFrames(system, 2_020 + TITAN.attackScanIntervalMs, fireAt + 40);
    expect(shots).toHaveLength(1);

    players[0].sprite.x = 100 + Math.max(0, minTargetDistance - 1);
    runAttackFrames(system, fireAt + 50, fireAt + 200);
    expect(shots).toHaveLength(1);
  });

  it('announces the salvo with a gather phase that delays only its first shot', () => {
    expect(CHARGE_MS).toBeGreaterThan(0);
    const withCharge = plasmaShotTimes();
    const withoutCharge = plasmaShotTimes({ ...SALVO, chargeMs: undefined });

    expect(withCharge).toHaveLength(SALVO.count);
    expect(withCharge[0] - withoutCharge[0]).toBe(CHARGE_MS);
    expect(withCharge.map(time => time - withCharge[0])).toEqual(withoutCharge.map(time => time - withoutCharge[0]));
  });

  it('replicates the gather, the end of the salvo and its recharge', () => {
    const players = [fakeEntity({ id: 'p1', x: 500, y: 100, active: true })];
    const enemy = createTitan();
    const { system, shots } = createAttackSystem(enemy, players);
    let lastShotAt = 0;
    for (let now = 1_000; now <= 1_000 + CHARGE_MS + 3_000; now += 10) {
      const before = shots.length;
      system.hostUpdate(10, now);
      if (shots.length > before) lastShotAt = now;
    }

    const volley = enemy.volley;
    expect(volley.fireAt - volley.chargeStartAt).toBe(CHARGE_MS);
    expect(volley.endedAt).toBe(lastShotAt);
    expect(volley.rechargedAt - volley.endedAt).toBe(SALVO.cooldownMs);
    expect(volley.shotsFired).toBe(SALVO.count);
    expect(isEnemyVolleyCancelled(volley)).toBe(false);
    expect(enemyVolleyPhaseAt(volley, volley.chargeStartAt + 1)).toBe('charge');
    expect(enemyVolleyPhaseAt(volley, volley.endedAt + 1)).toBe('recharge');
    expect(enemyVolleyPhaseAt(volley, volley.rechargedAt)).toBe('ready');
  });

  it('spends a gathered salvo whose target left, so it cannot gather again before the pause ends', () => {
    const players = [fakeEntity({ id: 'p1', x: 500, y: 100, active: true })];
    const enemy = createTitan();
    for (const id of MELEE_IDS) enemy.weaponLockouts.set(id, Number.MAX_SAFE_INTEGER);
    const { system, shots } = createAttackSystem(enemy, players);

    runAttackFrames(system, 1_000, 1_100);
    expect(enemyVolleyPhaseAt(enemy.volley, 1_100)).toBe('charge');
    const { revision, fireAt } = enemy.volley;
    players[0].sprite.x = 100 + VOID_PLASMA.range + 400;
    runAttackFrames(system, 1_110, fireAt + 100);

    expect(shots).toEqual([]);
    expect(isEnemyVolleyCancelled(enemy.volley)).toBe(true);
    expect(enemy.volley.rechargedAt - enemy.volley.endedAt).toBe(SALVO.cooldownMs);

    players[0].sprite.x = 500;
    runAttackFrames(system, fireAt + 110, enemy.volley.rechargedAt - 20);
    expect(shots).toEqual([]);
    expect(enemy.volley.revision).toBe(revision + 1);
    runAttackFrames(system, enemy.volley.rechargedAt - 10, enemy.volley.rechargedAt + TITAN.attackScanIntervalMs + 20);
    expect(enemy.volley.revision).toBe(revision + 2);
  });

  it('keeps striking a base in reach while its salvo gathers, and still fires the whole salvo', () => {
    // A plasma target beyond the stomp's wave, and a base right ahead.
    const players = [fakeEntity({ id: 'p1', x: 100 + STOMP_RANGE + 60, y: 100, active: true })];
    const bases: TestBase[] = [{
      faction: 'friendly', role: 'main', isInert: () => false, getHp: () => 1_000, getTurrets: () => [],
      getNearestSurfacePoint: () => ({ x: 200, y: 100, distance: 100 }),
    }];
    const enemy = createTitan();
    const { system, shots } = createAttackSystem(enemy, players, bases);
    const windups: { at: number; weaponId: string }[] = [];
    let clock = 0;
    system.setClawStateSink((_enemy, state) => { if (state.attack) windups.push({ at: clock, weaponId: state.attack.weaponId }); });

    for (clock = 1_000; clock <= 1_000 + CHARGE_MS + SALVO.intervalMs * SALVO.count * 2 + STOMP_TIMING.hitDelayMs; clock += 10) {
      system.hostUpdate(10, clock);
    }

    const { chargeStartAt, fireAt } = enemy.volley;
    expect(fireAt - chargeStartAt).toBe(CHARGE_MS);
    expect(windups.some(windup => windup.at >= chargeStartAt && windup.at < fireAt)).toBe(true);
    expect(shots.filter(shot => shot.weaponId === VOID_PLASMA.id)).toHaveLength(SALVO.count);
    expect(shots.find(shot => MELEE_IDS.includes(shot.weaponId))).toMatchObject({ targetX: 200, targetY: 100 });
  });

  it('schlaegt waehrend der Plasma-Pause zur Basis statt in Richtung des fernen Spielers', () => {
    // Beyond the stomp's pressure wave, but a plasma target.
    const players = [fakeEntity({ id: 'p1', x: 100 + STOMP_RANGE + 60, y: 100, active: true })];
    const bases: TestBase[] = [{
      faction: 'friendly',
      role: 'main',
      isInert: () => false,
      getHp: () => 1_000,
      getTurrets: () => [],
      getNearestSurfacePoint: () => ({ x: 100, y: 200, distance: 100 }),
    }];
    const enemy = createTitan();
    let aim = 0;
    Object.assign(enemy, { getAimAngle: () => aim, faceAngle: (angle: number) => { aim = angle; } });
    const { system } = createAttackSystem(enemy, players, bases);
    const slamAngles: number[] = [];
    system.setClawStateSink((_enemy, state) => { if (state.attack?.weaponId === 'GRAVE_TITAN_SLAM') slamAngles.push(state.attack.angle); });

    // Locomotion reads the combat aim before the attack update of the same host step.
    for (let now = 1_000; now <= 1_000 + CHARGE_MS + SALVO.intervalMs * (SALVO.count + 1) + 2_000; now += 10) {
      const movement = system.getCombatMovement(enemy, now);
      if (movement) aim = movement.aimAngle;
      system.hostUpdate(10, now);
    }

    expect(slamAngles.length).toBeGreaterThan(0);
    for (const angle of slamAngles) expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('stomps players and bases in its wave at most every 3 s and slams in between, even while the plasma waits', () => {
    const radius = TITAN.size / 2;
    const players = [fakeEntity({ id: 'hugger', x: 100 + radius + 30, y: 100, active: true })];
    const enemy = createTitan();
    enemy.weaponLockouts.set(VOID_PLASMA.id, Number.MAX_SAFE_INTEGER);
    const { system } = createAttackSystem(enemy, players);
    const windups: { at: number; weaponId: string; hitAt: number }[] = [];
    let clock = 0;
    system.setClawStateSink((_enemy, state) => {
      if (state.attack) windups.push({ at: clock, weaponId: state.attack.weaponId, hitAt: state.attack.hitAt });
    });
    for (clock = 1_000; clock <= 9_000; clock += 10) system.hostUpdate(10, clock);

    const stomps = windups.filter(windup => windup.weaponId === 'GRAVE_TITAN_STOMP');
    expect(windups[0].weaponId).toBe('GRAVE_TITAN_STOMP');
    expect(stomps.length).toBeGreaterThanOrEqual(2);
    expect(stomps[1].at - stomps[0].hitAt).toBeGreaterThanOrEqual(WEAPON_CONFIGS.GRAVE_TITAN_STOMP.cooldown);
    // While the stomp cools down, the slam keeps the hugger busy.
    expect(windups.some(windup => windup.weaponId === 'GRAVE_TITAN_SLAM' && windup.at > stomps[0].at && windup.at < stomps[1].at)).toBe(true);
  });

  it('steps up to a base before it strikes it, although both strikes reach further', () => {
    for (const id of MELEE_IDS) {
      const weapon = TITAN.weapons.find((candidate) => candidate.weaponId === id)!;
      expect(weapon.structureReachPx).toBeLessThan(WEAPON_CONFIGS[id as keyof typeof WEAPON_CONFIGS].range);
    }
    const reach = Math.max(...MELEE_IDS.map(id => TITAN.weapons.find((weapon) => weapon.weaponId === id)!.structureReachPx!));
    let distance = reach + 30;
    const bases: TestBase[] = [{
      faction: 'friendly', role: 'main', isInert: () => false, getHp: () => 1_000, getTurrets: () => [],
      getNearestSurfacePoint: () => ({ x: 100 + distance, y: 100, distance }),
    }];
    const enemy = createTitan();
    enemy.weaponLockouts.set(VOID_PLASMA.id, Number.MAX_SAFE_INTEGER);
    const { system } = createAttackSystem(enemy, [], bases);
    const strikes: string[] = [];
    system.setClawStateSink((_enemy, state) => { if (state.attack) strikes.push(state.attack.weaponId); });

    runAttackFrames(system, 1_000, 2_000);
    expect(strikes).toEqual([]);
    distance = reach - 10;
    runAttackFrames(system, 2_010, 2_500);
    expect(strikes).toEqual(['GRAVE_TITAN_STOMP']);
  });

  it('has a body that covers its legs, and reaches structures from beyond that body', () => {
    expect(enemyBodyRadius(TITAN)).toBeGreaterThan(TITAN.size / 2 * 1.5);
    // A structure reach inside the body could never be met: walls stop the body before it.
    for (const id of MELEE_IDS) {
      expect(TITAN.weapons.find((weapon) => weapon.weaponId === id)!.structureReachPx!).toBeGreaterThan(enemyBodyRadius(TITAN) + 60);
    }
  });

  it('turns its slow body towards a base before it rears for a slam', () => {
    const bases: TestBase[] = [{
      faction: 'friendly', role: 'main', isInert: () => false, getHp: () => 1_000, getTurrets: () => [],
      getNearestSurfacePoint: () => ({ x: 100, y: 200, distance: 100 }),
    }];
    const enemy = createTitan();
    // The stomp strikes all around and needs no facing.
    for (const id of [VOID_PLASMA.id, 'GRAVE_TITAN_STOMP']) enemy.weaponLockouts.set(id, Number.MAX_SAFE_INTEGER);
    let aim = Math.PI;
    Object.assign(enemy, { getAimAngle: () => aim });
    const { system } = createAttackSystem(enemy, [], bases);
    const slams: number[] = [];
    system.setClawStateSink((_enemy, state) => { if (state.attack) slams.push(state.attack.angle); });

    runAttackFrames(system, 1_000, 2_000);
    expect(slams).toEqual([]);
    aim = Math.PI / 2 + 0.2;
    runAttackFrames(system, 2_010, 2_500);
    expect(slams.length).toBe(1);
    expect(slams[0]).toBeCloseTo(Math.PI / 2, 5);
  });

  it('round-trips the volley timeline and stays aligned after an invalid state', () => {
    const state: EnemyVolleyState = { revision: 4, chargeStartAt: 1_000, fireAt: 1_800, endedAt: 2_610, rechargedAt: 12_610, shotsFired: 10 };
    const invalid = { revision: 5, chargeStartAt: 3_000, fireAt: 3_800, endedAt: 3_900, rechargedAt: 0, shotsFired: 2 };
    const out: (number | string)[] = [];
    encodeEnemyUpsert(out, { id: 'e1', volley: invalid as EnemyVolleyState });
    encodeEnemyUpsert(out, { id: 'e2', volley: state, hp: 12, maxHp: 20 });
    const [first, second] = decodeEnemyUpserts(out);
    expect(first.volley).toBeUndefined();
    expect(second).toMatchObject({ id: 'e2', volley: state, hp: 12, maxHp: 20 });
  });
});
