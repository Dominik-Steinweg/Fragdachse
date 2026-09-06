import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Geom: {
    Line: class { constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {} },
    Rectangle: class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
    },
    Intersects: {
      LineToRectangle: () => false,
      RectangleToRectangle: () => false,
    },
  },
}));

import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import type { ProjectileSpawnConfig } from '../src/types';
import type { ProjectileRuntimeRecord } from '../src/projectile/ProjectileRuntimeRecord';
import type { ProjectileBurnAugment } from '../src/projectile/ProjectileTravelPort';
import type {
  ProjectileProvenance,
  ProjectileSpawnRequest,
} from '../src/projectile/ProjectileSpawnRequest';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { ProjectileStore } from '../src/projectile/ProjectileStore';
import {
  createTechnicalPhysicsBinding,
  createPresentation,
} from './ProjectileRuntimeTestHelper';

function createRuntimeHarness(
  physics = createTechnicalPhysicsBinding(),
  identityScope = new ProjectileIdentityScope(1),
) {
  const runtime = new WorldProjectileRuntime({
    physicsBinding: physics.binding,
    presentation: createPresentation(),
    identityScope,
    hostNowMs: () => 1_000,
  });
  return { runtime, physics };
}

function baseRequest(
  overrides: Partial<ProjectileSpawnConfig> = {},
  origin = { x: 0, y: 0, angle: 0 },
): ProjectileSpawnRequest {
  const cfg = {
    speed: 100,
    size: 8,
    damage: 10,
    color: 0xffffff,
    ownerColor: 0xffffff,
    lifetime: 1_000,
    maxBounces: 0,
    isGrenade: false,
    adrenalinGain: 0,
    ...overrides,
  };
  return {
    origin,
    provenance: { gameplaySourceId: 'owner', attributionId: 'owner', allegiance: { ownerId: 'owner' }, weaponSourceId: cfg.sourceId },
    flight: {
      speed: cfg.speed, size: cfg.size, lifetimeMs: cfg.lifetime, maxBounces: cfg.maxBounces,
      isGrenade: cfg.isGrenade, collisionMode: cfg.collisionMode, remainingRangePx: cfg.remainingRangePx,
      split: { count: cfg.splitCount, spread: cfg.splitSpread, speedFactor: cfg.splitFactor },
    },
    interaction: {
      directHit: { damage: cfg.damage, adrenalinGain: cfg.adrenalinGain },
      explosion: cfg.explosion, detonable: cfg.detonable,
      multiExplosion: { count: cfg.multiExplosionCount },
      burn: { canReceiveFireImbue: cfg.canReceiveFireImbue },
      pathEffect: { kind: cfg.pathEffectKind, awpCorridor: { halfWidth: cfg.awpCorridorHalfWidth, damage: cfg.awpCorridorDamage } },
    },
    presentation: { color: cfg.color, ownerColor: cfg.ownerColor },
  };
}

function baseExplosion() {
  return {
    radius: 24,
    maxDamage: 20,
    minDamage: 5,
    knockback: 0,
    selfDamageMult: 0,
    damageTarget: 'enemies' as const,
  };
}

function makeProvenance(ownerId: string): ProjectileProvenance {
  return {
    gameplaySourceId: 'weapon.test',
    attributionId: ownerId,
    allegiance: { ownerId, allowTeamDamage: false },
  };
}

function configureEnemyImpact(runtime: WorldProjectileRuntime, combat = vi.fn(() => ({ accepted: true }))) {
  runtime.setProjectileCollisionTargetQueryPort({
    readCollisionTargets: (sink) => sink(
      'enemy', 'enemy-1', 'enemy-owner', 0, 0, 8, -8, -8, 8, 8,
    ),
  });
  runtime.setProjectileTargetabilityPort({
    canDamage: () => true,
    canDamageOwner: () => true,
    isTargetCurrentlyValid: () => true,
  });
  runtime.setProjectileCombatPort({
    resolveDirectImpact: combat,
    resolveExplosionCombat: vi.fn(() => ({ damagedTargetKeys: [] })),
  });
  return combat;
}

describe('WorldProjectileRuntime – technical Physics boundary', () => {
  it('records the host collision point and post-contact velocity for client presentation', () => {
    const physics = createTechnicalPhysicsBinding();
    const presentation = { ...createPresentation(), playBounceImpact: vi.fn() };
    const runtime = new WorldProjectileRuntime({
      physicsBinding: physics.binding,
      presentation,
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 1_000,
    });
    const id = runtime.spawnProjectile(baseRequest({ maxBounces: 2 }))!;

    physics.emit({
      projectileId: id,
      target: { kind: 'world-boundary' },
      x: 37.25,
      y: 48.5,
      velocityX: -100,
      velocityY: 0,
      source: 'world-boundary',
    });

    const replication: Array<{ dynamic: { bounce?: unknown } }> = [];
    runtime.readProjectileReplication((record) => replication.push(record));
    expect(presentation.playBounceImpact).toHaveBeenCalledWith(
      id, 37.25, 48.5, 100, 0, 0xffffff, undefined, true,
    );
    expect(replication[0]?.dynamic.bounce).toEqual({
      sequence: 1,
      x: 37.25,
      y: 48.5,
      vx: 100,
      vy: 0,
      tracerBounce: true,
    });
    runtime.destroy();
  });

  it('preserves source, attribution and parent lineage when a swarm reaction creates children', () => {
    const { runtime } = createRuntimeHarness();
    const provenance: ProjectileProvenance = {
      gameplaySourceId: 'source', attributionId: 'credit', allegiance: { ownerId: 'team' },
      weaponSourceId: 'weapon.plasma', correlation: { ak47ShotId: 7 },
    };
    runtime.applyPlasmaSwarmImpact({
      projectileId: 12, provenance, enemyId: 'enemy-origin', x: 0, y: 0,
      projectileCount: 2, normalDamage: 10, normalSize: 8, normalSpeed: 100, normalRange: 100,
      explosionRadius: 10, explosionDamage: 5, explosionSlowFraction: 0, color: 0xffffff,
    });
    expect(runtime.getThreatSamples()).toHaveLength(2);
    for (const child of runtime.getThreatSamples()) {
      expect(child.provenance).toMatchObject({
        gameplaySourceId: 'source', attributionId: 'credit', allegiance: { ownerId: 'team' },
        lineage: { parentProjectileId: 12, plasmaSwarmChild: true, plasmaSwarmOriginEnemyId: 'enemy-origin' },
        correlation: { ak47ShotId: 7 },
      });
    }
    runtime.destroy();
  });

  it('releases a handle once when a terminal callback tears down its world', () => {
    const { runtime, physics } = createRuntimeHarness();
    const id = runtime.spawnProjectile(baseRequest())!;
    const resolved = vi.fn(() => runtime.destroy());
    runtime.setProjectileResolvedCallback(resolved);
    runtime.destroyProjectile(id);
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(physics.released).toEqual([id]);
  });

  it('owns identity and sends only technical spawn mechanics to Physics', () => {
    const { runtime, physics } = createRuntimeHarness();
    const first = runtime.spawnProjectile(baseRequest({}, { x: 10, y: 20, angle: 0 }))!;
    const second = runtime.spawnProjectile(baseRequest({}, { x: 10, y: 20, angle: Math.PI / 2 }))!;

    expect(second).not.toBe(first);
    expect(runtime.activeCount).toBe(2);
    expect(runtime.getSummary().activeProjectilesByOwner.get('owner')).toBe(2);
    expect(physics.specs[0]).toMatchObject({
      id: first,
      x: 10,
      y: 20,
      velocityX: 100,
      velocityY: 0,
        mechanics: { rockContactMode: 'collider', bodyResponse: 'bounce', worldBounds: true },
    });
    runtime.destroy();
  });

  it('preserves semantic source, attribution, and allegiance across owner read projections', () => {
    const { runtime } = createRuntimeHarness();
    const provenance: ProjectileProvenance = {
      gameplaySourceId: 'weapon-source',
      attributionId: 'credit-owner',
      allegiance: { ownerId: 'team-owner', allowTeamDamage: true },
      weaponSourceId: 'weapon.test',
      sourceSlot: 'weapon2',
      sourceTurretId: 'turret-17',
      lineage: { parentProjectileId: 77, reflected: true },
      correlation: { ak47ShotId: 1234 },
    };
    const request: ProjectileSpawnRequest = {
      origin: { x: 0, y: 8, angle: 0 },
      flight: {
        speed: 100,
        size: 4,
        lifetimeMs: 1_000,
        maxBounces: 0,
        isGrenade: false,
      },
      provenance,
      interaction: {
        burn: { canReceiveFireImbue: true },
        pathEffect: { kind: 'awp', awpCorridor: { halfWidth: 24, damage: 40 } },
      },
      presentation: { color: 0xffffff },
    };

    const id = runtime.spawnProjectile(request);
    if (id === null) throw new Error('Expected semantic projectile spawn to succeed');

    expect(runtime.getThreatSamples()[0]?.provenance).toBe(provenance);
    expect(runtime.getTravelSamples()[0]).toMatchObject({
      projectileId: id,
      provenance,
      capabilities: {
        canReceiveFireImbue: true,
        pathEffect: {
          kind: 'awp',
          awpCorridor: { halfWidth: 24, damage: 40 },
        },
      },
    });
    const replication: Array<{ id: number; static: { ownerId: string; allowTeamDamage?: boolean } }> = [];
    runtime.readProjectileReplication((record) => replication.push(record));
    expect(replication).toEqual([expect.objectContaining({
      id,
      static: expect.objectContaining({
        id,
        ownerId: 'team-owner',
        allowTeamDamage: true,
      }),
    })]);
    runtime.destroy();
  });

  it('expires by host lifetime and emits one terminal explosion request', () => {
    const { runtime, physics } = createRuntimeHarness();
    runtime.spawnProjectile(baseRequest({
      lifetime: 100,
      explosion: baseExplosion(),
    }));

    const stage = runtime.runHostProjectileStage(101, 1_101);

    expect(stage.projectileExplosions).toHaveLength(1);
    expect(stage.projectileExplosions[0]?.effect).toEqual(baseExplosion());
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    runtime.destroy();
  });

  it('resolves direct combat through public ports and owns terminal cleanup', () => {
    const { runtime, physics } = createRuntimeHarness();
    const resolveDirectImpact = configureEnemyImpact(runtime);

    const id = runtime.spawnProjectile(baseRequest({ collisionMode: 'overlap' }))!;
    runtime.runHostInteractionStage(1_000);

    expect(resolveDirectImpact).toHaveBeenCalledWith(expect.objectContaining({
      projectileId: id,
      target: { kind: 'enemy', id: 'enemy-1' },
      directHit: expect.objectContaining({ damage: 10 }),
    }));
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    runtime.destroy();
  });

  it('keeps a multi explosion projectile alive across explosion completion and then releases it', () => {
    const { runtime, physics } = createRuntimeHarness();
    configureEnemyImpact(runtime);
    const id = runtime.spawnProjectile(baseRequest({
      collisionMode: 'overlap',
      explosion: baseExplosion(),
      multiExplosionCount: 2,
    }));

    runtime.runHostInteractionStage(1_000);
    const first = runtime.runHostProjectileStage(0, 1_000);
    expect(first.projectileExplosions).toHaveLength(1);
    expect(first.projectileExplosions[0]).toMatchObject({
      projectileId: id,
      continuation: { projectileId: id },
    });
    expect(runtime.activeCount).toBe(1);

    runtime.completeProjectileExplosion(id, { damagedTargetKeys: ['enemies:enemy-1'] });
    expect(runtime.activeCount).toBe(1);
    runtime.destroyProjectile(id);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    runtime.destroy();
  });

  it('reports and consumes a detonable owner projectile exactly once', () => {
    const { runtime, physics } = createRuntimeHarness();
    const id = runtime.spawnProjectile(baseRequest({
      detonable: {
        tag: 'asmd_ball',
        aoeDamage: 12,
        aoeRadius: 24,
        allowCrossTeam: true,
      },
    }));

    const samples: unknown[] = [];
    runtime.readDetonableProjectiles((sample) => samples.push(sample));
    expect(samples).toHaveLength(1);
    expect(runtime.detonateProjectile(id, 'enemy-detonator')).toMatchObject({
      id,
      effect: { tag: 'asmd_ball' },
      detonatorOwnerId: 'enemy-detonator',
    });
    expect(runtime.detonateProjectile(id, 'enemy-detonator')).toBeNull();
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    runtime.destroy();
  });

  it('applies the strongest owner burn augment and rejects stale ownership after teardown', () => {
    const { runtime, physics } = createRuntimeHarness();
    const id = runtime.spawnProjectile(baseRequest({
      canReceiveFireImbue: true,
      pathEffectKind: 'awp',
      awpCorridorHalfWidth: 24,
      awpCorridorDamage: 40,
    }));
    const weak: ProjectileBurnAugment = {
      burn: { durationMs: 100, damagePerTick: 1 },
      provenance: makeProvenance('fire-weak'),
    };
    const strong: ProjectileBurnAugment = {
      burn: { durationMs: 300, damagePerTick: 4 },
      provenance: makeProvenance('fire-strong'),
    };

    expect(runtime.addBurnAugment(id, weak)).toBe(true);
    expect(runtime.addBurnAugment(id, strong)).toBe(true);
    expect(runtime.addBurnAugment(id, {
      burn: { durationMs: 50, damagePerTick: 1 },
      provenance: makeProvenance('fire-ignored'),
    })).toBe(false);
    expect(runtime.getTravelSamples()[0]?.provenance).toEqual(
      expect.objectContaining({ gameplaySourceId: 'owner', attributionId: 'owner' }),
    );
    const replication: Array<{ dynamic: { burning?: boolean } }> = [];
    runtime.readProjectileReplication((record) => replication.push(record));
    expect(replication[0]?.dynamic.burning).toBe(true);
    runtime.destroy();

    expect(runtime.addBurnAugment(id, strong)).toBe(false);
    expect(physics.released).toHaveLength(1);
  });

  it('materializes Hydra children on the following interaction stage', () => {
    const { runtime, physics } = createRuntimeHarness();
    const parentId = runtime.spawnProjectile(baseRequest({
      size: 10,
      damage: 20,
      maxBounces: 2,
      splitCount: 2,
      splitSpread: 30,
      splitFactor: 1,
      remainingRangePx: 100,
      sourceId: 'weapon.HYDRA',
    }));

    physics.emit({
      projectileId: parentId,
      target: { kind: 'world-boundary' },
      x: 0,
      y: 0,
      velocityX: 100,
      velocityY: 0,
      source: 'world-boundary',
    });

    expect(runtime.activeCount).toBe(0);
    runtime.runHostInteractionStage(1_000);
    expect(runtime.activeCount).toBe(0);
    runtime.runHostInteractionStage(1_016);
    expect(runtime.activeCount).toBe(2);
    expect(physics.specs).toHaveLength(3);
    expect(physics.specs.slice(1).every((spec) => spec.mechanics.worldBounds)).toBe(true);
    runtime.destroy();
  });

  it('releases each technical handle once and ignores contacts after teardown', () => {
    const { runtime, physics } = createRuntimeHarness();
    const id = runtime.spawnProjectile(baseRequest())!;

    runtime.destroyProjectile(id);
    runtime.destroyProjectile(id);
    runtime.destroy();
    physics.emit({
      projectileId: id,
      target: { kind: 'world-boundary' },
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
      source: 'world-boundary',
    });

    expect(physics.released).toHaveLength(1);
    expect(physics.releaseWorldState).toHaveBeenCalledOnce();
    expect(runtime.activeCount).toBe(0);
  });

  it('retains monotonic identity across runtime rebuild and rejects duplicate Store entries', () => {
    const scope = new ProjectileIdentityScope(21);
    const first = createRuntimeHarness(createTechnicalPhysicsBinding(), scope).runtime;
    const firstId = first.spawnProjectile(baseRequest())!;
    first.destroy();

    const second = createRuntimeHarness(createTechnicalPhysicsBinding(), scope).runtime;
    const secondId = second.spawnProjectile(baseRequest())!;
    expect(secondId).toBeGreaterThan(firstId);

    const store = new ProjectileStore(new ProjectileIdentityScope(22));
    const record = { id: 0 } as unknown as ProjectileRuntimeRecord;
    store.insert(record);
    expect(() => store.insert(record)).toThrow('Duplicate projectile identity 0');
    second.destroy();
  });
});
