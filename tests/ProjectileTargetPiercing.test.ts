import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Ersatz mit echtem Rechteck-Schnitttest.
 *
 * Der Durchschlag hängt daran, dass dasselbe Projektil in einem Frame mehrere überlappende
 * Ziele erreicht. Eine Attrappe, die pauschal „trifft" meldet, würde die Debounce-Logik
 * nicht prüfen, sondern nur ihre Existenz.
 */
vi.mock('phaser', () => {
  class Rectangle {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }

  // Der Konstruktor legt Scratch-Geometrie für andere Trefferpfade an; sie bleibt hier ungenutzt.
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
  }
  class Circle {
    x = 0; y = 0; radius = 0;
  }

  return {
    Geom: {
      Rectangle,
      Line,
      Circle,
      Intersects: {
        RectangleToRectangle: (a: Rectangle, b: Rectangle) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import * as Phaser from 'phaser';
import { CombatSystem } from '../src/systems/CombatSystem';
import type { EnemyManager } from '../src/entities/EnemyManager';
import type { NetworkBridge } from '../src/network/NetworkBridge';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
import type { TrackedProjectile } from '../src/types';

function makeEnemy(id: string, x: number) {
  return fakeEntity({ id, active: true,
      x,
      y: 0,
      getBounds: () => new Phaser.Geom.Rectangle(x - 8, -8, 16, 16) });
}

function makeProjectile(piercesTargets: boolean): TrackedProjectile {
  return fakeEntity({ id: 1,
    ownerId: 'player-1',
    sourceId: 'TESLA_DOME',
    sourceSlot: 'weapon2',
    damage: 6,
    isGrenade: false,
    projectileStyle: 'tesla_bolt',
    piercesTargets,
    piercingHitIds: piercesTargets ? new Set<string>() : undefined,
    lastX: 0,
    lastY: 0, x: 0,
      y: 0,
      // Ein bewusst breites Projektil, damit beide Gegner in einem Frame überlappen.
      getBounds: () => new Phaser.Geom.Rectangle(-20, -6, 40, 12), body: { velocity: { x: 100, y: 0 } } }) as unknown as TrackedProjectile;
}

function makeSystem(
  proj: TrackedProjectile,
  enemies: ReturnType<typeof makeEnemy>[],
  active: Set<TrackedProjectile> | readonly TrackedProjectile[] = [proj],
  disableSpecialCases = true,
) {
  const destroyProjectile = vi.fn();
  const spawnProjectile = vi.fn();
  const projectileManager = {
    getActiveProjectiles: () => active,
    getProjectileById: (id: number) => [...active].find((projectile) => projectile.id === id),
    destroyProjectile: (id: number) => {
      destroyProjectile(id);
      if (active instanceof Set) {
        const target = [...active].find((projectile) => projectile.id === id);
        if (target) active.delete(target);
      }
    },
    spawnProjectile,
    queueStandaloneExplosion: vi.fn(),
  } as unknown as ProjectileManager;
  const playerManager = { getAllPlayers: () => [] } as unknown as PlayerManager;
  const bridge = { isHost: () => true } as unknown as NetworkBridge;

  const system = new CombatSystem(playerManager, projectileManager, bridge);
  system.setEnemyManager({
    getAllEnemies: () => enemies,
    getEnemy: (id: string) => enemies.find(enemy => enemy.id === id),
    hasEnemy: (id: string) => enemies.some(enemy => enemy.id === id),
  } as unknown as EnemyManager);

  const applyDamage = vi.fn();
  // Der Schadenspfad selbst ist hier nicht der Prüfgegenstand, nur wer wie oft getroffen wird.
  (system as unknown as { applyDamage: unknown }).applyDamage = applyDamage;
  (system as unknown as { canDamageTarget: unknown }).canDamageTarget = () => true;
  (system as unknown as { computeProjectileDamage: unknown }).computeProjectileDamage = () => proj.damage;
  (system as unknown as { registerAk47Hit: unknown }).registerAk47Hit = () => {};
  if (disableSpecialCases) {
    (system as unknown as { applyDomeProjectileBarrier: unknown }).applyDomeProjectileBarrier = () => {};
    (system as unknown as { applyLeafBlowerProjectileDeflection: unknown }).applyLeafBlowerProjectileDeflection = () => {};
  }

  return { system, applyDamage, destroyProjectile, spawnProjectile };
}

describe('generic projectile target piercing', () => {
  it('damages every overlapping enemy once and keeps the projectile alive', () => {
    const proj = makeProjectile(true);
    const { system, applyDamage, destroyProjectile } = makeSystem(proj, [
      makeEnemy('enemy-a', -10),
      makeEnemy('enemy-b', 10),
    ]);

    system.update();

    expect(applyDamage).toHaveBeenCalledTimes(2);
    expect(applyDamage.mock.calls.map(call => call[0])).toEqual(['enemy-a', 'enemy-b']);
    expect(destroyProjectile).not.toHaveBeenCalled();
  });

  it('never hits the same enemy twice across frames', () => {
    const proj = makeProjectile(true);
    const { system, applyDamage, destroyProjectile } = makeSystem(proj, [makeEnemy('enemy-a', 0)]);

    system.update();
    system.update();

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(destroyProjectile).not.toHaveBeenCalled();
  });

  it('consumes an ordinary projectile on its first target', () => {
    const proj = makeProjectile(false);
    const { system, destroyProjectile } = makeSystem(proj, [
      makeEnemy('enemy-a', -10),
      makeEnemy('enemy-b', 10),
    ]);

    system.update();

    expect(destroyProjectile).toHaveBeenCalledWith(proj.id);
  });

  it('reflects a projectile through the normal spawn path and preserves its payload', () => {
    const proj = makeProjectile(false);
    Object.assign(proj, {
      x: 10,
      y: 0,
      createdAt: 0,
      lifetime: 1_000,
      explosion: { radius: 20, maxDamage: 10, minDamage: 5, knockback: 0, selfDamageMult: 0, damageTarget: 'enemies' },
    });
    const { system, destroyProjectile, spawnProjectile } = makeSystem(proj, [], [proj], false);
    system.setEnergyShieldSystem({
      getReflectDomes: () => [{ ownerId: 'shield-owner', x: 0, y: 0, radius: 20, color: 0x123456, reflect: true }],
      onDomeAbsorb: vi.fn(),
    } as never);

    system.update();

    expect(spawnProjectile).toHaveBeenCalledWith(
      10,
      0,
      0,
      'shield-owner',
      expect.objectContaining({
        ownerColor: 0x123456,
        sourceId: 'environment.reflector_dome',
        reflected: true,
        explosion: proj.explosion,
      }),
    );
    expect(destroyProjectile).toHaveBeenCalledWith(proj.id);
  });

  it('captures a spawn-enemy grenade with its remaining fuse and new owner', () => {
    const proj = makeProjectile(false);
    Object.assign(proj, {
      x: 10,
      y: 0,
      createdAt: 0,
      lifetime: 1_000,
      fuseTime: 1_000,
      isGrenade: true,
      grenadeEffect: { type: 'spawn_enemy' },
    });
    const { system, destroyProjectile, spawnProjectile } = makeSystem(proj, [], [proj], false);
    system.setEnergyShieldSystem({
      getReflectDomes: () => [{ ownerId: 'shield-owner', x: 0, y: 0, radius: 20, color: 0x123456, reflect: true }],
      onDomeAbsorb: vi.fn(),
    } as never);

    system.update();

    expect(spawnProjectile).toHaveBeenCalledWith(
      10,
      0,
      0,
      'shield-owner',
      expect.objectContaining({
        isGrenade: true,
        fuseTime: expect.any(Number),
        sourceId: 'environment.reflector_dome',
        reflected: true,
      }),
    );
    expect(destroyProjectile).toHaveBeenCalledWith(proj.id);
  });

  it('deflects a projectile through the leaf-blower spawn path with inherited effects', () => {
    const target = makeProjectile(false);
    target.explosion = {
      radius: 20,
      maxDamage: 10,
      minDamage: 5,
      knockback: 0,
      selfDamageMult: 0,
      damageTarget: 'enemies',
    } as never;
    const blower = fakeEntity({
      id: 2,
      ownerId: 'blower-owner',
      ownerColor: 0xabcdef,
      projectileStyle: 'leaf_blower',
      leafBlowerDeflectsProjectiles: true,
      displayWidth: 20,
      getBounds: () => new Phaser.Geom.Rectangle(-20, -10, 40, 20),
      body: { velocity: { x: 0, y: 100 } },
    }) as unknown as TrackedProjectile;
    const { system, destroyProjectile, spawnProjectile } = makeSystem(target, [], [target, blower], false);

    system.update();

    expect(spawnProjectile).toHaveBeenCalledWith(
      target.sprite.x,
      target.sprite.y,
      Math.PI / 2,
      'blower-owner',
      expect.objectContaining({
        sourceId: 'weapon.leaf_blower_deflect',
        reflected: true,
        explosion: target.explosion,
      }),
    );
    expect(destroyProjectile).toHaveBeenCalledWith(target.id);
  });

  it('characterizes current same-stage traversal when a hit spawns plasma children', () => {
    const parent = makeProjectile(false);
    parent.plasmaSwarmEnabled = true;
    parent.plasmaSwarmProjectileCount = 1;
    parent.initialSpeed = 100;
    const active = new Set<TrackedProjectile>([parent]);
    const enemy = makeEnemy('enemy-a', 0);
    enemy.updatePlasmaChargeStacks = vi.fn();
    const secondEnemy = makeEnemy('enemy-b', 25);
    const { system, applyDamage, spawnProjectile } = makeSystem(parent, [enemy, secondEnemy], active);
    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
      spawnProjectile.mockImplementation((x: number, y: number, _angle: number, ownerId: string, config: Record<string, unknown>) => {
        const child = makeProjectile(false);
        Object.assign(child, {
          id: active.size + 1,
          ownerId,
          x,
          y,
          ...config,
        });
        active.add(child);
        return child.id;
      });

      system.update();

      expect(spawnProjectile).toHaveBeenCalled();
      expect(applyDamage).toHaveBeenCalledTimes(spawnProjectile.mock.calls.length + 1);
      expect(active.size).toBe(0);
    } finally {
      Math.random = originalRandom;
    }
  });
});
