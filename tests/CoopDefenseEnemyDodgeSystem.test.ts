import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Distance: { Between: () => 0 } },
}));

import { CoopDefenseEnemyDodgeSystem } from '../src/systems/CoopDefenseEnemyDodgeSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import type { TrackedProjectile } from '../src/types';

function buildSystem(projectileX: number) {
  const enemy = {
    id: 'enemy-1',
    kind: 'pyro-badger',
    faction: 'hostile',
    sprite: { active: true, x: 255, y: 100 },
    getHp: () => 10,
    getMaxHp: () => 100,
    getCollisionRadius: () => 16,
    getMoveSpeed: () => 100,
    getSpecialAction: () => 'none',
    isBurrowed: () => false,
  } as unknown as EnemyEntity;
  const projectile = {
    ownerId: 'player-1',
    sprite: { active: true, x: projectileX, y: 100 },
    body: { velocity: { x: -200, y: 0 } },
    isGrenade: false,
    isFlame: false,
    allowTeamDamage: false,
  } as unknown as TrackedProjectile;
  const startEnemyDash = vi.fn(() => true);
  const system = new CoopDefenseEnemyDodgeSystem(
    {
      forEachEnemy: (visit: (candidate: EnemyEntity) => void) => visit(enemy),
      hasEnemy: () => false,
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager,
    { getAllPlayers: () => [] } as unknown as PlayerManager,
    { getActiveProjectiles: () => new Set([projectile]) } as unknown as ProjectileManager,
    {
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
    } as unknown as CombatSystem,
    {
      isEnemyDashing: () => false,
      startEnemyDash,
    } as unknown as HostPhysicsSystem,
    () => true,
  );
  return { system, startEnemyDash };
}

describe('CoopDefenseEnemyDodgeSystem', () => {
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
