import { describe, expect, it } from 'vitest';
import { CoopDefenseEnemyBurrowSystem } from '../src/systems/CoopDefenseEnemyBurrowSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';

interface FakeEnemy {
  id: string;
  kind: string;
  faction: 'hostile' | 'allied';
  sprite: { x: number; y: number; active: boolean };
  burrowed: boolean;
  setBurrowed(value: boolean): boolean;
  getCollisionRadius(): number;
}

function createEnemy(kind: string, x = 0): FakeEnemy {
  return {
    id: 'e1',
    kind,
    faction: 'hostile',
    sprite: { x, y: 100, active: true },
    burrowed: false,
    setBurrowed(value: boolean) {
      const changed = this.burrowed !== value;
      this.burrowed = value;
      return changed;
    },
    getCollisionRadius: () => 15,
  };
}

function createSystem(enemy: FakeEnemy, isFreeGround: () => boolean) {
  const collisionCalls: Array<{ enemyId: string; enabled: boolean }> = [];
  const enemyManager = {
    getEnemy: (id: string) => (id === enemy.id ? enemy as unknown as EnemyEntity : undefined),
    // Der EnemyManager ist der einzige Weg zum Einbuddel-Zustand, weil dort die Buddel-Visuals hängen.
    setEnemyBurrowed: (id: string, burrowed: boolean) => {
      if (id === enemy.id) enemy.setBurrowed(burrowed);
    },
  } as unknown as EnemyManager;

  const system = new CoopDefenseEnemyBurrowSystem(
    enemyManager,
    (enemyId, enabled) => collisionCalls.push({ enemyId, enabled }),
    () => isFreeGround(),
  );
  return { system, collisionCalls };
}

describe('CoopDefenseEnemyBurrowSystem', () => {
  it('starts the alien badger burrowed and disables its collisions', () => {
    const enemy = createEnemy('alien-badger');
    const { system, collisionCalls } = createSystem(enemy, () => true);

    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    expect(system.isBurrowed(enemy.id)).toBe(true);
    expect(enemy.burrowed).toBe(true);
    expect(collisionCalls).toEqual([{ enemyId: 'e1', enabled: false }]);
    expect(system.getForcedDirection(enemy.id)).toEqual({ x: 1, y: 0 });
  });

  it('leaves enemies without a burrow config alone', () => {
    const enemy = createEnemy('rabid-badger');
    const { system } = createSystem(enemy, () => true);

    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    expect(system.isBurrowed(enemy.id)).toBe(false);
    expect(system.getForcedDirection(enemy.id)).toBeNull();
  });

  it('keeps tunnelling until the minimum distance AND free ground are reached', () => {
    const enemy = createEnemy('alien-badger', 0);
    const { system, collisionCalls } = createSystem(enemy, () => true);
    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    // Freier Boden, aber die Mindest-Grabstrecke von 96px ist noch nicht erreicht.
    enemy.sprite.x = 50;
    system.hostUpdate(100);
    expect(system.isBurrowed(enemy.id)).toBe(true);

    enemy.sprite.x = 200;
    system.hostUpdate(200);
    expect(system.isBurrowed(enemy.id)).toBe(false);
    expect(enemy.burrowed).toBe(false);
    expect(collisionCalls.at(-1)).toEqual({ enemyId: 'e1', enabled: true });
  });

  it('surfaces after the tunnel timeout even when the ground stays blocked', () => {
    const enemy = createEnemy('alien-badger', 0);
    const { system } = createSystem(enemy, () => false);
    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    enemy.sprite.x = 900;
    system.hostUpdate(4999);
    expect(system.isBurrowed(enemy.id)).toBe(true);

    system.hostUpdate(5000);
    expect(system.isBurrowed(enemy.id)).toBe(false);
  });

  it('dives under the tracks for at most the configured 2 seconds and keeps normal pathing', () => {
    const enemy = createEnemy('alien-badger', 400);
    const { system } = createSystem(enemy, () => true);

    expect(system.requestTrainCrossingBurrow(enemy.id, 1000)).toBe(true);
    expect(system.isBurrowed(enemy.id)).toBe(true);
    // Beim Gleis-Queren graebt der Gegner nicht stur geradeaus, sondern folgt der Wegfindung.
    expect(system.getForcedDirection(enemy.id)).toBeNull();

    system.hostUpdate(2999);
    expect(system.isBurrowed(enemy.id)).toBe(true);

    system.hostUpdate(3000);
    expect(system.isBurrowed(enemy.id)).toBe(false);
  });

  it('refuses a track dive for enemies that cannot burrow', () => {
    const enemy = createEnemy('thrower-badger', 400);
    const { system } = createSystem(enemy, () => true);

    expect(system.requestTrainCrossingBurrow(enemy.id, 1000)).toBe(false);
    expect(system.isBurrowed(enemy.id)).toBe(false);
  });

  it('surfaces everything on clear so a torn-down round leaves no ghost state', () => {
    const enemy = createEnemy('alien-badger');
    const { system, collisionCalls } = createSystem(enemy, () => false);
    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    system.clear();

    expect(system.isBurrowed(enemy.id)).toBe(false);
    expect(enemy.burrowed).toBe(false);
    expect(collisionCalls.at(-1)).toEqual({ enemyId: 'e1', enabled: true });
  });
});
