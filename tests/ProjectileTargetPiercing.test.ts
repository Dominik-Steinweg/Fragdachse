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
    setTo(x1: number, y1: number, x2: number, y2: number) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
      return this;
    }
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
import type { ProjectileSpawnConfig, TrackedProjectile } from '../src/types';
import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';

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

/** Ein vom Owner erzeugter Reflect-/Deflect-Nachfolger, den der Test nicht selbst vorbereitet. */
function makeSpawnedRecord(id: number, x: number, y: number, ownerId: string): TrackedProjectile {
  return fakeEntity({
    id,
    ownerId,
    x,
    y,
    lastX: x,
    lastY: y,
    damage: 0,
    isGrenade: false,
    projectileStyle: 'tesla_bolt',
    getBounds: () => new Phaser.Geom.Rectangle(x - 1, y - 1, 2, 2),
    body: { velocity: { x: 0, y: 0 } },
  }) as unknown as TrackedProjectile;
}

/**
 * Baut die Ziel-Grenze der Phase-6-Kollision: der world-owned Owner besitzt Iteration, Geometrie
 * und Verbrauch, `CombatSystem` liefert Ziele, Beziehung, Barriere und Direct-Impact.
 */
function makeSystem(
  proj: TrackedProjectile,
  enemies: ReturnType<typeof makeEnemy>[],
  active: readonly TrackedProjectile[] = [proj],
) {
  const released: TrackedProjectile[] = [];
  const spawnedRequests: Array<{
    x: number; y: number; angle: number; ownerId: string; cfg: ProjectileSpawnConfig;
  }> = [];
  const prepared = [...active];
  let nextSpawnedId = 100;

  const runtime = new WorldProjectileRuntime({
    simulation: {
      bindProjectileOwner: () => {},
      createProjectile: (id, x, y, angle, ownerId, cfg, _hostNowMs, provenance) => {
        spawnedRequests.push({ x, y, angle, ownerId, cfg });
        const record = prepared.shift() ?? makeSpawnedRecord(nextSpawnedId++, x, y, ownerId);
        // Der Owner vergibt die Identity; der Test liefert nur den vorbereiteten Record.
        Object.assign(record, { id, provenance });
        return record;
      },
      releaseProjectileResources: (record) => { released.push(record); },
      releaseWorldProjectileState: () => {},
    },
    identityScope: new ProjectileIdentityScope(1),
    hostNowMs: () => 0,
  });

  const destroyProjectile = vi.fn();
  const originalDestroy = runtime.destroyProjectile.bind(runtime);
  runtime.destroyProjectile = (id: number) => {
    destroyProjectile(id);
    originalDestroy(id);
  };

  const spawnProjectile = vi.fn((x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig) => (
    runtime.spawnLegacyProjectile(x, y, angle, ownerId, cfg)
  ));
  const projectileManager = {
    getProjectileById: (id: number) => runtime.store.getById(id),
    destroyProjectile: (id: number) => runtime.destroyProjectile(id),
    spawnProjectile,
    queueStandaloneExplosion: vi.fn(),
  } as unknown as ProjectileManager;
  const playerManager = { getAllPlayers: () => [], getPlayer: () => undefined } as unknown as PlayerManager;
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

  runtime.setProjectileTargetabilityPort({
    canDamage: () => true,
    canDamageOwner: () => true,
    isTargetCurrentlyValid: () => true,
  });
  runtime.setProjectileCollisionTargetQueryPort({
    readCollisionTargets: (sink) => system.readCollisionTargets(sink),
  });
  runtime.setProjectileWorldBlockerPort({ getNearestBlockerDistance: () => null });
  runtime.setProjectileBarrierPort({ resolveBarrier: (request) => system.resolveProjectileBarrier(request) });
  runtime.setProjectileDirectImpactPort({ resolveDirectImpact: (request) => system.resolveProjectileImpact(request) });

  for (const record of active) {
    runtime.spawnLegacyProjectile(record.sprite.x, record.sprite.y, 0, record.ownerId, {} as ProjectileSpawnConfig);
  }
  spawnedRequests.length = 0;

  return { system, runtime, applyDamage, destroyProjectile, spawnProjectile, spawnedRequests, released };
}

describe('generic projectile target piercing', () => {
  it('damages every overlapping enemy once and keeps the projectile alive', () => {
    const proj = makeProjectile(true);
    const { runtime, applyDamage, destroyProjectile } = makeSystem(proj, [
      makeEnemy('enemy-a', -10),
      makeEnemy('enemy-b', 10),
    ]);

    runtime.runHostInteractionStage(0);

    expect(applyDamage).toHaveBeenCalledTimes(2);
    expect(applyDamage.mock.calls.map(call => call[0])).toEqual(['enemy-a', 'enemy-b']);
    expect(destroyProjectile).not.toHaveBeenCalled();
  });

  it('never hits the same enemy twice across frames', () => {
    const proj = makeProjectile(true);
    const { runtime, applyDamage, destroyProjectile } = makeSystem(proj, [makeEnemy('enemy-a', 0)]);

    runtime.runHostInteractionStage(0);
    runtime.runHostInteractionStage(16);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(destroyProjectile).not.toHaveBeenCalled();
  });

  it('consumes an ordinary projectile on its first target', () => {
    const proj = makeProjectile(false);
    const { runtime, destroyProjectile } = makeSystem(proj, [
      makeEnemy('enemy-a', -10),
      makeEnemy('enemy-b', 10),
    ]);

    runtime.runHostInteractionStage(0);

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
    const { system, runtime, destroyProjectile, spawnedRequests } = makeSystem(proj, [], [proj]);
    system.setEnergyShieldSystem({
      getReflectDomes: () => [{ ownerId: 'shield-owner', x: 0, y: 0, radius: 20, color: 0x123456, reflect: true }],
      onDomeAbsorb: vi.fn(),
    } as never);

    runtime.runHostInteractionStage(0);

    expect(spawnedRequests).toHaveLength(1);
    expect(spawnedRequests[0]).toMatchObject({ x: 10, y: 0, angle: 0, ownerId: 'shield-owner' });
    expect(spawnedRequests[0].cfg).toMatchObject({
      ownerColor: 0x123456,
      sourceId: 'environment.reflector_dome',
      reflected: true,
      explosion: proj.explosion,
    });
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
    const { system, runtime, destroyProjectile, spawnedRequests } = makeSystem(proj, [], [proj]);
    system.setEnergyShieldSystem({
      getReflectDomes: () => [{ ownerId: 'shield-owner', x: 0, y: 0, radius: 20, color: 0x123456, reflect: true }],
      onDomeAbsorb: vi.fn(),
    } as never);

    runtime.runHostInteractionStage(0);

    expect(spawnedRequests).toHaveLength(1);
    expect(spawnedRequests[0]).toMatchObject({ x: 10, y: 0, angle: 0, ownerId: 'shield-owner' });
    expect(spawnedRequests[0].cfg).toMatchObject({
      isGrenade: true,
      fuseTime: expect.any(Number),
      sourceId: 'environment.reflector_dome',
      reflected: true,
    });
    expect(destroyProjectile).toHaveBeenCalledWith(proj.id);
  });

  it('deflects a projectile through the normal spawn path with inherited effects', () => {
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
      lastX: 0,
      lastY: 0,
      x: 0,
      y: 0,
      getBounds: () => new Phaser.Geom.Rectangle(-20, -10, 40, 20),
      body: { velocity: { x: 0, y: 100 } },
    }) as unknown as TrackedProjectile;
    const { runtime, destroyProjectile, spawnedRequests } = makeSystem(target, [], [target, blower]);

    runtime.runHostInteractionStage(0);

    expect(spawnedRequests).toHaveLength(1);
    expect(spawnedRequests[0]).toMatchObject({
      x: target.sprite.x,
      y: target.sprite.y,
      angle: Math.PI / 2,
      ownerId: 'blower-owner',
    });
    expect(spawnedRequests[0].cfg).toMatchObject({
      sourceId: 'weapon.leaf_blower_deflect',
      reflected: true,
      explosion: target.explosion,
    });
    expect(destroyProjectile).toHaveBeenCalledWith(target.id);
  });

  it('characterizes current same-stage traversal when a hit spawns plasma children', () => {
    const parent = makeProjectile(false);
    parent.plasmaSwarmEnabled = true;
    parent.plasmaSwarmProjectileCount = 1;
    parent.initialSpeed = 100;
    const enemy = makeEnemy('enemy-a', 0);
    enemy.updatePlasmaChargeStacks = vi.fn();
    const secondEnemy = makeEnemy('enemy-b', 25);
    const { runtime, applyDamage, spawnProjectile } = makeSystem(parent, [enemy, secondEnemy], [parent]);
    const originalRandom = Math.random;
    Math.random = () => 0;

    try {
      runtime.runHostInteractionStage(0);

      // Der Schwarm entsteht während der laufenden Stage und wird darin noch verarbeitet.
      expect(spawnProjectile).toHaveBeenCalled();
      expect(applyDamage).toHaveBeenCalledTimes(spawnProjectile.mock.calls.length + 1);
      expect(runtime.activeCount).toBe(0);
    } finally {
      Math.random = originalRandom;
    }
  });
});
