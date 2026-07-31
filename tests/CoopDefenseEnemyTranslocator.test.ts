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

function createSystem(hasLineOfSight: (...args: unknown[]) => boolean) {
  const enemy = {
    id: 'void-stalker-1',
    kind: 'void-stalker',
    faction: 'hostile',
    sprite: { active: true, x: 400, y: 300 },
    getHp: () => 160,
    getCollisionRadius: () => 16,
    isBurrowed: () => false,
  } as unknown as EnemyEntity;
  const player = {
    id: 'player-1',
    sprite: { active: true, x: 800, y: 300 },
  };
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
    hasLineOfSight,
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
    ),
    hasLineOfSight,
    spawnProjectile,
  };
}

describe('Void-Stalker Translocator', () => {
  it('passes puck radius and safety margin to the path check', () => {
    const hasLineOfSight = vi.fn((...args: unknown[]) => args[6] === 12);
    const { system, spawnProjectile } = createSystem(hasLineOfSight);

    system.hostUpdate(0);

    expect(hasLineOfSight).toHaveBeenCalledWith(400, 300, 800, 300, undefined, false, 12);
    expect(spawnProjectile).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the padded path is blocked by an obstacle', () => {
    const hasLineOfSight = vi.fn(() => false);
    const { system, spawnProjectile } = createSystem(hasLineOfSight);

    system.hostUpdate(0);

    expect(spawnProjectile).not.toHaveBeenCalled();
  });
});
