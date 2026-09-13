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

import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileSpawnPort } from '../src/projectile/ProjectileSpawnPort';
import type { TranslocatorProjectilePort } from '../src/projectile/ProjectileExternalInteractionPort';
import type { StinkCloudSystem } from '../src/effects/StinkCloudSystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import { CoopDefenseEnemyAbilitySystem } from '../src/systems/CoopDefenseEnemyAbilitySystem';
import type { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { EnemyAiTargetCatalog } from '../src/systems/EnemyAiTargetCatalog';

function createSystem(
  hasClearLineOfFire: (...args: unknown[]) => boolean,
  kind = 'void-stalker',
  catalog: EnemyAiTargetCatalog | null = null,
) {
  const enemy = fakeEntity({ id: 'void-stalker-1',
    kind,
    faction: 'hostile', active: true, x: 400, y: 300, getHp: () => 160,
    getCollisionRadius: () => 16,
    setPosition: vi.fn(),
    isBurrowed: () => false }) as unknown as EnemyEntity;
  const player = fakeEntity({ id: 'player-1', active: true, x: 800, y: 300 });
  const spawnPuck = vi.fn().mockReturnValue(7);
  const spawnProjectile = vi.fn().mockReturnValue(8);
  const enemyManager = {
    canSeeThroughSmoke: () => true,
    getAllEnemies: () => [enemy],
  } as unknown as EnemyManager;
  const playerManager = {
    getAllPlayers: () => [player],
  } as unknown as PlayerManager;
  const combatSystem = {
    isAlive: () => true,
    isBurrowed: () => false,
    canDamageTarget: () => true,
    hasClearLineOfFire,
    applyDamage: vi.fn(),
    applyStructureDamage: vi.fn(),
  } as unknown as CombatSystem;
  const projectileSpawn = {
    spawnProjectile,
  } as unknown as ProjectileSpawnPort;
  const translocatorProjectilePort: TranslocatorProjectilePort = {
    spawnPuck,
    getPuckPosition: () => null,
    consumePuck: () => false,
  };

  return {
    system: new CoopDefenseEnemyAbilitySystem(
      enemyManager,
      playerManager,
      projectileSpawn,
      combatSystem,
      null as EnergyShieldSystem | null,
      {} as StinkCloudSystem,
      null as FlamethrowerUpgradeSystem | null,
      {} as FireSystem,
      { broadcastTranslocatorFlash: vi.fn() },
      catalog,
      undefined,
      translocatorProjectilePort,
    ),
    hasClearLineOfFire,
    spawnPuck,
    spawnProjectile,
    translocatorProjectilePort,
    combatSystem,
  };
}

describe('Void-Stalker Translocator', () => {
  it.each(['armed-construct', 'armed-outpost', 'armed-base'] as const)('telefrags the actual %s once for its occupants and respects cover', kind => {
    const catalog = new EnemyAiTargetCatalog();
    catalog.updateTargets([{ kind, id: 'structure', x: 800, y: 300, representedPlayerIds: ['player-1', 'player-2'],
      skipRockIndex: kind === 'armed-construct' ? 7 : undefined, resolvePosition: () => ({ x: 795, y: 300 }) }]);
    let clear = true;
    const f = createSystem(() => clear, 'void-stalker', catalog);
    f.combatSystem.canDamageTarget = () => false;
    f.translocatorProjectilePort.getPuckPosition = () => ({ x: 790, y: 300 });
    f.translocatorProjectilePort.consumePuck = () => true;
    const ability = getCoopDefenseEnemyConfig('void-stalker').translocator!;
    f.system.hostUpdate(0);
    expect(f.spawnPuck).toHaveBeenCalledOnce();
    f.system.hostUpdate(ability.flightTimeMs);
    expect(f.combatSystem.applyStructureDamage).toHaveBeenCalledExactlyOnceWith(
      { kind: kind === 'armed-construct' ? 'construction' : 'base', id: 'structure' }, 9999, 'void-stalker-1');
    expect(f.combatSystem.applyDamage).not.toHaveBeenCalled();
    f.system.hostUpdate(ability.flightTimeMs + ability.cooldownMs);
    clear = false;
    f.system.hostUpdate(2 * ability.flightTimeMs + ability.cooldownMs);
    expect(f.combatSystem.applyStructureDamage).toHaveBeenCalledTimes(1);
  });

  it('passes puck radius and safety margin to the path check', () => {
    const hasClearLineOfFire = vi.fn((...args: unknown[]) => (args[4] as { clearanceRadius?: number }).clearanceRadius === 12);
    const { system, spawnPuck } = createSystem(hasClearLineOfFire);

    system.hostUpdate(0);

    expect(hasClearLineOfFire).toHaveBeenCalledWith(400, 300, 800, 300, { clearanceRadius: 12, purpose: 'physical' });
    expect(spawnPuck).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the padded path is blocked by an obstacle', () => {
    const hasClearLineOfFire = vi.fn(() => false);
    const { system, spawnPuck } = createSystem(hasClearLineOfFire);

    system.hostUpdate(0);

    expect(spawnPuck).not.toHaveBeenCalled();
  });
});

describe('Thrower-Badger brood bomb', () => {
  it('passes the same padded path check before throwing', () => {
    const hasClearLineOfFire = vi.fn((...args: unknown[]) => (args[4] as { clearanceRadius?: number }).clearanceRadius === 12);
    const { system, spawnProjectile } = createSystem(hasClearLineOfFire, 'thrower-badger');

    system.hostUpdate(0);
    system.hostUpdate(getCoopDefenseEnemyConfig('thrower-badger').spawnThrow!.cooldownMs);

    expect(hasClearLineOfFire).toHaveBeenCalledWith(400, 300, 800, 300, { clearanceRadius: 12, purpose: 'physical' });
    expect(spawnProjectile).toHaveBeenCalledTimes(1);
  });

  it('does not throw a brood bomb into a blocked padded path', () => {
    const hasClearLineOfFire = vi.fn(() => false);
    const { system, spawnProjectile } = createSystem(hasClearLineOfFire, 'thrower-badger');

    system.hostUpdate(0);
    system.hostUpdate(getCoopDefenseEnemyConfig('thrower-badger').spawnThrow!.cooldownMs);

    expect(spawnProjectile).not.toHaveBeenCalled();
  });
});
