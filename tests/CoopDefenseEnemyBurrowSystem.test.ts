import { describe, expect, it } from 'vitest';
import { CoopDefenseEnemyBurrowSystem } from '../src/systems/CoopDefenseEnemyBurrowSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { SpawnFront } from '../src/types';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';

interface FakeEnemy {
  id: string;
  kind: string;
  faction: 'hostile' | 'allied';
  sprite: { x: number; y: number; active: boolean };
  burrowed: boolean;
  setBurrowed(value: boolean): boolean;
  setPosition(x: number, y: number): void;
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
    setPosition(nextX: number, nextY: number) {
      this.sprite.x = nextX;
      this.sprite.y = nextY;
    },
    getCollisionRadius: () => 15,
  };
}

function createSystem(
  enemy: FakeEnemy,
  isFreeGround: () => boolean,
  findSafeGroundPosition?: (x: number, y: number, radius: number, maxRadiusCells: number) => { x: number; y: number } | null,
) {
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
    findSafeGroundPosition,
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

  it('burrows toward the arena interior from every authored front', () => {
    const cases: Array<{ front: SpawnFront; direction: { x: number; y: number } }> = [
      { front: 'west', direction: { x: 1, y: 0 } },
      { front: 'north', direction: { x: 0, y: 1 } },
      { front: 'east', direction: { x: -1, y: 0 } },
      { front: 'south', direction: { x: 0, y: -1 } },
    ];

    for (const { front, direction } of cases) {
      const enemy = createEnemy('alien-badger', front === 'east' ? 400 : 0);
      const { system } = createSystem(enemy, () => true);
      system.notifyEnemySpawned(enemy as unknown as EnemyEntity, { spawnFront: front }, 0);

      expect(system.getForcedDirection(enemy.id)).toEqual(direction);
      enemy.sprite.x += direction.x * 200;
      enemy.sprite.y += direction.y * 200;
      system.hostUpdate(100);
      expect(system.isBurrowed(enemy.id)).toBe(false);
    }
  });

  it('leaves enemies without a burrow config alone', () => {
    const enemy = createEnemy('rabid-badger');
    const { system } = createSystem(enemy, () => true);

    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    expect(system.isBurrowed(enemy.id)).toBe(false);
    expect(system.getForcedDirection(enemy.id)).toBeNull();
  });

  it('keeps spawn-point enemies stationary while the center is dug out', () => {
    const enemy = createEnemy('rabid-badger');
    const { system } = createSystem(enemy, () => true);

    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, { spawnBurrowed: true }, 0);

    expect(system.isBurrowed(enemy.id)).toBe(true);
    expect(system.getForcedDirection(enemy.id)).toEqual({ x: 0, y: 0 });
    system.hostUpdate(1_199);
    expect(system.isBurrowed(enemy.id)).toBe(true);
    system.hostUpdate(1_200);
    expect(system.isBurrowed(enemy.id)).toBe(false);
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

  it('keeps digging after the tunnel timeout when no safe ground exists', () => {
    const enemy = createEnemy('alien-badger', 0);
    const tunnelTimeoutMs = getCoopDefenseEnemyConfig('alien-badger').burrow!.spawnTunnelTimeoutMs;
    const { system } = createSystem(enemy, () => false);
    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    enemy.sprite.x = 900;
    system.hostUpdate(Math.max(0, tunnelTimeoutMs - 1));
    expect(system.isBurrowed(enemy.id)).toBe(true);

    system.hostUpdate(tunnelTimeoutMs);
    expect(system.isBurrowed(enemy.id)).toBe(true);
  });

  it('moves to a bounded safe position before resurfacing after a timeout', () => {
    const enemy = createEnemy('alien-badger', 0);
    const tunnelTimeoutMs = getCoopDefenseEnemyConfig('alien-badger').burrow!.spawnTunnelTimeoutMs;
    const { system, collisionCalls } = createSystem(
      enemy,
      () => false,
      (_x, _y, _radius, maxRadiusCells) => maxRadiusCells === 4 ? { x: 880, y: 100 } : null,
    );
    system.notifyEnemySpawned(enemy as unknown as EnemyEntity, 0);

    enemy.sprite.x = 900;
    system.hostUpdate(tunnelTimeoutMs);

    expect(enemy.sprite.x).toBe(880);
    expect(enemy.sprite.y).toBe(100);
    expect(system.isBurrowed(enemy.id)).toBe(false);
    expect(collisionCalls.at(-1)).toEqual({ enemyId: 'e1', enabled: true });
  });

  it('dives under the tracks for at most the configured 2 seconds and keeps normal pathing', () => {
    const enemy = createEnemy('alien-badger', 400);
    const maxDurationMs = getCoopDefenseEnemyConfig('alien-badger').burrow!.maxDurationMs;
    const { system } = createSystem(enemy, () => true);

    expect(system.requestTrainCrossingBurrow(enemy.id, 1000)).toBe(true);
    expect(system.isBurrowed(enemy.id)).toBe(true);
    // Beim Gleis-Queren graebt der Gegner nicht stur geradeaus, sondern folgt der Wegfindung.
    expect(system.getForcedDirection(enemy.id)).toBeNull();

    system.hostUpdate(1000 + maxDurationMs - 1);
    expect(system.isBurrowed(enemy.id)).toBe(true);

    system.hostUpdate(1000 + maxDurationMs);
    expect(system.isBurrowed(enemy.id)).toBe(false);
  });

  it('refuses a track dive for enemies that cannot burrow', () => {
    const enemy = createEnemy('thrower-badger', 400);
    const { system } = createSystem(enemy, () => true);

    expect(system.requestTrainCrossingBurrow(enemy.id, 1000)).toBe(false);
    expect(system.isBurrowed(enemy.id)).toBe(false);
  });

  it('keeps a scripted boss phase underground until its exact end timestamp', () => {
    const enemy = createEnemy('void-hunter', 400);
    const { system } = createSystem(enemy, () => true);

    expect(system.startScriptedBurrow(enemy.id, 7000)).toBe(true);
    expect(system.getForcedDirection(enemy.id)).toBeNull();
    system.hostUpdate(6999);
    expect(system.isBurrowed(enemy.id)).toBe(true);
    system.hostUpdate(7000);
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
