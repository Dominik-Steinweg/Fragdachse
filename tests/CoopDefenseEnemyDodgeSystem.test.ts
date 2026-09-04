import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Distance: { Between: () => 0 } },
}));

import { CoopDefenseEnemyDodgeSystem } from '../src/systems/CoopDefenseEnemyDodgeSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import type { ProjectileThreatReadPort } from '../src/projectile/ProjectileReadPorts';

function buildSystem(projectileX: number) {
  const enemy = fakeEntity({ id: 'enemy-1',
    kind: 'pyro-badger',
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
  const system = new CoopDefenseEnemyDodgeSystem(
    {
      forEachEnemy: (visit: (candidate: EnemyEntity) => void) => visit(enemy),
      hasEnemy: () => false,
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager,
    { getAllPlayers: () => [] } as unknown as PlayerManager,
    { getThreatSamples: () => [projectile] } satisfies ProjectileThreatReadPort,
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
