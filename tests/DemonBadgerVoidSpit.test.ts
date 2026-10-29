import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    Angle: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1) },
  },
}));

import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { CoopDefenseEnemyAttackSystem, type EnemyFlameGroundCell } from '../src/systems/CoopDefenseEnemyAttackSystem';
import type { BaseManager } from '../src/entities/BaseManager';
import type { EnemyAttackWeapon, EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import type { AutomatedWeaponExecution } from '../src/world/AutomatedWeaponExecutionAdapter';

const DEMON = getCoopDefenseEnemyConfig('demon-badger');
const SPIT = WEAPON_CONFIGS.DEMON_BADGER_VOID_SPIT;
const SALVO = DEMON.weapons.find(weapon => weapon.weaponId === SPIT.id)!.salvo!;

type TestBadger = EnemyEntity & { nextScanAt: number; weaponLockouts: Map<string, number> };

function createBadger(faction: 'hostile' | 'allied' = 'hostile'): TestBadger {
  const weapons: EnemyAttackWeapon[] = DEMON.weapons.map(configured => ({
    weapon: new GenericWeapon(WEAPON_CONFIGS[configured.weaponId as keyof typeof WEAPON_CONFIGS]),
    targetMode: configured.targetMode, minimumFireDurationMs: configured.minimumFireDurationMs ?? 0,
    meleeTiming: configured.meleeTiming, attackMovementSpeedFactor: configured.attackMovementSpeedFactor ?? 0,
    minTargetDistancePx: configured.minTargetDistancePx ?? 0, salvo: configured.salvo, muzzleForwardPx: configured.muzzleForwardPx ?? 0,
  }));
  return {
    id: 'demon-1', kind: 'demon-badger', faction, nextScanAt: 0, weaponLockouts: new Map<string, number>(),
    sprite: { x: 100, y: 100, active: true }, getHp: () => DEMON.maxHp, wantsToMove: () => true, isPathBlocked: () => false,
    getAttackWeapons: () => weapons, getObstacleAttackDelayMs: () => DEMON.obstacleAttackDelayMs, isBurrowed: () => false,
    decayWeaponSpread: () => {}, rollWeaponSpreadOffset: () => 0, getCollisionRadius: () => DEMON.size / 2,
    getAimAngle: () => 0, faceAngle: () => {}, stopMovement: () => {},
    canScanForAttack(now: number) { return now >= this.nextScanAt; },
    scheduleNextAttackScan(now: number) { this.nextScanAt = now + DEMON.attackScanIntervalMs; },
    isWeaponReady(weapon: GenericWeapon, now: number) {
      return !weapon.isOnCooldown(now) && now >= (this.weaponLockouts.get(weapon.config.id) ?? 0);
    },
    lockWeaponUntil(weapon: GenericWeapon, readyAt: number) {
      this.weaponLockouts.set(weapon.config.id, Math.max(this.weaponLockouts.get(weapon.config.id) ?? 0, readyAt));
    },
    recordWeaponUse: (weapon: GenericWeapon, now: number) => { weapon.recordUse(now); weapon.addSpread(); },
    pauseAttackMovement: () => {},
  } as unknown as TestBadger;
}

function createSystem(enemy: TestBadger, players: readonly ReturnType<typeof fakeEntity>[], surface: { x: number; y: number } | null) {
  const shots: { weaponId: string; muzzle?: { x: number; y: number } }[] = [];
  const cells: { x: number; y: number; cell: EnemyFlameGroundCell }[] = [];
  const bases = surface ? [{ id: 'base-main', faction: 'friendly', role: 'main', isInert: () => false, getHp: () => 1_000, getTurrets: () => [],
    getNearestSurfacePoint: () => ({ ...surface, distance: Math.hypot(surface.x - 100, surface.y - 100) }) }] : [];
  const system = new CoopDefenseEnemyAttackSystem(
    { getAllEnemies: () => [enemy], canSeeThroughSmoke: () => true, getAlliedEnemies: () => [], getEnemy: () => undefined,
      hasEnemy: (id: string) => id === enemy.id, isEnemyPanicking: () => false } as unknown as EnemyManager,
    { getAllPlayers: () => players, getPlayer: (id: string) => players.find(player => player.id === id) } as unknown as PlayerManager,
    { getBasesByFaction: (faction: string) => faction === 'friendly' ? bases : [] } as unknown as BaseManager,
    { isAlive: () => true, isBurrowed: () => false, canDamageTarget: () => true, hasLineOfSight: () => true,
      hasClearLineOfFire: () => true } as unknown as CombatSystem,
    { fire: (config: { id: string }, params: { visualMuzzleOrigin?: { x: number; y: number } }) => {
      shots.push({ weaponId: config.id, muzzle: params.visualMuzzleOrigin }); return true;
    } } as unknown as AutomatedWeaponExecution,
    () => [],
  );
  const scorches: { baseId: string; damage: number }[] = [];
  system.setFlameGround({ ignite: (_enemy, x, y, cell) => { cells.push({ x, y, cell }); },
    scorchBase: (_enemy, baseId, damage) => { scorches.push({ baseId, damage }); } });
  return { system, shots, cells, scorches };
}

const run = (system: CoopDefenseEnemyAttackSystem, from: number, to: number) => {
  for (let now = from; now <= to; now += 10) system.hostUpdate(10, now);
};

describe('Demon Badger void spit', () => {
  it('spits a short salvo from its mouth and sets the ground behind the player on fire once the burst ends', () => {
    const players = [fakeEntity({ id: 'p1', x: 250, y: 100, active: true })];
    const { system, shots, cells } = createSystem(createBadger(), players, null);
    run(system, 1_000, 1_000 + SALVO.intervalMs * (SALVO.count + 1));
    expect(shots.filter(shot => shot.weaponId === SPIT.id)).toHaveLength(SALVO.count);
    expect(shots[0].muzzle!.x).toBeGreaterThan(100);
    // One ignition per finished burst: two cells at the end of the flames, just beyond the target.
    expect(cells).toHaveLength(2);
    expect(Math.max(...cells.map(cell => cell.x))).toBeGreaterThan(250);
    expect(Math.max(...cells.map(cell => cell.x))).toBeLessThanOrEqual(100 + SPIT.range);
    expect(cells[0].cell).toMatchObject({ visualStyle: 'void', damageTarget: 'players', sourceId: 'enemy.demon-badger.spit_fire' });
    // Then the burst pauses: no sustained stream.
    const after = shots.length;
    run(system, 1_000 + SALVO.intervalMs * (SALVO.count + 2), 1_000 + SALVO.intervalMs * (SALVO.count + 2) + SALVO.cooldownMs / 2);
    expect(shots.length).toBe(after);
  });

  it('spits at a reachable base, scorches it with every flame and ignites inside its wall', () => {
    const { system, shots, cells, scorches } = createSystem(createBadger(), [], { x: 240, y: 100 });
    run(system, 1_000, 1_000 + SALVO.intervalMs * (SALVO.count + 1));
    expect(shots.length).toBeGreaterThan(0);
    expect(shots.every(shot => shot.weaponId === WEAPON_CONFIGS.DEMON_BADGER_VOID_SPIT_SIEGE.id)).toBe(true);
    // Enemy flames never hurt a base by contact: each shot at it deals its share directly, so spitters add up.
    const siege = WEAPON_CONFIGS.DEMON_BADGER_VOID_SPIT_SIEGE;
    expect(scorches).toHaveLength(shots.length);
    for (const scorch of scorches) expect(scorch.damage).toBeCloseTo(siege.damage * (siege.baseDamageMult ?? 1));
    expect(siege.baseDamageMult).toBeGreaterThan(0);
    expect(cells.length).toBeGreaterThan(0);
    expect(Math.max(...cells.map(cell => cell.x))).toBeGreaterThan(240);
  });

  it('burns in allied fire against enemies when the badger is a necromancy ally', () => {
    const players = [fakeEntity({ id: 'p1', x: 250, y: 100, active: true })];
    const { system, cells } = createSystem(createBadger('allied'), players, null);
    run(system, 1_000, 1_000 + SALVO.intervalMs * (SALVO.count + 1));
    for (const cell of cells) expect(cell.cell).toMatchObject({ visualStyle: 'allied', damageTarget: 'enemies' });
  });
});
