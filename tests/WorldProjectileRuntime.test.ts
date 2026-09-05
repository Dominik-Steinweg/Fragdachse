import { describe, expect, it, vi } from 'vitest';

import {
  WorldProjectileRuntime,
  type ProjectilePhysicsBindingPort,
  type ProjectileRuntimeOwnerPort,
} from '../src/projectile/WorldProjectileRuntime';
import type { ProjectileSpawnConfig, ProjectileRuntimeRecord } from '../src/types';
import {
  createSingleOwnerProvenance,
  type ProjectileProvenance,
  type ProjectileSpawnRequest,
} from '../src/projectile/ProjectileSpawnRequest';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import type { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';
import { WorldLifecycle, type WorldLifecycleSink } from '../src/world/WorldLifecycle';
import type { WorldRuntimeContext } from '../src/world/WorldRuntimeContext';
import type { ProjectileBurnAugment } from '../src/projectile/ProjectileTravelPort';

function createSimulation() {
  const created: ProjectileRuntimeRecord[] = [];
  const released: ProjectileRuntimeRecord[] = [];
  let boundOwner: ProjectileRuntimeOwnerPort | null = null;
  const simulation: ProjectilePhysicsBindingPort = {
    bindOwner: (owner) => { boundOwner = owner; },
    createProjectile: (_id, _x, _y, _angle, _ownerId, _cfg, _hostNowMs, provenance) => {
      const record = { id: _id, pendingDestroy: false, provenance } as unknown as ProjectileRuntimeRecord;
      created.push(record);
      return record;
    },
    releaseProjectileResources: (record) => { released.push(record); },
    releaseWorldState: vi.fn(),
  };
  return { simulation, created, released, getBoundOwner: () => boundOwner };
}

function createPresentation(): ProjectilePresentationRuntime {
  return {
    clientVisualCount: 0,
    syncHostRenderers: () => {},
    getShadowSamples: () => [],
    getLightSamples: () => [],
    presentClientFrame: () => {},
    extrapolateClient: () => {},
    releaseWorldPresentation: () => {},
  } as unknown as ProjectilePresentationRuntime;
}

function createRuntime(identityScope = new ProjectileIdentityScope(1)) {
  const simulation = createSimulation();
  const runtime = new WorldProjectileRuntime({
    physicsBinding: simulation.simulation,
    presentation: createPresentation(),
    identityScope,
    hostNowMs: () => 1_000,
  });
  return { runtime, ...simulation };
}

function createHydraRecord(
  id: number,
  x: number,
  y: number,
  angle: number,
  ownerId: string,
  cfg: ProjectileSpawnConfig,
  provenance: ProjectileProvenance,
): ProjectileRuntimeRecord {
  const body = {
    velocity: {
      x: Math.cos(angle) * cfg.speed,
      y: Math.sin(angle) * cfg.speed,
    },
    setVelocity: vi.fn((nextX: number, nextY: number) => {
      body.velocity.x = nextX;
      body.velocity.y = nextY;
    }),
    reset: vi.fn(),
    enable: true,
  };
  return {
    ...cfg,
    id,
    ownerId,
    provenance,
    sourceId: cfg.sourceId ?? 'weapon.HYDRA',
    collisionMode: cfg.collisionMode ?? 'physics',
    sprite: {
      active: true,
      x,
      y,
      displayWidth: cfg.size,
      displayHeight: cfg.size,
    },
    body,
    lastX: 0,
    lastY: 0,
    pendingDestroy: false,
    bounceCount: cfg.initialBounceCount ?? 0,
    createdAt: 0,
    boundsListener: () => {},
    colliders: [],
    lifetime: cfg.lifetime,
    maxBounces: cfg.maxBounces,
    isGrenade: cfg.isGrenade,
    adrenalinGain: cfg.adrenalinGain,
    damage: cfg.damage,
    color: cfg.color,
    timeBubbleFactor: 1,
  } as unknown as ProjectileRuntimeRecord;
}

const payload = {} as ProjectileSpawnConfig;

describe('WorldProjectileRuntime – world-owned Projectile-Registry', () => {
  it('vergibt Identity genau einmal und macht jeden Spawn auffindbar', () => {
    const { runtime } = createRuntime();

    const first = runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    const second = runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    expect(second).not.toBe(first);
    expect(runtime.getSummary().activeCount).toBe(2);
    expect(runtime.getSummary().activeProjectilesByOwner.get('owner')).toBe(2);
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
    expect(runtime.activeCount).toBe(0);
  });

  it('gibt beim World-Teardown jeden Record frei und löst die Simulation', () => {
    const { runtime, simulation, released, getBoundOwner } = createRuntime();
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);
    expect(getBoundOwner()).not.toBeNull();

    runtime.destroy();
    runtime.destroy();

    expect(released).toHaveLength(2);
    expect(simulation.releaseWorldState).toHaveBeenCalledOnce();
    expect(getBoundOwner()).toBeNull();
    expect(runtime.activeCount).toBe(0);
  });

  it('taktet den Flight-Core mit der vom Host gelieferten Zeit vor der Binding-Stufe', () => {
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
    } as unknown as ProjectileRuntimeRecord;
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
      presentation: createPresentation(),
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 0,
    });
    runtime.spawnProjectileConfig(0, 0, 0, 'owner', payload);

    runtime.runHostProjectileStage(100, 1_234);

    expect(stageNowMs).toBe(1_234);
    expect(receivedAge).toBe(100);
  });

  it('materialisiert Hydra-Kinder erst über die explizite nächste Interaction-Stage', () => {
    const created: Array<{
      x: number;
      y: number;
      angle: number;
      cfg: ProjectileSpawnConfig;
      provenance: ProjectileProvenance;
    }> = [];
    let boundOwner: ProjectileRuntimeOwnerPort | null = null;
    const simulation: ProjectilePhysicsBindingPort = {
      bindOwner: (owner) => { boundOwner = owner; },
      createProjectile: (id, x, y, angle, ownerId, cfg, _hostNowMs, provenance) => {
        created.push({ x, y, angle, cfg, provenance });
        return createHydraRecord(id, x, y, angle, ownerId, cfg, provenance);
      },
      releaseProjectileResources: () => {},
      releaseWorldState: () => {},
    };
    const runtime = new WorldProjectileRuntime({
      physicsBinding: simulation,
      presentation: createPresentation(),
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 500,
    });
    const parentId = runtime.spawnProjectileConfig(0, 0, 0, 'shooter', {
      speed: 100,
      size: 10,
      damage: 20,
      color: 0x22ccff,
      ownerColor: 0x22ccff,
      lifetime: 1_000,
      maxBounces: 2,
      isGrenade: false,
      adrenalinGain: 4,
      sourceId: 'weapon.HYDRA',
      collisionMode: 'physics',
      splitCount: 2,
      splitSpread: 30,
      splitFactor: 1,
      remainingRangePx: 100,
    });

    if (!boundOwner?.queueHydraSplit) throw new Error('Expected the world owner Hydra seam');
    expect(boundOwner.queueHydraSplit(parentId, 20, 0, 100, 0)).toBe(true);
    expect(created).toHaveLength(1);
    expect(runtime.activeCount).toBe(0);

    // The queued children are not part of this interaction pass, even though the parent contact
    // was reported before the host stage began.
    runtime.runHostInteractionStage(500);
    expect(created).toHaveLength(1);
    expect(runtime.activeCount).toBe(0);

    runtime.runHostInteractionStage(516);
    expect(created).toHaveLength(3);
    expect(runtime.activeCount).toBe(2);
    expect(created.slice(1).map((entry) => entry.angle)).toEqual([-Math.PI / 6, Math.PI / 6]);
    expect(created.slice(1).every((entry) => entry.cfg.suppressSpawnFx === true)).toBe(true);
    expect(created.slice(1).every((entry) => entry.cfg.initialBounceCount === 1)).toBe(true);
    expect(created.slice(1).every((entry) => entry.provenance.lineage?.parentProjectileId === parentId)).toBe(true);
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
    } as unknown as ProjectileRuntimeRecord;
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
      presentation: createPresentation(),
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
    } as unknown as ProjectileRuntimeRecord;
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
      presentation: createPresentation(),
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
    expect(id).toBe(0);
    expect(runtime.getTravelSamples()[0]?.provenance).toBe(provenance);
    expect(runtime.getThreatSamples()[0]?.provenance).toBe(provenance);
    expect(runtime.getSummary().activeProjectilesByOwner.get(provenance.allegiance.ownerId)).toBe(1);
    expect(runtime.getSummary().activeProjectilesByOwner.get(provenance.attributionId)).toBeUndefined();
  });
});
