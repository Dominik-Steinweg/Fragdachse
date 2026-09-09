import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
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
import { decodeProjectileDynamics, decodeProjectileStatics } from '../src/network/projectileSnapshotCodec';
import { ProjectileReplicationAdapter } from '../src/projectile/ProjectileReplicationAdapter';
import type { ProjectileSpawnConfig } from '../src/types';
import type { ProjectileRuntimeRecord } from '../src/projectile/ProjectileRuntimeRecord';
import type { ProjectileBurnAugment } from '../src/projectile/ProjectileTravelPort';
import type {
  ProjectileProvenance,
  ProjectileSpawnRequest,
} from '../src/projectile/ProjectileSpawnRequest';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { ProjectileStore } from '../src/projectile/ProjectileStore';
import { adaptProjectileDirectDamageRequest } from '../src/combat/ProjectileCombatContractAdapter';
import { createPrimaryHitRewardIntent } from '../src/combat/PrimaryHitReward';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { WorldWeaponExecutionRuntime } from '../src/world/WorldWeaponExecutionRuntime';
import type { ProjectileDirectImpactRequest } from '../src/projectile/ProjectileCombatPort';
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
    presentation: { color: cfg.color, ownerColor: cfg.ownerColor, tracer: cfg.tracerConfig },
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
  it('charges a bubble before an inner direct hit consumes the projectile, without modifying its payload', () => {
    const { runtime } = createRuntimeHarness();
    const bubble = new TimeBubbleSystem();
    bubble.hostCreateBubble('owner', 0, 0, { type: 'time_bubble', radius: 30, duration: 500,
      chargeCapacity: 40, playerSlowFactor: 0.1, projectileSlowFactor: 0.1, trainSlowFactor: 0.1 }, 1000);
    runtime.setTimeBubbleChargePort(bubble);
    const impact = configureEnemyImpact(runtime);
    const request = baseRequest({ damage: 7 });
    runtime.spawnProjectile(request);
    runtime.runHostInteractionStage(1000);
    expect(bubble.hostUpdate(1000)[0].charge).toBe(request.interaction.directHit.damage);
    expect(impact).toHaveBeenCalledOnce();
    expect(impact.mock.calls[0][0].directHit.damage).toBe(request.interaction.directHit.damage);
    expect(runtime.activeCount).toBe(0);
    runtime.runHostInteractionStage(1001);
    expect(bubble.hostUpdate(1001)[0].charge).toBe(request.interaction.directHit.damage);
    runtime.destroy(); bubble.destroyAll();
  });
  it('focuses all moving allegiances and flying utilities inside the inclusive circle without changing intrinsic speed', () => {
    const { runtime, physics } = createRuntimeHarness();
    let factor = 0.2;
    runtime.setProjectileTimeFieldPort({ getMovementFactor: () => factor });
    const ids = ['owner', 'ally', 'enemy', 'grenade', 'translocator'].map((owner, i) => {
      const request = baseRequest({ speed: 300, isGrenade: i >= 3, maxBounces: 3 }, { x: 0, y: i === 4 ? 50 : 0, angle: Math.PI });
      return runtime.spawnProjectile({ ...request, provenance: { ...request.provenance, gameplaySourceId: owner,
        attributionId: owner, allegiance: { ownerId: owner } } })!;
    });
    const outside = runtime.spawnProjectile(baseRequest({}, { x: 0, y: 50.01, angle: Math.PI }))!;
    const stationary = runtime.spawnProjectile(baseRequest({ speed: 0 }))!;
    factor = 1;
    expect(runtime.focusProjectilesInCircle({ x: 0, y: 0, radius: 50, targetX: 200, targetY: 0,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1000 })).toBe(ids.length);
    for (const id of ids) {
      const body = physics.handles.get(id)!.body;
      expect(Math.hypot(body.velocity.x, body.velocity.y)).toBeCloseTo(300);
      expect(body.velocity.x).toBeGreaterThan(0);
    }
    expect(physics.handles.get(outside)!.body.velocity.x).toBeLessThan(0);
    expect(physics.handles.get(stationary)!.body.velocity.x).toBe(0);
    const owners = new Map<number, string>();
    runtime.readProjectileReplication(record => owners.set(record.id, record.static.ownerId));
    for (const id of ids) expect(owners.get(id)).toBe('captor');
    runtime.runHostProjectileStage(1, 1001);
    expect(physics.handles.get(ids[0])!.body.velocity.x).toBeCloseTo(300); // no double unscale
    runtime.destroy();
  });

  it('preserves damage and source, transfers hit credit, and consumes a focused projectile once', () => {
    const { runtime } = createRuntimeHarness();
    const hit = configureEnemyImpact(runtime);
    const request = baseRequest({ damage: 17 });
    runtime.spawnProjectile(request);
    runtime.focusProjectilesInCircle({ x: 0, y: 0, radius: 50, targetX: 0, targetY: 0,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1000 });
    runtime.runHostInteractionStage(1000); runtime.runHostInteractionStage(1001);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0]).toMatchObject({ provenance: { gameplaySourceId: request.provenance.gameplaySourceId,
      attributionId: 'captor', allegiance: { ownerId: 'captor' } }, directHit: { damage: 17 } });
    expect(runtime.activeCount).toBe(0); runtime.destroy();
  });

  it.each([0, 1])('re-evaluates remaining overlapping fields and friendly immunity %s after ownership transfer', (immunity) => {
    const { runtime, physics } = createRuntimeHarness();
    const bubbles = new TimeBubbleSystem();
    bubbles.setFriendlyResolver((a, b) => a === b);
    const effect = { type: 'time_bubble' as const, radius: 50, duration: 1000, playerSlowFactor: 0.1, projectileSlowFactor: 0.2, trainSlowFactor: 0.1 };
    const first = bubbles.hostCreateBubble('captor', 0, 0, effect, 1000);
    bubbles.hostCreateBubble('captor', 0, 0, { ...effect, projectileSlowFactor: 0.4, friendlyImmunity: immunity }, 1000);
    runtime.setProjectileTimeFieldPort({ getMovementFactor: (x, y, now, p) => bubbles.getProjectileMovementFactorAt(x, y, now, p.allegiance.ownerId) });
    const id = runtime.spawnProjectile(baseRequest({ speed: 300 }))!;
    expect(physics.handles.get(id)!.body.velocity.x).toBeCloseTo(300 * effect.projectileSlowFactor);
    bubbles.removeBubble(first, 1000);
    runtime.focusProjectilesInCircle({ x: 0, y: 0, radius: effect.radius, targetX: 0, targetY: 100,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1000 });
    expect(physics.handles.get(id)!.body.velocity.y).toBeCloseTo(300 * (immunity ? 1 : 0.4));
    runtime.destroy(); bubbles.destroyAll();
  });

  it('preserves a captured grenade fuse and payload instead of detonating or restarting it', () => {
    const { runtime } = createRuntimeHarness();
    const request = baseRequest({ isGrenade: true });
    const effect = { type: 'damage' as const, radius: 40, damage: 27 };
    runtime.spawnProjectile({ ...request, flight: { ...request.flight, fuseTimeMs: 100 }, interaction: { grenadeEffect: effect } });
    runtime.runHostProjectileStage(50, 1050);
    runtime.focusProjectilesInCircle({ x: 0, y: 0, radius: 50, targetX: 0, targetY: 100,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1050 });
    expect(runtime.runHostProjectileStage(49, 1099).grenadePayloads).toHaveLength(0);
    expect(runtime.runHostProjectileStage(1, 1100).grenadePayloads).toEqual([expect.objectContaining({ effect,
      provenance: expect.objectContaining({ gameplaySourceId: request.provenance.gameplaySourceId, attributionId: 'captor' }) })]);
    runtime.destroy();
  });

  it('releases the origin exclusion immediately even for a shot already outside and keeps homing active after focus', () => {
    const { runtime, physics } = createRuntimeHarness();
    let active = true;
    runtime.setProjectileTimeFieldPort({ getMovementFactor: () => 1, isBubbleActive: () => active });
    runtime.setProjectileTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => emit('inside', 'enemies', 0, 30) });
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    const request = baseRequest({}, { x: 70, y: 0, angle: 0 });
    const id = runtime.spawnProjectile({ ...request, flight: { ...request.flight,
      homing: { acquireDelayMs: 0, searchRadius: 200, retargetIntervalMs: 1, maxTurnDegreesPerStep: 90, targetTypes: ['enemies'] },
      homingExcludedCircle: { bubbleId: 5, x: 0, y: 0, radius: 50, expiresAt: 5000 },
    } })!;
    runtime.runHostProjectileStage(1, 1001); expect(physics.handles.get(id)!.body.velocity.y).toBe(0);
    active = false;
    runtime.runHostProjectileStage(1, 1002); expect(physics.handles.get(id)!.body.velocity.y).toBeGreaterThan(0);
    runtime.focusProjectilesInCircle({ x: 70, y: 0, radius: 10, targetX: 200, targetY: 0,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1002 });
    expect(physics.handles.get(id)!.body.velocity.y).toBe(0);
    runtime.runHostProjectileStage(1, 1003); expect(physics.handles.get(id)!.body.velocity.y).toBeGreaterThan(0);
    runtime.destroy();
  });

  it('keeps remaining range and bounces through focus and publishes the confirmed turn', () => {
    let now = 1000;
    const physics = createTechnicalPhysicsBinding();
    const runtime = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation: createPresentation(),
      identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now });
    runtime.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(runtime));
    const id = runtime.spawnProjectile(baseRequest({ maxBounces: 1, remainingRangePx: 50, tracerConfig: { profile: 'prismatic' } }))!;
    now = 1010;
    physics.observe(id, 10, 0, 100, 0); Object.assign(physics.handles.get(id)!.sprite, { x: 10, y: 0 });
    runtime.runHostProjectileStage(10, 1010);
    runtime.getNetSnapshot(); // first publication contains the original owner
    runtime.focusProjectilesInCircle({ x: 0, y: 0, radius: 50, targetX: 10, targetY: 100,
      ownerId: 'captor', ownerColor: 0xffffff, nowMs: 1010 });
    let path: any;
    runtime.readProjectileReplication(record => { path = record.dynamic.flightPath; });
    expect(path.points.at(-1)).toMatchObject({ x: 10, y: 0 });
    expect(path.points.at(-1).vy).toBeGreaterThan(0);
    const wire = runtime.getNetSnapshot();
    expect(path.points.at(-1).breakBefore).not.toBe(true);
    expect(decodeProjectileStatics(wire?.s ?? [])).toEqual([expect.objectContaining({ id, ownerId: 'captor' })]);
    expect(decodeProjectileDynamics(wire?.u ?? [])[0].flightPath?.points).toEqual(path.points);
    physics.emit({ projectileId: id, target: { kind: 'world-boundary' }, x: 10, y: 0, velocityX: 0, velocityY: -100, source: 'world-boundary' });
    expect(runtime.activeCount).toBe(1);
    now = 1020;
    physics.observe(id, 10, -41, 0, -100); Object.assign(physics.handles.get(id)!.sprite, { x: 10, y: -41 });
    runtime.runHostProjectileStage(10, 1020);
    expect(runtime.activeCount).toBe(0);
    runtime.destroy();
  });
  it('routes prism damage and slow through normal combat, permits interior hits and consumes the shot once', () => {
    const { runtime, physics } = createRuntimeHarness();
    const bubble = new TimeBubbleSystem();
    const config = UTILITY_CONFIGS.TIME_BUBBLE;
    if (config.type !== 'time_bubble' || !config.prismEmitter) throw Error('Expected prism configuration');
    const emitter = { ...config.prismEmitter, enabled: 1 };
    const hit = configureEnemyImpact(runtime);
    bubble.setPrismProjectileSpawner(request => { runtime.spawnProjectile(request); });
    runtime.setProjectileTimeFieldPort({ getMovementFactor: (x, y, now, provenance) =>
      bubble.getProjectileMovementFactorAt(x, y, now, provenance.allegiance.ownerId) });
    bubble.hostCreateBubble('owner', 0, 0, {
      type: 'time_bubble', radius: config.bubbleRadius, duration: config.bubbleDuration,
      projectileSlowFactor: config.projectileSlowFactor, playerSlowFactor: config.playerSlowFactor,
      trainSlowFactor: config.trainSlowFactor, prismEmitter: emitter,
    }, 1000);
    bubble.hostUpdate(1000);
    expect(physics.specs[0].velocityX).toBeCloseTo(emitter.speed * config.projectileSlowFactor);
    runtime.runHostInteractionStage(1000);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0]).toMatchObject({
      provenance: { attributionId: 'owner', weaponSourceId: 'TIME_BUBBLE', sourceSlot: 'utility' },
      directHit: { damage: emitter.damage, slowFraction: emitter.slowFraction, slowDurationMs: emitter.slowDurationMs },
    });
    runtime.runHostInteractionStage(1010);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    bubble.destroyAll();
    runtime.destroy();
  });

  it('carries the circle through spawn and uses host time to stop excluding targets', () => {
    const { runtime, physics } = createRuntimeHarness();
    runtime.setProjectileTargetQueryPort({ queryTargets: (_c, _owner, _x, _y, _r, emit) => emit('inside', 'enemies', 0, 30) });
    runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true });
    const request = baseRequest();
    const id = runtime.spawnProjectile({ ...request, flight: { ...request.flight,
      homing: { acquireDelayMs: 0, searchRadius: 200, retargetIntervalMs: 1, maxTurnDegreesPerStep: 90, targetTypes: ['enemies'] },
      homingExcludedCircle: { x: 0, y: 0, radius: 50, expiresAt: 1200 },
    } })!;
    runtime.runHostProjectileStage(1, 1199);
    expect(physics.handles.get(id)!.body.velocity.y).toBe(0);
    runtime.runHostProjectileStage(1, 1200);
    expect(physics.handles.get(id)!.body.velocity.y).toBeGreaterThan(0);
    runtime.destroy();
  });
  it('preserves smoke provenance and protects only the origin during the initial flight', () => {
    const { runtime } = createRuntimeHarness();
    const hit = configureEnemyImpact(runtime);
    const request = baseRequest();
    const id = runtime.spawnProjectile({ ...request,
      provenance: { ...request.provenance, lineage: { smokeCloudId: 7, smokeKind: 'discharge' } },
      flight: { ...request.flight, collisionFilter: { initialTargetProtection: { targetId: 'enemy-1', durationMs: 200 } } },
    })!;
    runtime.runHostProjectileStage(199, 1199);
    runtime.runHostInteractionStage(1199);
    expect(hit).not.toHaveBeenCalled();
    runtime.runHostProjectileStage(1, 1200);
    runtime.runHostInteractionStage(1200);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(hit.mock.calls[0][0]).toMatchObject({ projectileId: id, provenance: { lineage: { smokeCloudId: 7, smokeKind: 'discharge' } } });
    runtime.runHostInteractionStage(1210);
    expect(hit).toHaveBeenCalledTimes(1);
    runtime.destroy();
  });
  it('does not materialize collision targets when the active projectile view is empty', () => {
    const { runtime } = createRuntimeHarness();
    const readCollisionTargets = vi.fn();
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets });

    runtime.runHostInteractionStage(0);

    expect(readCollisionTargets).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('waits for a post-contact physics confirmation before publishing a stale sprite as bounce travel', () => {
    let now = 0;
    const physics = createTechnicalPhysicsBinding();
    const presentation = createPresentation();
    const runtime = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation,
      identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now });
    runtime.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(runtime));
    const incoming = { x: 1065.9498440288482, y: 621.5250329367449 };
    const center = { x: 1058.6701708697478, y: 608.8430895629104 };
    const stale = { x: 1061.919010796671, y: 615.1345310340141 };
    const velocity = { x: 480.63075655464695, y: -760.9166024300612 };
    const id = runtime.spawnProjectile(baseRequest({ speed: Math.hypot(velocity.x, velocity.y),
      maxBounces: 3, tracerConfig: { profile: 'heavy' } },
    { ...incoming, angle: Math.atan2(velocity.y, -velocity.x) }))!;
    const handle = physics.handles.get(id)!;
    const readPath = () => {
      let path: import('../src/projectile/ProjectileFlightPath').ProjectileFlightPath | undefined;
      runtime.readProjectileReplication(record => { path = record.dynamic.flightPath; });
      return path!;
    };
    now = 5;
    // The sprite still belongs to the incoming frame when the body reports its bounce.
    Object.assign(handle.sprite, stale);
    physics.observe(id, stale.x, stale.y, -velocity.x, velocity.y);
    handle.body.setVelocity(velocity.x, velocity.y);
    physics.emit({ projectileId: id, target: { kind: 'trunk' }, x: 1058, y: 608.6157751049657,
      flightPosition: center, velocityX: velocity.x, velocityY: velocity.y, source: 'physics-collider' });
    const bounced = readPath();
    now = 13;
    runtime.runHostProjectileStage(8, now);
    expect(readPath().points).toEqual(bounced.points);

    // A new worldstep observation is not sufficient while the display anchor is stale.
    physics.observe(id, center.x, center.y, velocity.x, velocity.y);
    runtime.runHostProjectileStage(0, now);
    expect(readPath().points).toEqual(bounced.points);
    Object.assign(handle.sprite, center); // Arcade postUpdate
    runtime.runHostProjectileStage(0, now);
    expect(readPath().points).toEqual(bounced.points); // separation itself is not travel

    now = 21;
    const next = { x: center.x + velocity.x * 0.008, y: center.y + velocity.y * 0.008 };
    physics.observe(id, next.x, next.y, velocity.x, velocity.y);
    Object.assign(handle.sprite, next);
    runtime.runHostProjectileStage(8, now);
    const points = readPath().points;
    expect(points).toHaveLength(3);
    expect(points[2]).toMatchObject(next);
    expect(points[2].y).toBeLessThan(points[1].y);
    const hostFrames = vi.mocked(presentation.syncHostRenderers).mock.calls;
    expect(hostFrames[hostFrames.length - 1][0][0].flightPath?.points).toEqual(points);
    const wire = runtime.getNetSnapshot();
    expect(decodeProjectileDynamics(wire?.u ?? [])[0].flightPath?.points).toEqual(points);
    runtime.destroy();
  });

  it.each(['sweep', 'physics', 'world-boundary'] as const)('publishes one flight pivot for a %s bounce', (mode) => {
    let now = 0;
    const physics = createTechnicalPhysicsBinding();
    const runtime = new WorldProjectileRuntime({ physicsBinding: physics.binding,
      presentation: createPresentation(), identityScope: new ProjectileIdentityScope(1), hostNowMs: () => now });
    const id = runtime.spawnProjectile(baseRequest({ maxBounces: 3, tracerConfig: { profile: 'heavy' }, collisionMode: mode === 'sweep' ? 'sweep' : undefined },
      { x: 0, y: 0, angle: Math.PI / 4 }))!;
    const handle = physics.handles.get(id)!;
    const speed = handle.body.velocity.x;
    now = 20;
    handle.sprite.x = 30; handle.sprite.y = 30;
    physics.observe(id, 30, 30, speed, speed);
    if (mode === 'sweep') {
      vi.mocked(physics.binding.findNearestRockSweep).mockReturnValueOnce({
        rockIndex: 0, x: 20, y: 20, normalX: -1, normalY: 0,
      });
    } else {
      handle.body.setVelocity(-speed, speed);
      physics.emit({ projectileId: id, target: mode === 'physics' ? { kind: 'trunk' } : { kind: 'world-boundary' },
        x: 20, y: 20, flightPosition: { x: 15.5, y: 20 },
        velocityX: -speed, velocityY: speed, source: mode === 'physics' ? 'physics-collider' : 'world-boundary' });
      handle.sprite.x = 15.5; handle.sprite.y = 20;
    }
    runtime.runHostProjectileStage(20, now);
    const readPath = () => {
      let path: import('../src/projectile/ProjectileFlightPath').ProjectileFlightPath | undefined;
      runtime.readProjectileReplication(record => { path = record.dynamic.flightPath; });
      return path!;
    };
    const pivot = readPath().points.at(-1)!;
    expect(readPath().points).toHaveLength(2);
    expect(pivot.x).toBeCloseTo(17.75);
    expect(pivot.y).toBeCloseTo(17.75);
    expect(pivot.bounceSequence).toBe(1);
    now = 30;
    handle.sprite.x -= 10; handle.sprite.y += 10;
    physics.observe(id, handle.sprite.x, handle.sprite.y, handle.body.velocity.x, handle.body.velocity.y);
    runtime.runHostProjectileStage(10, now);
    const points = readPath().points;
    expect(points).toHaveLength(3);
    expect(points[2].x - pivot.x).toBeCloseTo(-(points[2].y - pivot.y));
    runtime.destroy();
  });

  it('publishes a terminal bounce tombstone after the host releases the projectile', () => {
    const physics = createTechnicalPhysicsBinding();
    const runtime = new WorldProjectileRuntime({
      physicsBinding: physics.binding,
      presentation: createPresentation(),
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 1_000,
    });
    runtime.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(runtime));
    const id = runtime.spawnProjectile(baseRequest({ maxBounces: 0 }))!;
    physics.emit({
      projectileId: id,
      target: { kind: 'world-boundary' },
      x: 37.25,
      y: 48.5,
      velocityX: -100,
      velocityY: 0,
      source: 'world-boundary',
    });
    runtime.destroyProjectile(id);

    const snapshot = runtime.getNetSnapshot();
    expect(snapshot).not.toBeNull();
    expect(decodeProjectileStatics(snapshot?.s ?? [])).toMatchObject([{ id }]);
    expect(decodeProjectileDynamics(snapshot?.u ?? [])[0]?.bounce).toMatchObject({
      sequence: 1, x: 37.25, y: 48.5,
    });
    runtime.destroy();
  });

  it('publishes multiple host bounces in order instead of keeping only the last one', () => {
    const physics = createTechnicalPhysicsBinding();
    const runtime = new WorldProjectileRuntime({
      physicsBinding: physics.binding,
      presentation: createPresentation(),
      identityScope: new ProjectileIdentityScope(1),
      hostNowMs: () => 1_000,
    });
    runtime.setProjectileReplicationAdapter(new ProjectileReplicationAdapter(runtime));
    const id = runtime.spawnProjectile(baseRequest({ maxBounces: 4 }))!;
    physics.emit({ projectileId: id, target: { kind: 'world-boundary' }, x: 37.25, y: 48.5, velocityX: -100, velocityY: 0, source: 'world-boundary' });
    physics.emit({ projectileId: id, target: { kind: 'world-boundary' }, x: 18.75, y: 48.5, velocityX: 100, velocityY: 0, source: 'world-boundary' });

    const snapshot = runtime.getNetSnapshot();
    expect(decodeProjectileDynamics(snapshot?.u ?? [])[0]?.bounceOutcomes).toEqual([
      { sequence: 1, x: 37.25, y: 48.5, vx: 100, vy: 0, tracerBounce: true },
      { sequence: 2, x: 18.75, y: 48.5, vx: 100, vy: 0, tracerBounce: true },
    ]);
    runtime.destroy();
  });

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
      primaryHitReward: createPrimaryHitRewardIntent('plasma', { playerId: 'credit', multiplier: 2 }, 4),
    };
    runtime.applyPlasmaSwarmImpact({
      projectileId: 12, provenance, enemyId: 'enemy-origin', x: 0, y: 0,
      projectileCount: 2, normalDamage: 10, normalSize: 8, normalSpeed: 100, normalRange: 100,
      explosionRadius: 10, explosionDamage: 5, explosionSlowFraction: 0, color: 0xffffff,
    });
    expect(runtime.getThreatSamples()).toHaveLength(2);
    for (const child of runtime.getThreatSamples()) {
      expect(child.provenance.primaryHitReward).toBeUndefined();
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

  it('aborts finalization when a terminal outcome tears down a world with multiple projectiles', () => {
    const { runtime, physics } = createRuntimeHarness();
    const ids = [runtime.spawnProjectile(baseRequest())!, runtime.spawnProjectile(baseRequest())!];
    runtime.setProjectileResolvedCallback(() => runtime.destroy());
    expect(() => runtime.runHostProjectileStage(1_001, 2_001)).not.toThrow();
    expect([...physics.released].sort()).toEqual(ids);
    expect(runtime.activeCount).toBe(0);
  });

  it('keeps a reentrant replacement registered when a terminal callback removes a sibling', () => {
    const { runtime, physics } = createRuntimeHarness();
    const sibling = runtime.spawnProjectile(baseRequest())!;
    const terminal = runtime.spawnProjectile(baseRequest())!;
    let replacement: number | null = null;
    runtime.setProjectileResolvedCallback((outcome) => {
      if (outcome.projectileId !== terminal) return;
      runtime.destroyProjectile(sibling);
      replacement = runtime.spawnProjectile(baseRequest());
    });
    runtime.destroyProjectile(terminal);
    expect(runtime.activeCount).toBe(1);
    runtime.runHostProjectileStage(1_001, 2_001);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toContain(replacement);
    runtime.destroy();
  });

  it('rejects external detonation after a contact has already consumed the projectile', () => {
    const { runtime, physics } = createRuntimeHarness();
    const id = runtime.spawnProjectile(baseRequest({
      explosion: baseExplosion(),
      detonable: { tag: 'orb', allowCrossTeam: true, aoeDamage: 12, aoeRadius: 24 },
    }))!;
    physics.emit({ projectileId: id, target: { kind: 'world-boundary' },
      x: 0, y: 0, velocityX: 100, velocityY: 0, source: 'world-boundary' });
    expect(runtime.activeCount).toBe(0);
    expect(runtime.detonateProjectile(id, 'detonator')).toBeNull();
    expect(runtime.runHostProjectileStage(16, 1_016).projectileExplosions).toHaveLength(1);
    expect(physics.released).toEqual([id]);
    runtime.destroy();
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
    let adapted: ReturnType<typeof adaptProjectileDirectDamageRequest> | undefined;
    const resolveDirectImpact = configureEnemyImpact(runtime, vi.fn((request: ProjectileDirectImpactRequest) => {
      adapted = adaptProjectileDirectDamageRequest(
        request,
        `authored:${request.projectileId}:${request.target.id}`,
        { worldRevision: 7, runtimeGeneration: 2 },
        { entityGeneration: 1, activityRevision: 3 },
        { gameplaySourceKind: 'player', attributionKind: 'player' },
      );
      return { accepted: true };
    }));

    const id = runtime.spawnProjectile(baseRequest({ collisionMode: 'overlap' }))!;
    runtime.runHostInteractionStage(1_000);

    expect(resolveDirectImpact).toHaveBeenCalledWith(expect.objectContaining({
      projectileId: id,
      target: { kind: 'enemy', id: 'enemy-1' },
      directHit: expect.objectContaining({ damage: 10 }),
    }));
    expect(adapted?.basis).toEqual({ kind: 'authored', amount: 10 });
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toHaveLength(1);
    runtime.destroy();
  });

  it('preserves an applied automatic source factor through spawn, runtime record and direct impact', () => {
    const { runtime } = createRuntimeHarness();
    let adapted: ReturnType<typeof adaptProjectileDirectDamageRequest> | undefined;
    configureEnemyImpact(runtime, vi.fn((request: ProjectileDirectImpactRequest) => {
      adapted = adaptProjectileDirectDamageRequest(
        request,
        `automatic:${request.projectileId}:${request.target.id}`,
        { worldRevision: 7, runtimeGeneration: 2 },
        { entityGeneration: 1, activityRevision: 3 },
        { gameplaySourceKind: 'player', attributionKind: 'player' },
      );
      return { accepted: true };
    }));
    const sharedExecution = new WorldWeaponExecutionRuntime({
      projectileSpawn: runtime,
      combatSystem: {
        resolveSafeHitscanStart: vi.fn((_shooterX, _shooterY, startX, startY) => ({ x: startX, y: startY })),
        resolveImmediateAttack: vi.fn(() => ({ accepted: true })),
      },
    });
    const automated = new AutomatedWeaponExecutionAdapter(sharedExecution, runtime);
    const authoredConfig = {
      ...WEAPON_CONFIGS.TURRET_ROCKET_BURST,
      damage: 10,
      directDamageOverride: undefined,
    };

    expect(automated.fire(authoredConfig, {
      x: 0, y: 0, angle: 0, targetX: 100, targetY: 0,
      ownerId: 'owner', ownerColor: 0xffffff,
      options: { directDamageMultiplier: 2, sourceSlot: 'utility' },
    })).toBe(true);

    runtime.runHostInteractionStage(1_000);

    expect(adapted?.basis).toEqual({
      kind: 'source-resolved',
      amount: 20,
      sourceFactors: [{ kind: 'automated-source', multiplier: 2, resolvedAt: 'execution' }],
    });
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
