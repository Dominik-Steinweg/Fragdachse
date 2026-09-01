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
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { StinkCloudSystem } from '../src/effects/StinkCloudSystem';
import type { FireSystem } from '../src/effects/FireSystem';
import type { CombatSystem } from '../src/systems/CombatSystem';
import { CoopDefenseEnemyAbilitySystem } from '../src/systems/CoopDefenseEnemyAbilitySystem';
import type { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import type { FlamethrowerUpgradeSystem } from '../src/systems/FlamethrowerUpgradeSystem';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';

function createSystem(
  hasClearLineOfFire: (...args: unknown[]) => boolean,
  kind = 'void-stalker',
) {
  const enemy = fakeEntity({ id: 'void-stalker-1',
    kind,
    faction: 'hostile', active: true, x: 400, y: 300, getHp: () => 160,
    getCollisionRadius: () => 16,
    isBurrowed: () => false }) as unknown as EnemyEntity;
  const player = fakeEntity({ id: 'player-1', active: true, x: 800, y: 300 });
  const spawnProjectile = vi.fn().mockReturnValue(7);
  const enemyManager = {
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
  } as unknown as CombatSystem;
  const projectileManager = {
    spawnProjectile,
  } as unknown as ProjectileManager;

  return {
    system: new CoopDefenseEnemyAbilitySystem(
      enemyManager,
      playerManager,
      projectileManager,
      combatSystem,
      null as EnergyShieldSystem | null,
      {} as StinkCloudSystem,
      null as FlamethrowerUpgradeSystem | null,
      {} as FireSystem,
      { broadcastTranslocatorFlash: vi.fn() },
    ),
    hasClearLineOfFire,
    spawnProjectile,
  };
}

describe('Void-Stalker Translocator', () => {
  it('passes puck radius and safety margin to the path check', () => {
    const hasClearLineOfFire = vi.fn((...args: unknown[]) => (args[4] as { clearanceRadius?: number }).clearanceRadius === 12);
    const { system, spawnProjectile } = createSystem(hasClearLineOfFire);

    system.hostUpdate(0);

    expect(hasClearLineOfFire).toHaveBeenCalledWith(400, 300, 800, 300, { clearanceRadius: 12 });
    expect(spawnProjectile).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the padded path is blocked by an obstacle', () => {
    const hasClearLineOfFire = vi.fn(() => false);
    const { system, spawnProjectile } = createSystem(hasClearLineOfFire);

    system.hostUpdate(0);

    expect(spawnProjectile).not.toHaveBeenCalled();
  });
});

describe('Thrower-Badger brood bomb', () => {
  it('passes the same padded path check before throwing', () => {
    const hasClearLineOfFire = vi.fn((...args: unknown[]) => (args[4] as { clearanceRadius?: number }).clearanceRadius === 12);
    const { system, spawnProjectile } = createSystem(hasClearLineOfFire, 'thrower-badger');

    system.hostUpdate(0);
    system.hostUpdate(getCoopDefenseEnemyConfig('thrower-badger').spawnThrow!.cooldownMs);

    expect(hasClearLineOfFire).toHaveBeenCalledWith(400, 300, 800, 300, { clearanceRadius: 12 });
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
