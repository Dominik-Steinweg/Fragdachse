import { describe, expect, it, vi } from 'vitest';

import {
  WorldProjectileRuntime,
  type ProjectilePhysicsBindingPort,
  type ProjectileRuntimeOwnerPort,
} from '../src/projectile/WorldProjectileRuntime';
import type { ProjectileSpawnConfig, TrackedProjectile } from '../src/types';
import {
  createSingleOwnerProvenance,
  type ProjectileProvenance,
  type ProjectileSpawnRequest,
} from '../src/projectile/ProjectileSpawnRequest';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import type { ProjectileBurnAugment } from '../src/projectile/ProjectileTravelPort';

function createSimulation() {
  const created: TrackedProjectile[] = [];
  const released: TrackedProjectile[] = [];
  let boundOwner: ProjectileRuntimeOwnerPort | null = null;
  const simulation: ProjectilePhysicsBindingPort = {
    bindOwner: (owner) => { boundOwner = owner; },
    createProjectile: (_id, _x, _y, _angle, _ownerId, _cfg, _hostNowMs, provenance) => {
      const record = { id: _id, pendingDestroy: false, provenance } as unknown as TrackedProjectile;
      created.push(record);
      return record;
    },
    releaseProjectileResources: (record) => { released.push(record); },
    releaseWorldState: vi.fn(),
  };
  return { simulation, created, released, getBoundOwner: () => boundOwner };
}

function createRuntime(identityScope = new ProjectileIdentityScope(1)) {
  const simulation = createSimulation();
  const runtime = new WorldProjectileRuntime({
    physicsBinding: simulation.simulation,
    identityScope,
    hostNowMs: () => 1_000,
  });
  return { runtime, ...simulation };
}

const payload = {} as ProjectileSpawnConfig;

describe('WorldProjectileRuntime – world-owned Projectile-Registry', () => {
  it('vergibt Identity genau einmal und macht jeden Spawn auffindbar', () => {
    const { runtime } = createRuntime();

    const first = runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    const second = runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    expect(second).not.toBe(first);
    expect(runtime.store.getById(first)?.id).toBe(first);
    expect(runtime.store.getById(second)?.id).toBe(second);
    expect(runtime.activeCount).toBe(2);
  });

  it('verwendet nach Runtime-Rebuild derselben World-Revision keine Projectile-Id erneut', () => {
    const context = {
      descriptor: {
        worldRevision: 21,
        definitionId: 'world:test',
        seed: 1,
        generatorVersion: 1,
        layoutFingerprint: 'test',
      },
    } as WorldRuntimeContext;
    let current: WorldProjectileRuntime | null = null;
    const runtimes: WorldProjectileRuntime[] = [];
    const sink: WorldLifecycleSink = {
      publish: () => {},
      clear: () => {},
      attach: (_worldContext, identityScope) => {
        current = createRuntime(identityScope).runtime;
        runtimes.push(current);
      },
      detach: () => {
        current?.destroy();
        current = null;
      },
    };
    const lifecycle = new WorldLifecycle(sink);
    lifecycle.beginCreate(context.descriptor, null);
    lifecycle.attachRuntime(context);
    const firstId = current!.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    lifecycle.detachRuntime();
    lifecycle.attachRuntime(context);
    const secondId = current!.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    expect(runtimes).toHaveLength(2);
    expect(secondId).toBeGreaterThan(firstId);
    expect(secondId).toBe(1);

    lifecycle.endInstance();
  });

  it('entfernt ein Projectile vollständig und bleibt bei Wiederholung wirkungslos', () => {
    const { runtime, released } = createRuntime();
    const id = runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    runtime.destroyProjectile(id);
    runtime.destroyProjectile(id);
    runtime.destroyProjectile(4711);

    expect(released).toHaveLength(1);
    expect(runtime.store.getById(id)).toBeUndefined();
    expect(runtime.store.stepOrder).toHaveLength(0);
    expect(runtime.activeCount).toBe(0);
  });

  it('gibt beim World-Teardown jeden Record frei und löst die Simulation', () => {
    const { runtime, simulation, released, getBoundOwner } = createRuntime();
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    expect(getBoundOwner()).toBe(runtime);

    runtime.destroy();
    runtime.destroy();

    expect(released).toHaveLength(2);
    expect(simulation.releaseWorldState).toHaveBeenCalledOnce();
    expect(getBoundOwner()).toBeNull();
    expect(runtime.store.stepOrder).toHaveLength(0);
    expect(runtime.activeCount).toBe(0);
  });

  it('taktet den Flight-Core mit der vom Host gelieferten Zeit vor der Legacy-Stufe', () => {
    const projectile = {
      id: 0,
      ownerId: 'owner',
      provenance: createSingleOwnerProvenance('owner'),
      sprite: { x: 0, y: 0, displayWidth: 4 },
      body: { velocity: { x: 10, y: 0 } },
      lastX: 0,
      lastY: 0,
      createdAt: 0,
      simulatedAgeMs: 0,
      timeBubbleFactor: 1,
      lifetime: 1_000,
      maxBounces: 0,
      bounceCount: 0,
      isGrenade: false,
      colliders: [],
    } as unknown as TrackedProjectile;
    let stageNowMs = 0;
    let receivedAge = 0;
    const simulation: ProjectilePhysicsBindingPort = {
      bindOwner: () => {},
      createProjectile: () => projectile,
      releaseProjectileResources: () => {},
      runProjectileEffectsStage: (_deltaMs, nowMs, coreStage) => {
        stageNowMs = nowMs;
        receivedAge = projectile.simulatedAgeMs ?? 0;
        expect(coreStage.lifetimeExpiredIds.has(projectile.id)).toBe(false);
        return { projectileExplosions: [], grenadePayloads: [], countdownEvents: [] };
      },
      releaseWorldState: () => {},
    };
    const runtime = new WorldProjectileRuntime({
      physicsBinding: simulation,
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 0,
    });
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    runtime.runHostProjectileStage(100, 1_234);

    expect(stageNowMs).toBe(1_234);
    expect(receivedAge).toBe(100);
  });

  it('materialisiert Travel-Capabilities und wendet Burn-Augments im Owner an', () => {
    const projectile = {
      id: 0,
      ownerId: 'owner',
      provenance: createSingleOwnerProvenance('owner', {
        weaponSourceId: 'weapon.GLOCK',
        sourceSlot: 'weapon2',
        allowTeamDamage: false,
      }),
      sourceId: 'weapon.GLOCK',
      sourceSlot: 'weapon1',
      allowTeamDamage: false,
      sprite: { active: true, x: 100, y: 8 },
      body: { velocity: { x: 10, y: 0 } },
      lastX: 0,
      lastY: 8,
      pendingDestroy: false,
      isGrenade: false,
      isFlame: false,
      canReceiveFireImbue: true,
      fireTrail: {
        durationMs: 1_000,
        burnDurationMs: 500,
        burnDamagePerTick: 2,
        sourceId: 'weapon.AWP.fire_trail',
      },
      pathEffectKind: 'awp',
      fireTrailHalfWidthCells: 1,
      awpCorridorHalfWidth: 24,
      awpCorridorDamage: 40,
    } as unknown as TrackedProjectile;
    let appliedAugment: ProjectileBurnAugment | null = null;
    const simulation: ProjectilePhysicsBindingPort = {
      bindOwner: () => {},
      createProjectile: () => projectile,
      releaseProjectileResources: () => {},
      applyProjectileBurnAugment: (_id, augment) => {
        appliedAugment = augment;
        projectile.supplementalBurnOnHit = augment.burn;
        projectile.supplementalBurnProvenance = augment.provenance;
        return true;
      },
      releaseWorldState: () => {},
    };
    const runtime = new WorldProjectileRuntime({
      physicsBinding: simulation,
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 0,
    });
    runtime.spawnProjectileConfig(0, 8, 0, 'owner', payload);

    expect(runtime.getTravelSamples()).toMatchObject([{
      projectileId: 0,
      fromX: 0,
      fromY: 8,
      toX: 100,
      toY: 8,
      capabilities: {
        canReceiveFireImbue: true,
        pathEffect: {
          kind: 'awp',
          fireTrail: { halfWidthCells: 1, cellKey: '6:0' },
          awpCorridor: { halfWidth: 24, damage: 40 },
        },
      },
    }]);

    const augment: ProjectileBurnAugment = {
      burn: { durationMs: 750, damagePerTick: 4 },
      provenance: createSingleOwnerProvenance('fire-owner', { weaponSourceId: 'ground-fire' }),
    };
    expect(runtime.addBurnAugment(0, augment)).toBe(true);
    expect(appliedAugment).toEqual(augment);
    expect(projectile.supplementalBurnOnHit).toEqual(augment.burn);
    expect(projectile.supplementalBurnProvenance).toEqual(augment.provenance);
  });

  it('erhält getrennte Provenance-Dimensionen von Semantic Spawn bis Runtime und Reads', () => {
    const provenance: ProjectileProvenance = {
      gameplaySourceId: 'weapon-source',
      attributionId: 'credit-owner',
      allegiance: { ownerId: 'team-owner', allowTeamDamage: true },
      weaponSourceId: 'weapon.test',
      sourceSlot: 'weapon2',
      sourceTurretId: 'turret-17',
      lineage: {
        parentProjectileId: 77,
        reflected: true,
        plasmaSwarmChild: true,
        plasmaSwarmOriginEnemyId: 'enemy-9',
      },
      correlation: { ak47ShotId: 1234 },
    };
    const baseRecord = {
      id: 0,
      pendingDestroy: false,
      isGrenade: false,
      isFlame: false,
      canReceiveFireImbue: true,
      pathEffectKind: 'awp' as const,
      awpCorridorHalfWidth: 24,
      awpCorridorDamage: 40,
      lastX: 0,
      lastY: 8,
      sprite: { active: true, x: 100, y: 8, displayWidth: 4, displayHeight: 4 },
      body: { velocity: { x: 10, y: 0 } },
    } as unknown as TrackedProjectile;
    const simulation: ProjectilePhysicsBindingPort = {
      bindOwner: () => {},
      createProjectile: (id, _x, _y, _angle, _ownerId, _cfg, _hostNowMs, receivedProvenance) => ({
        ...baseRecord,
        id,
        provenance: receivedProvenance,
      }),
      releaseProjectileResources: () => {},
      releaseWorldState: () => {},
    };
    const runtime = new WorldProjectileRuntime({
      physicsBinding: simulation,
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 0,
    });
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
    const stored = runtime.store.getById(id);

    expect(stored?.provenance).toBe(provenance);
    expect(runtime.getTravelSamples()[0]?.provenance).toBe(provenance);
    expect(runtime.getThreatSamples()[0]?.provenance).toBe(provenance);
    expect(runtime.getSummary().activeProjectilesByOwner.get(provenance.allegiance.ownerId)).toBe(1);
    expect(runtime.getSummary().activeProjectilesByOwner.get(provenance.attributionId)).toBeUndefined();
  });
});
