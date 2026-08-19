import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
  },
}));

import * as Phaser from 'phaser';
import { HostPhysicsSystem } from '../src/systems/HostPhysicsSystem';
import type { EnemyEntity } from '../src/entities/EnemyEntity';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { CombatSystem } from '../src/systems/CombatSystem';
import type { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import type { PlayerEntity } from '../src/entities/PlayerEntity';

function createMockEnemy(id: string, x = 100, y = 100, vx = 50, vy = 60) {
  const setVelocity = vi.fn();
  const setWalking = vi.fn();
  const syncBar = vi.fn();
  const getDesiredVelocity = vi.fn(() => ({ vx, vy }));
  const getKnockbackFactor = vi.fn(() => 1);
  const sprite = {
    active: true,
    x,
    y,
    body: {
      velocity: { x: vx, y: vy },
      setVelocity,
    },
  };

  return {
    id,
    sprite,
    setVelocity,
    setWalking,
    syncBar,
    getDesiredVelocity,
    getKnockbackFactor,
    setDashPhase: vi.fn(),
    setDashScale: vi.fn(),
    isBurrowed: () => false,
  } as unknown as EnemyEntity & {
    setVelocity: typeof setVelocity;
    setWalking: typeof setWalking;
    syncBar: typeof syncBar;
  };
}

function createMockPlayer(id: string, x = 200, y = 200) {
  const setVelocity = vi.fn();
  const sprite = {
    active: true,
    x,
    y,
    body: {
      velocity: { x: 0, y: 0 },
      setVelocity,
    },
  };

  return {
    id,
    sprite,
    setDashScale: vi.fn(),
    setCollisionRadius: vi.fn(),
    setVelocity,
  } as unknown as PlayerEntity & { setVelocity: typeof setVelocity };
}

function createHarness() {
  const players = new Map<string, PlayerEntity>();
  const enemies = new Map<string, EnemyEntity>();

  const getAllPlayers = vi.fn(() => Array.from(players.values()));
  const getPlayer = vi.fn((id: string) => players.get(id));

  const getAllEnemies = vi.fn(() => Array.from(enemies.values()));
  const forEachEnemy = vi.fn((callback: (enemy: EnemyEntity) => void) => {
    for (const enemy of enemies.values()) {
      callback(enemy);
    }
  });
  const hasEnemy = vi.fn((id: string) => enemies.has(id));
  const getEnemy = vi.fn((id: string) => enemies.get(id));

  const bridge = {
    isHost: () => true,
    canPlayerAct: () => true,
    getPlayerInput: () => ({ dx: 1, dy: 0 }),
  } as unknown as NetworkBridge;

  const combatSystem = {
    isAlive: () => true,
    applyDamage: vi.fn(),
  } as unknown as CombatSystem;

  const playerManager = {
    getAllPlayers,
    getPlayer,
  } as unknown as PlayerManager;

  const enemyManager = {
    getAllEnemies,
    forEachEnemy,
    hasEnemy,
    getEnemy,
  } as unknown as EnemyManager;

  const colliderDestroySpies: Array<() => void> = [];
  const scene = {
    physics: {
      add: {
        collider: vi.fn(() => {
          const destroy = vi.fn();
          colliderDestroySpies.push(destroy);
          return { active: true, destroy };
        }),
      },
    },
  } as unknown as Phaser.Scene;

  const system = new HostPhysicsSystem(scene, playerManager, bridge, combatSystem);
  system.setEnemyManager(enemyManager);

  return {
    system,
    scene,
    players,
    enemies,
    playerManager,
    enemyManager,
    getAllEnemies,
    forEachEnemy,
    combatSystem,
    colliderDestroySpies,
  };
}

describe('HostPhysicsSystem Allocation Optimization', () => {
  it('uses forEachEnemy instead of getAllEnemies in update() per-frame enemy loop', () => {
    const { system, enemies, getAllEnemies, forEachEnemy } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100, 40, 30);
    const enemy2 = createMockEnemy('enemy-2', 150, 150, -20, 10);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    system.update(false);

    expect(forEachEnemy).toHaveBeenCalledTimes(1);
    expect(getAllEnemies).not.toHaveBeenCalled();
    expect(enemy1.setVelocity).toHaveBeenCalledWith(40, 30);
    expect(enemy2.setVelocity).toHaveBeenCalledWith(-20, 10);
  });

  it('uses forEachEnemy instead of getAllEnemies in applyRadialImpulse()', () => {
    const { system, enemies, getAllEnemies, forEachEnemy } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100);
    enemies.set('enemy-1', enemy1);

    system.applyRadialImpulse(100, 100, 50, 200);

    expect(forEachEnemy).toHaveBeenCalledTimes(1);
    expect(getAllEnemies).not.toHaveBeenCalled();
  });

  it('safely cleans up orphan enemy colliders during keys iteration when enemies disappear', () => {
    const { system, enemies, scene } = createHarness();
    const mockRockGroup = {} as Phaser.Physics.Arcade.StaticGroup;
    system.setRockGroup(mockRockGroup, null);

    const enemy1 = createMockEnemy('enemy-1', 100, 100);
    const enemy2 = createMockEnemy('enemy-2', 150, 150);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    // First update creates lazy colliders for enemy1 and enemy2
    system.update(false);
    expect(scene.physics.add.collider).toHaveBeenCalledTimes(2);

    // enemy1 dies / is removed from enemyManager
    enemies.delete('enemy-1');

    // Second update iterates this.enemyColliders.keys() directly and cleans up enemy1
    expect(() => system.update(false)).not.toThrow();
  });

  it('applies time bubble scaling accurately to both players and enemies without wrapper allocations', () => {
    const { system, players, enemies } = createHarness();
    const player1 = createMockPlayer('player-1', 100, 100);
    players.set('player-1', player1);

    const enemy1 = createMockEnemy('enemy-1', 200, 200, 100, 50);
    enemies.set('enemy-1', enemy1);

    const timeBubbleSystem = {
      getPlayerMovementFactorAt: vi.fn((x: number, y: number, _now: number, playerId?: string) => {
        if (playerId === 'player-1') return 0.5;
        if (x === 200 && y === 200) return 0.25;
        return 1;
      }),
    } as unknown as TimeBubbleSystem;

    system.setTimeBubbleSystem(timeBubbleSystem);
    system.setRunSpeedResolver(() => 100);

    system.update(false);

    // Player velocity with input dx=1, speed=100, factor=0.5 => 50
    expect(player1.setVelocity).toHaveBeenCalledWith(50, 0);

    // Enemy velocity vx=100, vy=50, factor=0.25 => vx=25, vy=12.5
    expect(enemy1.setVelocity).toHaveBeenCalledWith(25, 12.5);
  });

  it('correctly handles recoil impulses and forced movement', () => {
    const { system, players } = createHarness();
    const player1 = createMockPlayer('player-1', 100, 100);
    players.set('player-1', player1);

    system.setRunSpeedResolver(() => 100);

    // Add recoil
    system.addRecoil('player-1', 200, 100, 1000);

    system.update(false);

    // Base movement dx=1 * speed 100 = (100, 0) + impulse (200, 100) = (300, 100)
    expect(player1.setVelocity).toHaveBeenCalledWith(300, 100);

    // Test forced movement
    system.setForcedMovement('player-1', -50, -50);
    player1.setVelocity.mockClear();

    system.update(false);

    // Forced movement (-50, -50) + decaying impulse
    const call = player1.setVelocity.mock.calls[0];
    expect(call[0]).toBeGreaterThan(-50);
    expect(call[1]).toBeGreaterThan(-50);
  });

  it('does not call enemy.syncBar() during update – visual sync is deferred to EnemyManager.syncHostVisuals()', () => {
    const { system, enemies } = createHarness();
    const enemy1 = createMockEnemy('enemy-1', 100, 100, 40, 30);
    const enemy2 = createMockEnemy('enemy-2', 200, 200, -10, 20);
    enemies.set('enemy-1', enemy1);
    enemies.set('enemy-2', enemy2);

    system.update(false);

    // Physics must still set velocity and walking state
    expect(enemy1.setVelocity).toHaveBeenCalled();
    expect(enemy2.setVelocity).toHaveBeenCalled();
    expect(enemy1.setWalking).toHaveBeenCalled();
    expect(enemy2.setWalking).toHaveBeenCalled();

    // syncBar must NOT be called – it's handled centrally by EnemyManager.syncHostVisuals()
    // after combat resolution and status updates have been applied in the same frame.
    expect(enemy1.syncBar).not.toHaveBeenCalled();
    expect(enemy2.syncBar).not.toHaveBeenCalled();
  });
});

