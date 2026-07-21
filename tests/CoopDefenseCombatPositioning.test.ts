import { describe, expect, it, vi } from 'vitest';

// Phaser braucht ein DOM; für Abstands- und Winkelrechnung reichen diese Helfer.
vi.mock('phaser', () => ({
  Math: {
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
  },
}));

import { CoopDefenseEnemyCombatPositioningSystem } from '../src/systems/CoopDefenseEnemyCombatPositioningSystem';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { CombatSystem } from '../src/systems/CombatSystem';

const MOVE_SPEED = 175;

function createSystem(playerX: number, isFreeGround: () => boolean = () => true) {
  const enemy = {
    id: 'e1',
    kind: 'pyro-badger',
    faction: 'hostile',
    sprite: { x: 0, y: 0, active: true },
    isBurrowed: () => false,
    getMoveSpeed: () => MOVE_SPEED,
    getCollisionRadius: () => 15,
  } as unknown as EnemyEntity;

  const system = new CoopDefenseEnemyCombatPositioningSystem(
    {
      getAllEnemies: () => [enemy],
      isEnemyPanicking: () => false,
    } as unknown as EnemyManager,
    {
      getAllPlayers: () => [{ id: 'p1', sprite: { x: playerX, y: 0, active: true } }],
    } as unknown as PlayerManager,
    {
      isAlive: () => true,
      isBurrowed: () => false,
      canDamageTarget: () => true,
      hasLineOfSight: () => true,
    } as unknown as CombatSystem,
    () => isFreeGround(),
  );

  system.hostUpdate();
  return system.getMovementOverride('e1');
}

describe('Enemy combat positioning', () => {
  const positioning = getCoopDefenseEnemyConfig('pyro-badger').combatPositioning!;

  it('keeps the pyro badger roughly four cells away from the player', () => {
    // Vier Felder à 32 px – der Wunschabstand soll in dieser Größenordnung liegen.
    expect(positioning.preferredDistancePx).toBeGreaterThanOrEqual(112);
    expect(positioning.preferredDistancePx).toBeLessThanOrEqual(144);
  });

  it('lets the pathfinding close the gap while the player is still far away', () => {
    expect(createSystem(positioning.preferredDistancePx + positioning.toleranceP + 50)).toBeNull();
  });

  it('holds position inside the tolerance band so the enemy can shoot', () => {
    expect(createSystem(positioning.preferredDistancePx)).toEqual({ vx: 0, vy: 0 });
  });

  it('backs away from a player who closes in', () => {
    const override = createSystem(positioning.preferredDistancePx - positioning.toleranceP - 30)!;
    // Spieler steht rechts vom Gegner, der Rueckzug geht also nach links.
    expect(override.vx).toBeLessThan(0);
    expect(Math.hypot(override.vx, override.vy))
      .toBeCloseTo(MOVE_SPEED * positioning.retreatSpeedFactor, 5);
  });

  it('stands its ground instead of backing into a wall', () => {
    const override = createSystem(positioning.preferredDistancePx - positioning.toleranceP - 30, () => false);
    expect(override).toEqual({ vx: 0, vy: 0 });
  });
});
