import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  BlendModes: {
    NORMAL: 0,
    ADD: 1,
  },
  // Der ProjectilePhysicsBinding legt Scratch-Geometrie schon im Feld-Initialisierer an.
  Geom: {
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
      get centerX() { return this.x + this.width / 2; }
      get centerY() { return this.y + this.height / 2; }
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        return this;
      }
    },
    Line: class {
      constructor(
        public x1: number,
        public y1: number,
        public x2: number,
        public y2: number,
      ) {}
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
    Intersects: {
      GetLineToRectangle: (
        line: { x1: number; y1: number; x2: number; y2: number },
        rect: { left: number; right: number; top: number; bottom: number },
        scratch: Array<{ x: number; y: number }>,
      ) => {
        const dx = line.x2 - line.x1;
        const dy = line.y2 - line.y1;
        let enter = 0;
        let exit = 1;
        for (const [origin, delta, min, max] of [
          [line.x1, dx, rect.left, rect.right],
          [line.y1, dy, rect.top, rect.bottom],
        ] as const) {
          if (delta === 0) {
            if (origin < min || origin > max) return scratch;
            continue;
          }
          let near = (min - origin) / delta;
          let far = (max - origin) / delta;
          if (near > far) [near, far] = [far, near];
          enter = Math.max(enter, near);
          exit = Math.min(exit, far);
          if (enter > exit) return scratch;
        }
        scratch.push({ x: line.x1 + dx * enter, y: line.y1 + dy * enter });
        if (exit > enter) scratch.push({ x: line.x1 + dx * exit, y: line.y1 + dy * exit });
        return scratch;
      },
    },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
      Wrap: (angle: number) => {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
      },
    },
    Easing: {
      Quadratic: {
        Out: (value: number) => value,
      },
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    FloatBetween: (min: number, max: number) => (min + max) / 2,
  },
}));
import * as Phaser from 'phaser';
import { RocketRenderer } from '../../src/effects/RocketRenderer';
import { ProjectilePathRecorder } from '../../src/projectile/ProjectileFlightPath';
import { TracerRenderer } from '../../src/effects/TracerRenderer';
import { decodeProjectileDynamics } from '../../src/network/projectileSnapshotCodec';
import { GpuVfxSystem } from '../../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from '../fakeGpuVfxScene';
import { createProjectileRuntimeTestWorld, projectilePhysicsContact } from '../ProjectileRuntimeTestHelper';
import type { ProjectileSpawnRequest } from '../../src/projectile/ProjectileSpawnRequest';
import { createSingleOwnerProvenance } from '../../src/projectile/ProjectileSpawnRequest';
import type { ProjectileInteractionSpec } from '../../src/projectile/ProjectileSpawnRequest';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';
function makeRequest(overrides: {
  origin?: Partial<ProjectileSpawnRequest['origin']>;
  flight?: Partial<ProjectileSpawnRequest['flight']>;
  interaction?: Partial<ProjectileInteractionSpec>;
  presentation?: Partial<ProjectileSpawnRequest['presentation']>;
  ownerId?: string;
} = {}): ProjectileSpawnRequest {
  const ownerId = overrides.ownerId ?? 'shooter';
  return {
    origin: { x: 10, y: 10, angle: 0, ...overrides.origin },
    flight: { speed: 100, size: 8, lifetimeMs: 2_000, maxBounces: 0, isGrenade: false, ...overrides.flight },
    provenance: createSingleOwnerProvenance(ownerId),
    interaction: { directHit: { damage: 20 }, ...overrides.interaction },
    presentation: { color: 0xffffff, ownerColor: 0xffffff, ...overrides.presentation },
  };
}
function spawnRequest(runtime: WorldProjectileRuntime, overrides: Parameters<typeof makeRequest>[0] = {}): number {
  const id = runtime.spawnProjectile(makeRequest(overrides));
  if (id === null) throw new Error('Expected projectile spawn');
  return id;
}
describe('projectile performance paths', () => {
  it('shares the target snapshot across many simultaneous portal crossings and preserves each real path', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const pairs = Array.from({ length: 8 }, (_, index) => ({ id: `pair-${index}`, ownerId: 'shooter',
      a: { x: 50, y: index * 100 }, b: { x: 500, y: index * 100 },
      radius: 16, reentryDistance: 48, damageBonus: 0.2, createdAt: 0, expiresAt: 2000 }));
    runtime.setPortalQueryPort({ getPortalPairs: () => pairs, isPortalFriendly: () => true });
    let reads = 0;
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      reads++;
      for (let i = 0; i < 2000; i++) sink('enemy', `enemy-${i}`, 'enemy', i * 10, 10000,
        8, i * 10 - 8, 9992, i * 10 + 8, 10008);
    } });
    const ids = Array.from({ length: 1000 }, (_, index) => {
      const id = spawnRequest(runtime, { origin: { x: 0, y: index % pairs.length * 100 },
        flight: { remainingRangePx: 150 }, interaction: { burn: { canReceiveFireImbue: true } } });
      physics.handles.get(id)!.sprite.x = 100;
      return id;
    });
    runtime.runHostPortalStage(1000);
    expect(reads).toBe(1);
    expect(runtime.activeCount).toBe(ids.length);
    for (const id of ids) expect(physics.handles.get(id)!.sprite.x).toBe(550);
    const samples = runtime.getTravelSamples();
    expect(samples).toHaveLength(ids.length * 2);
    expect(samples.every(sample => sample.toX - sample.fromX <= 100)).toBe(true);
    expect(samples.filter(sample => sample.fromX > 100)
      .every(sample => sample.provenance.portalDamage?.length === 1)).toBe(true);
    runtime.destroy();
    expect(runtime.getTravelSamples()).toEqual([]);
  });

  it('bounds collision work with 4000 world targets and 1500 active projectiles regardless of provider order', async () => {
    const medians: number[] = [];
    for (const order of ['ascending', 'descending', 'shuffled'] as const) {
      const { runtime, physics } = createProjectileRuntimeTestWorld();
      const targets = Array.from({ length: 4000 }, (_, index) => ({
        id: String(index).padStart(5, '0'),
        x: (index % 100) * 64,
        y: 1000 + Math.floor(index / 100) * 64,
      }));
      if (order === 'descending') targets.reverse();
      if (order === 'shuffled') {
        let seed = 731;
        for (let index = targets.length - 1; index > 0; index--) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const other = seed % (index + 1);
          [targets[index], targets[other]] = [targets[other], targets[index]];
        }
      }
      let hits = 0;
      runtime.setProjectileCombatPort({
        resolveDirectImpact: () => { hits++; return { accepted: true }; },
        resolveExplosionCombat: () => ({ damagedTargetKeys: [] }),
      });
      runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
        for (const target of targets) {
          sink('base', target.id, 'world', target.x, target.y, 8,
            target.x - 8, target.y - 8, target.x + 8, target.y + 8);
        }
        // A few real piercing contacts prove that candidate processing remains enabled.
        sink('enemy', 'contact', 'enemy', 24, 0, 8, 16, -8, 32, 8);
      } });
      for (let index = 0; index < 1500; index++) {
        const id = spawnRequest(runtime, {
          ownerId: `owner-${index % 8}`,
          origin: { x: 0, y: index * 0.5 },
          flight: { collisionMode: index % 2 === 0 ? 'sweep' : 'overlap', piercesTargets: true },
        });
        physics.handles.get(id)!.sprite.x = 24;
      }
      const samples: number[] = [];
      try {
        for (let frame = 0; frame < 20; frame++) {
          const start = performance.now();
          runtime.runHostInteractionStage(frame * 16);
          const elapsed = performance.now() - start;
          if (frame >= 5) samples.push(elapsed);
          // Let the runner service its RPC outside the measurement even on a regressed stage.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        // 13 swept circles (including the tangent) and 12 overlapping rectangles.
        expect(hits).toBe(25);
        expect(runtime.activeCount).toBe(1500);
        samples.sort((a, b) => a - b);
        medians.push(samples[7]);
      } finally {
        runtime.destroy();
      }
    }
    console.info('Collision stage median ms (ascending, descending, shuffled):', medians);
    // Same fixture: regressed main 1013–1519 ms; candidate-only ordering 468–551 ms.
    // Headless stage budget, not a browser FPS claim. Leaves headroom for shared CI runners.
    expect(Math.max(...medians)).toBeLessThan(900);
  }, 120_000);

  it('retains the confirmed impact endpoint when a swept projectile despawns in the same frame', () => {
    const { runtime, physics, setHostNowMs } = createProjectileRuntimeTestWorld();
    const id = spawnRequest(runtime, { origin: { x: 0, y: 16 },
      flight: { speed: 1000 }, presentation: { style: 'bullet', tracer: { profile: 'heavy' } } });
    setHostNowMs(100);
    physics.observe(id, 100, 16, 1000, 0);
    const sprite = physics.handles.get(id)!.sprite as unknown as { x: number; y: number };
    sprite.x = 100;
    runtime.setRockHitCallback(() => runtime.destroyProjectile(id));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      sink('rock', 0, 'world', 40, 16, 8, 36, 8, 44, 24);
    } });
    // Rock contacts belong to the rectangular body sweep, not the generic target circle.
    vi.mocked(physics.binding.findNearestRockSweep).mockReturnValue({
      rockIndex: 0, x: 36, y: 16, centerX: 32, centerY: 16, normalX: -1, normalY: 0,
    });
    runtime.runHostInteractionStage(100);
    runtime.runHostProjectileStage(0, 100);
    const snapshot = runtime.getNetSnapshot()!;
    expect(runtime.activeCount).toBe(0);
    expect(snapshot.u).toHaveLength(0);
    const path = decodeProjectileDynamics(snapshot.e!)[0].flightPath!;
    expect(path.ended).toBe(true);
    expect(path.points[path.points.length - 1].x).toBeCloseTo(36);
    expect(path.points.every(p => p.x <= 36.000001)).toBe(true);
    runtime.destroy();
    expect(runtime.getNetSnapshot()).toBeNull();
  });

  it('bounds histories and GPU work under sustained projectile load', () => {
    const recorder = new ProjectilePathRecorder();
    const scene = makeFakeGpuVfxScene();
    const gpu = new GpuVfxSystem(scene as never);
    const tracer = new TracerRenderer(scene as never);
    tracer.registerGpuVfx(gpu);
    const ribbonEmission = vi.spyOn(gpu, 'appendFlightRibbon');
    for (let id = 0; id < 1500; id++) {
      recorder.begin(id, 0, id, 1000, 0, 0);
      tracer.createTracer(id, 0, id, { profile: 'heavy' }, 0xffaa00);
      for (let step = 1; step <= 150; step++) {
        recorder.append(id, step * 8, id + Math.sin(step * 0.1), 1000, Math.cos(step * 0.1), step * 8);
      }
      const path = recorder.read(id, 1200)!;
      expect(path.points.length).toBeLessThanOrEqual(128);
      expect(path.points[0].timeMs).toBeGreaterThanOrEqual(200);
      expect(path.points[path.points.length - 1].x).toBe(1200);
      for (let n = path.points.length - 8; n < path.points.length; n++) {
        tracer.addSegment(id, { from: path.points[n - 1], to: path.points[n], ageMs: 1200 - path.points[n].timeMs });
      }
    }
    gpu.update(0);
    const lane = findFakeLane(scene, 'flight-signature');
    expect(gpu.getStats()!['flight-signature'].liveCount).toBeGreaterThan(0);
    expect(lane.edited.length).toBeLessThanOrEqual(lane.size);
    const kinds = ribbonEmission.mock.calls.map(call => call[2]);
    const firstWake = kinds.indexOf(true);
    expect(firstWake).toBeGreaterThan(0);
    expect(kinds.slice(firstWake).every(wake => wake)).toBe(true);
    expect(gpu.getStats()!['flight-signature'].liveCount).toBeLessThanOrEqual(lane.size);
    expect(gpu.flightRibbons.handleCount).toBeLessThanOrEqual(1500);
    const versions = [...gpu.flightRibbons.pageVersion];
    gpu.update(0);
    expect([...gpu.flightRibbons.pageVersion]).toEqual(versions);
    tracer.destroyAll(); recorder.clear(); gpu.update(0);
    expect(gpu.getStats()!['flight-signature'].liveCount).toBe(0);
    expect(gpu.flightRibbons.handleCount).toBe(0);
    expect(recorder.read(1, 1200)).toBeUndefined();
  });

  it('damages each obstacle once per flame and scales turret rocks independently', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const hits: Array<{ id: number; damage: number; ownerId: string }> = [];
    runtime.setRockHitCallback((id, damage, ownerId) => hits.push({ id, damage, ownerId }));
    const staticFlame = spawnRequest(runtime, { flight: { isFlame: true, flamePiercing: true }, interaction: { directHit: { damage: 20, rockDamageMult: 0 } } });
    physics.emit(projectilePhysicsContact(staticFlame, { kind: 'rock', id: 0 }));
    physics.emit(projectilePhysicsContact(staticFlame, { kind: 'rock', id: 0 }));
    expect(hits).toEqual([]);
    runtime.setObstacleKindResolver(() => 'turret');
    const turretFlame = spawnRequest(runtime, { flight: { isFlame: true, flamePiercing: true }, interaction: { directHit: { damage: 20, rockDamageMult: 0 } } });
    physics.emit(projectilePhysicsContact(turretFlame, { kind: 'rock', id: 0 }));
    physics.emit(projectilePhysicsContact(turretFlame, { kind: 'rock', id: 0 }));
    expect(hits).toEqual([{ id: 0, damage: 20, ownerId: 'shooter' }]);
    runtime.setObstacleKindResolver(() => undefined);
    const secondFlame = spawnRequest(runtime, { flight: { isFlame: true, flamePiercing: true }, interaction: { directHit: { damage: 20, rockDamageMult: 0.25 } } });
    physics.emit(projectilePhysicsContact(secondFlame, { kind: 'rock', id: 0 }));
    expect(hits[1]).toMatchObject({ id: 0, damage: 5 });
  });
  it('deduplicates multi-cell hostile base contacts and keeps zero rock damage', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const hits: Array<{ baseId: string; damage: number; attackerId: string }> = [];
    runtime.setBaseHitCallback((baseId, damage, attackerId) => hits.push({ baseId, damage, attackerId }));
    const id = spawnRequest(runtime, { flight: { isFlame: true, flamePiercing: true }, interaction: { directHit: { damage: 20, rockDamageMult: 0 } } });
    physics.emit(projectilePhysicsContact(id, { kind: 'base', id: 'enemy-base' }));
    physics.emit(projectilePhysicsContact(id, { kind: 'base', id: 'enemy-base' }));
    expect(hits).toEqual([{ baseId: 'enemy-base', damage: 20, attackerId: 'shooter' }]);
  });
  it('carries supporting-rock exclusion in the physics order and sweep owner', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const id = spawnRequest(runtime, { flight: { collisionFilter: { ignoreRockIndex: 0 }, isFlame: true, flamePiercing: true } });
    expect(physics.specs.find((spec) => spec.id === id)?.mechanics.ignoreRockIndex).toBe(0);
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 0 }));
    expect(runtime.activeCount).toBe(1);
    const sweep = spawnRequest(runtime, { origin: { x: 0, y: 16 }, flight: { collisionMode: 'sweep', collisionFilter: { ignoreRockIndex: 0 } } });
    const sweepSprite = physics.handles.get(sweep)!.sprite as unknown as { x: number; y: number };
    sweepSprite.x = 100; sweepSprite.y = 16;
    runtime.setRockHitCallback((rockId) => { if (rockId === 1) sweepSprite.x = 24; });
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: (sink) => {
      sink('rock', 0, 'world', 24, 16, 8, 20, 8, 28, 24);
      sink('rock', 1, 'world', 64, 16, 8, 60, 8, 68, 24);
    } });
    runtime.runHostInteractionStage(100);
    expect(runtime.activeCount).toBe(2);
  });
  it('releases canonical flame contacts with the world owner', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const id = spawnRequest(runtime, { flight: { isFlame: true, flamePiercing: true } });
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 4 }));
    runtime.destroyProjectile(id);
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 4 }));
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toContain(id);
  });
  it('reuses one shared gpu lane for all rocket smoke puffs', () => {
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new RocketRenderer(scene as never);
    renderer.generateTextures();
    renderer.registerGpuVfx(system);
    const internals = renderer as unknown as { spawnSmokePuff: (x: number, y: number, size: number, color: number) => void };
    internals.spawnSmokePuff(10, 20, 6, 0x123456);
    internals.spawnSmokePuff(30, 40, 28, 0xabcdef);
    const smoke = [findFakeLane(scene, 'rocket-smoke')];
    expect(scene.emitters).toHaveLength(0);
    expect(smoke[0].size).toBe(640);
    expect(smoke[0].members.every((member) => member.frame === 'rocket-smoke')).toBe(true);
    const [small, large] = smoke[0].members;
    const legacyScale = (startScale: number, t: number) => startScale * (1 + t * (2 - t) * 1.3);
    expect(small.scaleX.ease).toBe('Quad.easeOut');
    expect(evaluateFakeAnimation(small.scaleX, 0.5)).toBeCloseTo(legacyScale(0.28, 0.5), 10);
    expect(large.x.base).toBe(30);
    expect(large.y.base).toBe(40);
    expect(large.tint).toBe(0xabcdef);
    expect(evaluateFakeAnimation(small.alpha, 0.5)).toBeCloseTo(0.95 - 0.95 * 0.75, 10);
    expect(small.alpha.duration).toBe(1000);
    expect(small.scaleX.duration).toBe(1000);
    renderer.destroyAll();
    expect(smoke[0].patched).toHaveLength(2);
  });
  it('removes destroyed projectiles centrally through the world owner', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const first = spawnRequest(runtime);
    const second = spawnRequest(runtime);
    runtime.destroyProjectile(first);
    runtime.destroyProjectile(second);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toEqual([first, second]);
    runtime.destroy();
    expect(runtime.spawnProjectile(makeRequest())).toBeNull();
  });
  it.each(['bfg', 'gauss'] as const)('deduplicates repeated rock and train contacts for %s', (style) => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const rockHits: Array<{ id: number; damage: number }> = [];
    const trainHits: number[] = [];
    runtime.setRockHitCallback((id, damage) => rockHits.push({ id, damage }));
    runtime.setTrainImpactPort({ resolveTrainImpact: ({ damage }) => trainHits.push(damage) });
    const id = spawnRequest(runtime, { flight: { collisionMode: 'overlap', isBfg: style === 'bfg', piercesTargets: style === 'gauss' }, interaction: style === 'gauss' ? { directHit: { damage: 20, gaussChain: {} } } : undefined, presentation: { style } });
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 0 }));
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 0 }));
    physics.emit(projectilePhysicsContact(id, { kind: 'train', id: 'main' }));
    physics.emit(projectilePhysicsContact(id, { kind: 'train', id: 'main' }));
    expect(rockHits).toEqual([{ id: 0, damage: 20 }]);
    expect(trainHits).toEqual([20]);
  });
  it('uses host stage timing for fuse and time-bubble flight', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    runtime.setProjectileTimeFieldPort({ getMovementFactor: () => 0.1 });
    const grenade = spawnRequest(runtime, { flight: { isGrenade: true, fuseTimeMs: 300, maxBounces: 0 }, interaction: { grenadeEffect: { type: 'damage', radius: 20, damage: 10 } } });
    runtime.runHostProjectileStage(1_000, 1_000);
    expect(runtime.activeCount).toBe(0);
    expect(physics.released).toContain(grenade);
    const bullet = spawnRequest(runtime, { flight: { lifetimeMs: 100, speed: 100 } });
    runtime.setProjectileTimeFieldPort({ getMovementFactor: () => 0.5 });
    runtime.runHostProjectileStage(100, 100);
    expect(runtime.activeCount).toBe(1);
    expect(physics.handles.get(bullet)!.body.velocity.x).toBe(50);
    runtime.runHostProjectileStage(1_000, 1_100);
    expect(runtime.activeCount).toBe(0);
  });
  it('keeps mini-rocket continuation and explicit return ports on the owner', () => {
    const { runtime, physics } = createProjectileRuntimeTestWorld();
    const outcomes: unknown[] = [];
    runtime.setProjectileMiniRocketStatePort({
      getOwnerPosition: () => ({ x: 0, y: 0 }),
      onOutcome: (outcome) => outcomes.push(outcome),
    });
    const id = spawnRequest(runtime, {
      flight: { speed: 100, remainingRangePx: 100, homing: { acquireDelayMs: 0, searchRadius: 300, retargetIntervalMs: 1, maxTurnDegreesPerStep: 90 }, miniRocket: { stageRangePx: 100, returnEnabled: true, pickupRadius: 32 } },
      interaction: { explosion: { radius: 40, maxDamage: 20, minDamage: 10, knockback: 0, selfDamageMult: 0, damageTarget: 'enemies' } },
    });
    physics.emit(projectilePhysicsContact(id, { kind: 'rock', id: 0 }));
    const firstStage = runtime.runHostProjectileStage(0, 0);
    expect(firstStage.projectileExplosions).toHaveLength(1);
    runtime.completeProjectileExplosion(id, { damagedTargetKeys: [] });
    runtime.runHostProjectileStage(0, 1);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'mini-rocket-collected', projectileId: id, collectorId: 'shooter' });
    expect(runtime.activeCount).toBe(0);
  });
  it('keeps replication statics, full late join and absent-id cleanup', () => {
    const { runtime } = createProjectileRuntimeTestWorld();
    const id = spawnRequest(runtime, { presentation: { style: 'bullet' } });
    expect(runtime.getNetSnapshot()?.s.length).toBeGreaterThan(0);
    expect(runtime.getNetSnapshot()?.u.length).toBeGreaterThan(0);
    runtime.requestFullNetSnapshot();
    expect(runtime.getNetSnapshot()).toMatchObject({ f: 1 });
    runtime.destroyProjectile(id);
    expect(runtime.getNetSnapshot()).toBeNull();
  });
});
