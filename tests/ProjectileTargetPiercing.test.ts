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

function makeSystem(proj: TrackedProjectile, enemies: ReturnType<typeof makeEnemy>[]) {
  const destroyProjectile = vi.fn();
  const projectileManager = {
    getActiveProjectiles: () => [proj],
    getProjectileById: (id: number) => (id === proj.id ? proj : undefined),
    destroyProjectile,
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
  (system as unknown as { applyDomeProjectileBarrier: unknown }).applyDomeProjectileBarrier = () => {};
  (system as unknown as { applyLeafBlowerProjectileDeflection: unknown }).applyLeafBlowerProjectileDeflection = () => {};

  return { system, applyDamage, destroyProjectile };
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
});
