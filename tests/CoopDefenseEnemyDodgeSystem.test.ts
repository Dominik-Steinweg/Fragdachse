import { fakeEntity } from './fakeEntity';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Distance: { Between: (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay) } },
}));

import * as configs from '../src/config/coopDefenseEnemies';
import { DASH_T1_S, DASH_T2_S } from '../src/config';
afterEach(() => vi.restoreAllMocks());

import { CoopDefenseEnemyDodgeSystem } from '../src/systems/CoopDefenseEnemyDodgeSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import type { ProjectileThreatReadPort } from '../src/projectile/ProjectileReadPorts';

function buildSystem(projectileX: number, kind = 'pyro-badger') {
  const enemy = fakeEntity({ id: 'enemy-1',
    kind,
    faction: 'hostile', active: true, x: 255, y: 100, getHp: () => 10,
    getMaxHp: () => 100,
    getCollisionRadius: () => 16,
    getMoveSpeed: () => 100,
    getSpecialAction: () => 'none',
    isBurrowed: () => false }) as unknown as EnemyEntity;
  const projectile = {
    id: 1,
    x: projectileX,
    y: 100,
    vx: -200,
    vy: 0,
    radius: 4,
    dodgeRelevant: true,
    provenance: {
      gameplaySourceId: 'player-1',
      attributionId: 'player-1',
      allegiance: { ownerId: 'player-1', allowTeamDamage: false },
    },
  };
  const startEnemyDash = vi.fn(() => true);
  const players: { id: string; active: boolean; x: number; y: number }[] = [];
  const isFree = vi.fn(() => true), path = vi.fn(() => true);
  let dashing = false;
  const system = new CoopDefenseEnemyDodgeSystem(
    {
      getEnemy: () => enemy,
      forEachEnemy: (visit: (candidate: EnemyEntity) => void) => visit(enemy),
      hasEnemy: () => false,
      canSeeThroughSmoke: () => true,
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager,
    { getAllPlayers: () => players } as unknown as PlayerManager,
    { getThreatSamples: () => [projectile] } satisfies ProjectileThreatReadPort,
    {
      canDamageTarget: () => true,
      isAlive: () => true,
      isBurrowed: () => false,
      hasLineOfSight: () => true,
    } as unknown as CombatSystem,
    {
      isEnemyDashing: () => dashing,
      startEnemyDash,
    } as unknown as HostPhysicsSystem,
    isFree, path,
  );
  return { system, startEnemyDash, enemy, projectile, players, isFree, path, setDashing: (value: boolean) => { dashing = value; } };
}

describe('CoopDefenseEnemyDodgeSystem', () => {
  it('honors a composed ability block and releases dodge after the commit', () => {
    const { system, startEnemyDash } = buildSystem(295);
    let blocked = true;
    system.setBlockedChecker(() => blocked);
    system.hostUpdate(1000);
    expect(startEnemyDash).not.toHaveBeenCalled();
    blocked = false;
    system.hostUpdate(1001);
    expect(startEnemyDash).toHaveBeenCalledOnce();
  });
  it('findet ein bedrohliches Projektil auch ueber eine Bucket-Grenze hinweg', () => {
    const { system, startEnemyDash } = buildSystem(295);

    system.hostUpdate(1_000);

    expect(startEnemyDash).toHaveBeenCalledTimes(1);
  });

  it('verwirft Projektile ausserhalb des Ausweichsuchradius bereits in der Broadphase', () => {
    const { system, startEnemyDash } = buildSystem(700);

    system.hostUpdate(1_000);

    expect(startEnemyDash).not.toHaveBeenCalled();
  });
});


describe('generic dodge requests', () => {
  it('normalizes legacy factors and rejects reversed or non-finite modes', () => {
    const config = configs.getCoopDefenseEnemyConfig('pyro-badger').dodge!;
    expect(configs.normalizeDodgeConfig({ ...config, distanceFactors: undefined })?.distanceFactors).toEqual({ short: 1, long: 1 });
    for (const factors of [{ short: 2, long: 1 }, { short: 0, long: 1 }, { short: NaN, long: 1 }, { short: 1, long: Infinity }]) {
      expect(() => configs.normalizeDodgeConfig({ ...config, distanceFactors: factors })).toThrow(/dodge/);
    }
  });

  it('scales both landing probes and execution, sharing one cooldown across modes and triggers', () => {
    const f = buildSystem(700, 'firestarter-badger');
    const config = configs.getCoopDefenseEnemyConfig(f.enemy.kind).dodge!;
    const short = f.system.getDodgeDistance(f.enemy.id, 'short'), long = f.system.getDodgeDistance(f.enemy.id, 'long');
    expect(short / long).toBeCloseTo(config.distanceFactors!.short / config.distanceFactors!.long);
    expect(f.system.requestDodge(f.enemy.id, { x: 0, y: 4 }, 'short', 1000)).toBe(true);
    expect(f.isFree).toHaveBeenLastCalledWith(f.enemy.sprite.x, f.enemy.sprite.y + short, f.enemy.getCollisionRadius() * 1.25);
    expect(f.system.requestDodge(f.enemy.id, { x: 1, y: 0 }, 'long', 1000)).toBe(false);
    f.system.hostUpdate(1000);
    expect(f.startEnemyDash).toHaveBeenLastCalledWith(f.enemy.id, 0, 1, config.distanceFactors!.short);
    const ready = 1000 + (DASH_T1_S + DASH_T2_S) * 1000 + config.cooldownMs;
    expect(f.system.requestDodge(f.enemy.id, { x: 0, y: -1 }, 'long', ready - 1)).toBe(false);
    f.projectile.x = 295; f.system.hostUpdate(ready - 1);
    expect(f.startEnemyDash).toHaveBeenCalledOnce();
    f.projectile.x = 700;
    expect(f.system.requestDodge(f.enemy.id, { x: 0, y: -1 }, 'long', ready)).toBe(true);
    f.system.hostUpdate(ready);
    expect(f.startEnemyDash).toHaveBeenLastCalledWith(f.enemy.id, 0, -1, config.distanceFactors!.long);
  });

  it('rejects active dash, commit, blocked paths and invalid directions; revalidates queued requests', () => {
    const f = buildSystem(700);
    const request = () => f.system.requestDodge(f.enemy.id, { x: 0, y: 1 }, 'short', 1000);
    f.setDashing(true); expect(request()).toBe(false); f.setDashing(false);
    let blocked = true; f.system.setBlockedChecker(() => blocked);
    expect(request()).toBe(false); blocked = false;
    f.path.mockReturnValue(false); expect(request()).toBe(false); f.path.mockReturnValue(true);
    f.isFree.mockReturnValue(false); expect(request()).toBe(false); f.isFree.mockReturnValue(true);
    expect(f.system.requestDodge(f.enemy.id, { x: NaN, y: 0 }, 'short', 1000)).toBe(false);
    expect(request()).toBe(true); blocked = true; f.system.hostUpdate(1000);
    expect(f.startEnemyDash).not.toHaveBeenCalled(); expect(f.system.isDodging(f.enemy.id)).toBe(false);
    blocked = false; expect(request()).toBe(true); f.path.mockReturnValue(false); f.system.hostUpdate(1000);
    expect(f.startEnemyDash).not.toHaveBeenCalled();
  });

  it('gives an incoming threat priority over the queued offensive direction', () => {
    const f = buildSystem(295, 'firestarter-badger');
    expect(f.system.requestDodge(f.enemy.id, { x: 1, y: 0 }, 'long', 1000)).toBe(true);
    f.system.hostUpdate(1000);
    const [, dx, dy] = f.startEnemyDash.mock.calls[0] as unknown as [string, number, number];
    expect(Math.abs(dx)).toBe(0); expect(Math.abs(dy)).toBe(1);
  });

  it('chooses a short defensive correction when sufficient and a long one for wider danger', () => {
    const f = buildSystem(295, 'firestarter-badger');
    const authored = configs.getCoopDefenseEnemyConfig(f.enemy.kind);
    const dodge = { ...authored.dodge!, distanceFactors: { short: 0.6, long: 1.2 } };
    vi.spyOn(configs, 'getCoopDefenseEnemyConfig').mockReturnValue({ ...authored, dodge });
    vi.spyOn(f.enemy, 'getMoveSpeed').mockReturnValue(200);
    f.system.hostUpdate(1000);
    expect(f.startEnemyDash).toHaveBeenLastCalledWith(f.enemy.id, -0, -1, dodge.distanceFactors.short);
    f.system.clear();
    f.projectile.radius = f.system.getDodgeDistance(f.enemy.id, 'short');
    f.system.hostUpdate(1001);
    expect(f.startEnemyDash).toHaveBeenLastCalledWith(f.enemy.id, -0, -1, dodge.distanceFactors.long);
  });

  it.each(['pyro-badger', 'void-hunter'])('%s keeps approaching players in its configured band', kind => {
    const f = buildSystem(700, kind), config = configs.getCoopDefenseEnemyConfig(kind).dodge!;
    f.players.push({ id: 'p1', active: true, x: f.enemy.sprite.x + config.approachMaxDistancePx, y: f.enemy.sprite.y });
    f.system.hostUpdate(1000);
    expect(f.startEnemyDash).toHaveBeenCalledExactlyOnceWith(f.enemy.id, 1, 0, 1);
  });

  it.each(['pyro-badger', 'void-hunter'])('%s retains the legacy distance, danger response and HP gate', kind => {
    const f = buildSystem(295, kind), config = configs.getCoopDefenseEnemyConfig(kind).dodge!;
    f.system.hostUpdate(1000);
    expect(f.startEnemyDash).toHaveBeenCalledExactlyOnceWith(f.enemy.id, -0, -1, 1);
    f.system.clear(); f.startEnemyDash.mockClear();
    if (config.enabledBelowHpRatio !== undefined) {
      vi.spyOn(f.enemy, 'getHp').mockReturnValue(f.enemy.getMaxHp());
      f.system.hostUpdate(1001); expect(f.startEnemyDash).not.toHaveBeenCalled();
    }
  });
});
