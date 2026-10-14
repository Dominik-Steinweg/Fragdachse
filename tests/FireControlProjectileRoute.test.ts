import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
  Geom: {
    Line: class { constructor(public x1 = 0, public y1 = 0, public x2 = 0, public y2 = 0) {} },
    Rectangle: class {
      constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
    },
    Intersects: { LineToRectangle: () => false, RectangleToRectangle: () => false },
  },
}));

import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import type { ProjectileDirectImpactRequest } from '../src/projectile/ProjectileCombatPort';
import type { ProjectileReplicationRecord } from '../src/projectile/ProjectileReplicationAdapter';
import type { ProjectileFireControlRoute, ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';
import { WeaponFireExecutor, type WeaponFireSink } from '../src/loadout/WeaponFireExecutor';
import { AutomatedWeaponExecutionAdapter } from '../src/world/AutomatedWeaponExecutionAdapter';
import { SpecializedWeaponExecutionAdapter } from '../src/world/SpecializedWeaponExecutionAdapter';
import { createPresentation, createTechnicalPhysicsBinding } from './ProjectileRuntimeTestHelper';

function createHarness() {
  const physics = createTechnicalPhysicsBinding();
  const runtime = new WorldProjectileRuntime({ physicsBinding: physics.binding, presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(1), hostNowMs: () => 1_000 });
  return { runtime, physics };
}

const route = (overrides: Partial<ProjectileFireControlRoute> = {}): ProjectileFireControlRoute => ({
  contributionId: 'fc:7', ownerId: 'owner', entry: { x: 20, y: 0 }, exit: { x: 500, y: 0 }, damageBonus: 0.5,
  ...overrides,
});

function shot(options: {
  route?: ProjectileFireControlRoute; angle?: number; damage?: number; lifetimeMs?: number; rangePx?: number;
  explosion?: ProjectileSpawnRequest['interaction']['explosion']; burn?: boolean; tracer?: boolean;
  isFlame?: boolean; portalDamage?: ProjectileSpawnRequest['provenance']['portalDamage'];
} = {}): ProjectileSpawnRequest {
  return {
    fireControlRoute: options.route,
    origin: { x: 0, y: 0, angle: options.angle ?? 0 },
    provenance: { gameplaySourceId: 'owner', attributionId: 'owner', allegiance: { ownerId: 'owner' },
      sourceTurretId: 'turret-1', portalDamage: options.portalDamage },
    flight: { speed: 100, size: 8, lifetimeMs: options.lifetimeMs ?? 5_000, maxBounces: 0, isGrenade: false,
      collisionMode: options.isFlame ? 'overlap' : 'sweep', isFlame: options.isFlame,
      remainingRangePx: options.rangePx ?? 400 },
    interaction: {
      directHit: { damage: options.damage ?? 10 },
      explosion: options.explosion,
      burn: options.burn ? { durationMs: 300, damagePerTick: 4 } : undefined,
    },
    presentation: { color: 1, style: options.isFlame ? 'flame' : 'bullet',
      tracer: options.tracer ? { profile: 'prismatic' } : undefined },
  };
}

function captureImpacts(runtime: WorldProjectileRuntime, targetX: number, targetY = 0) {
  const impacts: ProjectileDirectImpactRequest[] = [];
  runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink =>
    sink('enemy', 'enemy', 'enemy-owner', targetX, targetY, 8, targetX - 8, targetY - 8, targetX + 8, targetY + 8) });
  runtime.setProjectileTargetabilityPort({ canDamage: () => true, canDamageOwner: () => true,
    isTargetCurrentlyValid: () => true });
  runtime.setProjectileCombatPort({
    resolveDirectImpact: request => { impacts.push(request); return { accepted: true }; },
    resolveExplosionCombat: vi.fn(() => ({ damagedTargetKeys: [] })),
  });
  return impacts;
}

function replication(runtime: WorldProjectileRuntime): ProjectileReplicationRecord[] {
  const records: ProjectileReplicationRecord[] = [];
  runtime.readProjectileReplication(record => records.push(record));
  return records;
}

const configOfType = (type: WeaponConfig['fire']['type']): WeaponConfig =>
  Object.values(WEAPON_CONFIGS).find(config => config.fire.type === type)!;

/**
 * D52: routed shots first really fly along their fire direction to the muzzle portal; the host
 * portal stage moves them to the exit once they reached it. Moves each shot to `x` on its line.
 */
function flyToEntry(runtime: WorldProjectileRuntime, physics: ReturnType<typeof createTechnicalPhysicsBinding>,
  ids: readonly number[], x = 40): void {
  for (const id of ids) physics.handles.get(id)!.sprite.x = x;
  runtime.runHostPortalStage(1_000);
}

describe('fire-control route: real flight into the muzzle portal (D52)', () => {
  it('flies the real stretch untouched and unguided, then jumps on reaching the entry', () => {
    const { runtime, physics } = createHarness();
    const impacts = captureImpacts(runtime, 10); // An enemy right in front of the muzzle.
    const id = runtime.spawnProjectile(shot({ route: route() }))!;
    const handle = physics.handles.get(id)!;
    expect(handle.sprite.x).toBe(0);
    expect(replication(runtime)[0].dynamic).toMatchObject({ x: 0, y: 0 });
    handle.sprite.x = 12; runtime.runHostPortalStage(1_000); runtime.runHostInteractionStage(1_000);
    expect(impacts).toHaveLength(0);
    expect(handle.sprite.x).toBe(12); // Not yet at the entry: still on its own side.
    handle.sprite.x = 26; runtime.runHostPortalStage(1_016);
    expect(handle.sprite.x).toBe(506); // 6 px past the entry continue from the exit.
    runtime.destroy();
  });

  it('flies flames too; flame emitters jump at once', () => {
    const { runtime, physics } = createHarness();
    const flame = runtime.spawnProjectile(shot({ isFlame: true, route: route() }))!;
    expect(physics.handles.get(flame)!.sprite.x).toBe(0);
    flyToEntry(runtime, physics, [flame], 20);
    expect(physics.handles.get(flame)!.sprite.x).toBe(500);
    const emitter = runtime.spawnProjectile({ ...shot({ route: route(), damage: 0 }),
      flameEmission: { intervalMs: 100, angularSpeedRadiansPerSecond: 0, flame: shot({ isFlame: true }) } })!;
    expect(physics.handles.get(emitter)!.sprite.x).toBe(500);
    runtime.destroy();
  });

  it('leaves no burning ground when a flame dies on its way into the portal', () => {
    const { runtime } = createHarness();
    const expiry = vi.fn();
    runtime.setNaturalFlameExpiryCallback(expiry);
    const request = shot({ isFlame: true, route: route(), lifetimeMs: 50 });
    runtime.spawnProjectile({ ...request, flameExpiryGround: { durationMs: 1234,
      burn: { durationMs: 1000, damagePerTick: 2 }, baseDamageMult: 1, igniteProjectiles: false } });
    runtime.runHostProjectileStage(60, 1_060);
    expect(expiry).toHaveBeenCalledTimes(1);
    expect(expiry.mock.calls[0][0].flameExpiryGround).toBeUndefined();
    runtime.destroy();
  });
});

describe('fire-control route: one-way transfer', () => {
  it('keeps the heading and lifetime, counts only the muzzle prefix against range and spends the route', () => {
    const { runtime, physics } = createHarness();
    const angle = 0.4, dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const exit = { x: 600, y: 300 };
    const id = runtime.spawnProjectile(shot({ angle, lifetimeMs: 100,
      route: route({ entry: { x: dir.x * 30, y: dir.y * 30 }, exit }) }))!;
    const handle = physics.handles.get(id)!;
    handle.sprite.x = dir.x * 30; handle.sprite.y = dir.y * 30; runtime.runHostPortalStage(1_000);
    expect(handle.sprite.x).toBeCloseTo(exit.x);
    expect(handle.sprite.y).toBeCloseTo(exit.y);
    expect(Math.atan2(handle.body.velocity.y, handle.body.velocity.x)).toBeCloseTo(angle);
    expect(Math.hypot(handle.body.velocity.x, handle.body.velocity.y)).toBeCloseTo(100);
    expect(replication(runtime)[0].createdAt).toBe(1_000);
    runtime.runHostProjectileStage(60, 1_060);
    expect(runtime.activeCount).toBe(1);
    runtime.runHostProjectileStage(41, 1_101);
    expect(runtime.activeCount).toBe(0);

    const ranged = runtime.spawnProjectile(shot({ route: route() }))!;
    const body = physics.handles.get(ranged)!;
    flyToEntry(runtime, physics, [ranged], 20);
    body.sprite.x = 500 + 379; runtime.runHostProjectileStage(10, 1_110);
    expect(runtime.activeCount).toBe(1);
    body.sprite.x += 1; runtime.runHostProjectileStage(10, 1_120);
    expect(runtime.activeCount).toBe(0); // 400 range - 20 prefix: the 480 px jump is free.
    runtime.destroy();
  });

  it('preserves the lateral muzzle offset relative to the entry at the exit', () => {
    const { runtime, physics } = createHarness();
    const id = runtime.spawnProjectile({ ...shot({ route: route({ entry: { x: 20, y: -3 } }) }),
      origin: { x: 0, y: 4, angle: 0 } })!;
    flyToEntry(runtime, physics, [id], 20);
    expect(physics.handles.get(id)!.sprite).toMatchObject({ x: 500, y: 7 });
    runtime.destroy();
  });

  it('adds the bonus once per contribution id, for every shot of the deployment', () => {
    const { runtime, physics } = createHarness();
    const impacts = captureImpacts(runtime, 530);
    const ids = [
      runtime.spawnProjectile(shot({ route: route() }))!,
      runtime.spawnProjectile(shot({ route: route({ entry: { x: 25, y: 0 } }) }))!,
      // Already carries this deployment's contribution, as an inheriting child would.
      runtime.spawnProjectile(shot({ route: route(), damage: 15, portalDamage: [{ pairId: 'fc:7', bonus: 0.5 }] }))!,
    ];
    flyToEntry(runtime, physics, ids);
    for (const id of ids) physics.handles.get(id)!.sprite.x = 560;
    runtime.runHostInteractionStage(1_000);
    expect(impacts.map(impact => impact.directHit.damage)).toEqual([15, 15, 15]);
    for (const impact of impacts) expect(impact.provenance.portalDamage).toEqual([{ pairId: 'fc:7', bonus: 0.5 }]);
    runtime.destroy();
  });

  it('scales direct hit, burn and explosion exactly once', () => {
    const { runtime, physics } = createHarness();
    const impacts = captureImpacts(runtime, 530);
    const explosion = { radius: 24, maxDamage: 20, minDamage: 6, knockback: 300, selfDamageMult: 0 };
    const id = runtime.spawnProjectile(shot({ route: route(), burn: true, explosion }))!;
    flyToEntry(runtime, physics, [id]);
    physics.handles.get(id)!.sprite.x = 560;
    runtime.runHostInteractionStage(1_000);
    const stage = runtime.runHostProjectileStage(10, 1_010);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].directHit.damage).toBe(15);
    expect(impacts[0].augments).toContainEqual(expect.objectContaining({ burn: { durationMs: 300, damagePerTick: 6 } }));
    expect(stage.projectileExplosions).toHaveLength(1);
    expect(stage.projectileExplosions[0].effect).toMatchObject({ maxDamage: 30, minDamage: 9, knockback: 300 });
    runtime.destroy();
  });

  it('keeps damage-free control shots damage-free', () => {
    const { runtime, physics } = createHarness();
    const impacts = captureImpacts(runtime, 530);
    const explosion = { radius: 24, maxDamage: 0, knockback: 300, selfDamageMult: 0 };
    const id = runtime.spawnProjectile(shot({ route: route(), damage: 0, explosion }))!;
    flyToEntry(runtime, physics, [id]);
    physics.handles.get(id)!.sprite.x = 560;
    runtime.runHostInteractionStage(1_000);
    const stage = runtime.runHostProjectileStage(10, 1_010);
    expect(impacts.map(impact => impact.directHit.damage)).toEqual([0]);
    expect(stage.projectileExplosions[0].effect).toMatchObject({ maxDamage: 0, knockback: 300 });
    runtime.destroy();
  });

  it('starts fireball emission at the exit; inheriting flames are scaled once and never re-routed', () => {
    const { runtime, physics } = createHarness();
    const impacts = captureImpacts(runtime, 530);
    const flame = shot({ isFlame: true, damage: 8 });
    const parent = runtime.spawnProjectile({ ...shot({ route: route(), damage: 0 }),
      flameEmission: { intervalMs: 100, angularSpeedRadiansPerSecond: 0, flame } })!;
    expect(physics.specs).toHaveLength(2);
    const child = physics.specs[1];
    expect(child).toMatchObject({ x: 500, y: 0 });
    expect(replication(runtime).find(record => record.id === child.id)?.static.flameStreamKey).toBe(`fireball:${parent}`);
    physics.handles.get(parent)!.sprite.x = 460; // Parent stays clear of the target.
    physics.handles.get(child.id)!.sprite.x = 540;
    runtime.runHostInteractionStage(1_000);
    const flameHit = impacts.find(impact => impact.projectileId === child.id)!;
    expect(flameHit.directHit.damage).toBe(12);
    expect(flameHit.provenance.portalDamage).toEqual([{ pairId: 'fc:7', bonus: 0.5 }]);
    runtime.destroy();
  });

  it('passes the acquired context to split children without a second bonus', () => {
    const { runtime, physics } = createHarness();
    const request = shot({ route: route() });
    const parent = runtime.spawnProjectile({ ...request,
      flight: { ...request.flight, maxBounces: 2, split: { count: 2, spread: 0, speedFactor: 1 } },
      interaction: { ...request.interaction, burn: { canReceiveFireImbue: true } } })!;
    flyToEntry(runtime, physics, [parent], 20);
    physics.emit({ projectileId: parent, target: { kind: 'world-boundary' }, x: 550, y: 0,
      velocityX: 100, velocityY: 0, source: 'world-boundary' });
    runtime.runHostInteractionStage(1_000); runtime.runHostInteractionStage(1_016);
    const children = runtime.getTravelSamples();
    expect(children).toHaveLength(2);
    const impacts = captureImpacts(runtime, 580);
    for (const child of children) physics.handles.get(child.projectileId)!.sprite.x = 600;
    runtime.runHostInteractionStage(1_032);
    expect(impacts.map(impact => impact.directHit.damage)).toEqual([7.5, 7.5]);
    for (const impact of impacts) expect(impact.provenance.portalDamage).toEqual([{ pairId: 'fc:7', bonus: 0.5 }]);
    runtime.destroy();
  });

  it('separates the flame stream of routed shots from local flames of the same source', () => {
    const { runtime } = createHarness();
    const local = runtime.spawnProjectile(shot({ isFlame: true }))!;
    const routed = runtime.spawnProjectile(shot({ isFlame: true, route: route() }))!;
    const keys = new Map(replication(runtime).map(record => [record.id, record.static.flameStreamKey]));
    expect(keys.get(local)).toBeUndefined(); // Renderer falls back to the turret id.
    expect(keys.get(routed)).toBe('turret-1@fc:7');
    runtime.destroy();
  });

  it('separates original and copy flame streams, with custom keys and portal contributions', () => {
    const { runtime } = createHarness();
    for (const routed of [false, true]) for (const visualId of [undefined, 'turret-1', 'fc-copy:1:0', 'fc-copy:1:1']) {
      const request = shot({ isFlame: true, route: routed ? route() : undefined });
      runtime.spawnProjectile({ ...request, presentation: { ...request.presentation,
        turretVisualId: visualId, flameStreamKey: 'custom' } });
    }
    const records = replication(runtime);
    const keys = records.map(record => record.static.flameStreamKey);
    expect(new Set(keys).size).toBe(8);
    expect(keys).toEqual(['custom', 'custom#turret-1', 'custom#fc-copy:1:0', 'custom#fc-copy:1:1',
      'custom@fc:7', 'custom#turret-1@fc:7', 'custom#fc-copy:1:0@fc:7', 'custom#fc-copy:1:1@fc:7']);
    for (const record of records) expect(record.static.sourceTurretId).toBe('turret-1');
    runtime.destroy();
  });

  it('breaks the flight path at the jump; dead-reckoned shots replicate the real stretch, then the exit', () => {
    const { runtime, physics } = createHarness();
    const traced = runtime.spawnProjectile(shot({ route: route(), tracer: true }))!;
    const plain = runtime.spawnProjectile(shot({ route: route() }))!;
    expect(replication(runtime).find(record => record.id === plain)!.dynamic).toMatchObject({ x: 0, y: 0 });
    flyToEntry(runtime, physics, [traced, plain], 20);
    const records = new Map(replication(runtime).map(record => [record.id, record]));
    const points = records.get(traced)!.dynamic.flightPath!.points;
    expect(points.map(point => [point.x, point.breakBefore === true])).toEqual([[0, true], [20, false], [500, true]]);
    expect(records.get(plain)!.dynamic).toMatchObject({ x: 500, y: 0, flightPath: undefined });
    runtime.destroy();
  });

  it('leaves later Translocator passes to their own additive rule', () => {
    const { runtime, physics } = createHarness();
    runtime.setPortalQueryPort({ getPortalPairs: () => [{ id: 'pair', ownerId: 'owner',
      a: { x: 600, y: 0 }, b: { x: 900, y: 0 }, radius: 16, reentryDistance: 48,
      damageBonus: 0.6, createdAt: 0, expiresAt: 5_000 }], isPortalFriendly: () => true });
    const impacts = captureImpacts(runtime, 940);
    const id = runtime.spawnProjectile(shot({ route: route() }))!;
    flyToEntry(runtime, physics, [id], 20);
    physics.handles.get(id)!.sprite.x = 650;
    runtime.runHostPortalStage(1_000);
    expect(physics.handles.get(id)!.sprite.x).toBe(950);
    runtime.runHostInteractionStage(1_000);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].directHit.damage).toBeCloseTo(10 * (1 + 0.5 + 0.6));
    expect(impacts[0].provenance.portalDamage?.map(entry => entry.pairId)).toEqual(['fc:7', 'pair']);
    runtime.destroy();
  });

  it('rejects foreign, malformed and unreachable routes before anything spawns', () => {
    const { runtime } = createHarness();
    expect(() => runtime.spawnProjectile(shot({ route: route({ ownerId: 'other' }) }))).toThrow(/other/);
    expect(() => runtime.spawnProjectile(shot({ route: route({ damageBonus: -0.1 }) }))).toThrow(/Invalid/);
    expect(() => runtime.spawnProjectile(shot({ route: route({ exit: { x: Number.NaN, y: 0 } }) }))).toThrow(/Invalid/);
    expect(() => runtime.spawnProjectile(shot({ route: route({ entry: { x: 400, y: 0 } }) }))).toThrow(/range/);
    expect(runtime.activeCount).toBe(0);
    runtime.destroy();
  });
});

describe('fire-control route: execution plumbing', () => {
  const options = { fireControlRoute: route(), sourceTurretId: 'turret-1', turretVisualId: 'fc-copy:1:0' };
  const params = { x: 0, y: 0, angle: 0, targetX: 300, targetY: 0, ownerId: 'owner', ownerColor: 1, options };

  function sink(spawned: ProjectileSpawnRequest[] = []): WeaponFireSink {
    return { spawnProjectile: request => { spawned.push(request); return spawned.length; },
      resolveHitscan: vi.fn(() => true), resolveMelee: vi.fn(() => true) };
  }

  it('routes projectile and flamethrower shots; fireball child templates never carry the route', () => {
    const spawned: ProjectileSpawnRequest[] = [];
    new WeaponFireExecutor(sink(spawned)).fire(configOfType('projectile'), params);
    const specialized = new SpecializedWeaponExecutionAdapter(sink(spawned));
    const flamethrower = WEAPON_CONFIGS.FLAMETHROWER;
    if (flamethrower.fire.type !== 'flamethrower') throw new Error('Expected flames');
    specialized.fire(flamethrower, params);
    specialized.fire({ ...flamethrower, fireballFlameConfig: flamethrower,
      fire: { ...flamethrower.fire, fireball: { ...flamethrower.fire.fireball!, enabled: 1 } } }, params);
    expect(spawned).toHaveLength(3);
    for (const request of spawned) {
      expect(request.fireControlRoute).toBe(options.fireControlRoute);
      expect(request.provenance.sourceTurretId).toBe('turret-1');
      expect(request.presentation.turretVisualId).toBe('fc-copy:1:0');
    }
    expect(spawned[2].flameEmission?.flame).not.toHaveProperty('fireControlRoute');
  });

  it('feeds automated turret shots through the runtime transfer', () => {
    const { runtime, physics } = createHarness();
    const target = { spawnProjectile: (request: ProjectileSpawnRequest) => runtime.spawnProjectile(request),
      resolveHitscan: vi.fn(() => true), resolveMelee: vi.fn(() => true) };
    const turret = new AutomatedWeaponExecutionAdapter(new WeaponFireExecutor(target), target);
    const config = Object.values(WEAPON_CONFIGS).find(candidate => candidate.id.startsWith('TURRET_')
      && candidate.fire.type === 'projectile' && (candidate.pelletCount ?? 1) <= 1)!;
    expect(turret.fire(config, params)).toBe(true);
    expect([...physics.handles.values()].map(handle => handle.sprite.x)).toEqual([0]);
    flyToEntry(runtime, physics, [...physics.handles.keys()], 20);
    expect([...physics.handles.values()].map(handle => handle.sprite.x)).toEqual([500]);
    expect(replication(runtime)[0].static).toMatchObject({ sourceTurretId: 'turret-1', turretVisualId: 'fc-copy:1:0' });
    runtime.destroy();
  });

  it.each(['hitscan', 'melee', 'leaf_blower', 'tesla_dome'] as const)('rejects a route for fire type %s visibly', type => {
    const spawned: ProjectileSpawnRequest[] = [];
    const fireSink = sink(spawned);
    const shared = new WeaponFireExecutor(fireSink);
    const automated = new AutomatedWeaponExecutionAdapter(shared, fireSink);
    expect(() => automated.fire(configOfType(type), params)).toThrow(/Fire-control route/);
    expect(() => shared.fire(configOfType(type), params)).toThrow(/Fire-control route/);
    expect(() => new SpecializedWeaponExecutionAdapter(fireSink).fire(configOfType(type), params)).toThrow(/Fire-control route/);
    expect(spawned).toEqual([]);
    expect(fireSink.resolveHitscan).not.toHaveBeenCalled();
    expect(fireSink.resolveMelee).not.toHaveBeenCalled();
  });
});
