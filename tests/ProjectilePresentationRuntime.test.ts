import { PROJECTILE_STYLES } from '../src/network/projectileSnapshotCodec';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import { ProjectileClientReplica } from '../src/projectile/ProjectileClientReplica';
import { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';
import type { SyncedProjectile } from '../src/types';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';

function projectile(overrides: Partial<SyncedProjectile> = {}): SyncedProjectile {
  return {
    id: 7,
    ownerId: 'local',
    x: 100,
    y: 200,
    vx: 120,
    vy: 0,
    size: 12,
    color: 0xffcc00,
    style: 'bullet',
    shotAudioKey: 'shot_p90',
    ...overrides,
  };
}

function passiveRenderer(): Record<string, unknown> {
  return {
    has: () => true,
    getActiveIds: () => [],
    createVisual: vi.fn(),
    updateVisual: vi.fn(),
    updatePosition: vi.fn(),
    syncToBody: vi.fn(),
    playImpactSparks: vi.fn(),
    playImpact: vi.fn(), sync: vi.fn(), retain: vi.fn(),
    destroyVisual: vi.fn(),
    destroyAll: vi.fn(),
    createTracer: vi.fn(),
    addSegment: vi.fn(),
    destroyTracer: vi.fn(),
  };
}

describe('ProjectilePresentationRuntime', () => {
  it.each([...PROJECTILE_STYLES, undefined])('samples host %s fog without requiring replicated flight history', style => {
    const runtime = new ProjectilePresentationRuntime({} as never), sink = vi.fn();
    const release = runtime.bindGroundFogSegments(sink);
    const shot = projectile({ style, vx: 480, weaponSourceId: 'BFG' });
    runtime.syncHostRenderers([shot], 1000);
    runtime.syncHostRenderers([{ ...shot, x: 108, size: 24 }], 1016);
    expect(sink).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      from: expect.objectContaining({ x: 100 }), to: expect.objectContaining({ x: 108 }), ageMs: 0,
    }), 24, style ?? 'bullet', shot.id, 'BFG');
    runtime.syncHostRenderers([{ ...shot, x: 108 }], 1032);
    expect(sink).toHaveBeenCalledTimes(1);
    runtime.syncHostRenderers([{ ...shot, x: 2000 }], 1048);
    runtime.syncHostRenderers([{ ...shot, x: 2008 }], 1064);
    expect(sink).toHaveBeenCalledTimes(2);
    expect(sink.mock.lastCall![0].from).toMatchObject({ x: 2000, breakBefore: true });
    runtime.destroyProjectileVisuals({ ...shot, x: 2008 });
    runtime.syncHostRenderers([shot], 1080);
    runtime.syncHostRenderers([{ ...shot, x: 108 }], 2000);
    expect(sink).toHaveBeenCalledTimes(2);
    release(); runtime.syncHostRenderers([{ ...shot, x: 116 }], 2016);
    runtime.bindGroundFogSegments(sink); runtime.syncHostRenderers([{ ...shot, x: 124 }], 2032);
    expect(sink).toHaveBeenCalledTimes(2);
    runtime.releaseWorldPresentation();
  });
  it.each(PROJECTILE_STYLES)('samples client %s fog from displayed poses without flight history', style => {
    const shape = { setDepth: vi.fn().mockReturnThis(), setPosition: vi.fn().mockReturnThis(), destroy: vi.fn() };
    const runtime = new ProjectilePresentationRuntime({ add: { circle: () => shape } } as never), replica = new ProjectileClientReplica(), sink = vi.fn();
    const leaf = passiveRenderer();
    runtime.bindRenderers(Object.fromEntries(['bullet', 'projectileBurn', 'flame', 'leafBlower', 'bfg',
      'energyBall', 'hydra', 'gauss', 'holyGrenade', 'rocket', 'fireball', 'spore', 'grenade',
      'translocatorPuck', 'teslaBolt', 'tracer'].map(key => [key, leaf])) as never, null);
    runtime.bindGroundFogSegments(sink);
    const shot = projectile({ style, vx: 480, velocityDecay: .5, suppressSpawnFx: true, weaponSourceId: 'BFG' });
    runtime.presentClientFrame(replica.sync([shot], 1000));
    runtime.extrapolateClient(replica, 1000); runtime.extrapolateClient(replica, 1016);
    expect(sink).toHaveBeenCalledOnce();
    const pose = vi.fn(); replica.readExtrapolated(1016, pose);
    expect(sink.mock.lastCall![0].to).toMatchObject({ x: pose.mock.lastCall![0].x, y: pose.mock.lastCall![0].y });
    expect(sink.mock.lastCall!.slice(1)).toEqual([shot.size, style, shot.id, 'BFG']);
    runtime.presentClientFrame(replica.sync([{ ...shot, x: 112, size: 24 }], 1032));
    runtime.extrapolateClient(replica, 1040);
    expect(sink.mock.lastCall![1]).toBe(24);
    runtime.presentClientFrame(replica.sync([], 1048));
    runtime.presentClientFrame(replica.sync([shot], 1064)); runtime.extrapolateClient(replica, 1064);
    expect(sink).toHaveBeenCalledTimes(2);
    runtime.releaseWorldPresentation();
  });
  it('shares confirmed bounce and terminal segments with fog once and releases the world sink', () => {
    const runtime = new ProjectilePresentationRuntime({} as never), sink = vi.fn();
    const release = runtime.bindGroundFogSegments(sink);
    const shot = projectile({ style: 'bfg', weaponSourceId: 'BFG', flightPath: { timeMs: 30, ended: true, points: [
      { sequence: 1, timeMs: 0, x: 0, y: 0, vx: 1000, vy: 0, breakBefore: true },
      { sequence: 2, timeMs: 10, x: 10, y: 0, vx: 0, vy: 1000, bounceSequence: 1 },
      { sequence: 3, timeMs: 20, x: 10, y: 10, vx: 0, vy: 1000 },
      { sequence: 4, timeMs: 25, x: 90, y: 90, vx: 0, vy: 1000, breakBefore: true },
      { sequence: 5, timeMs: 30, x: 90, y: 95, vx: 0, vy: 1000 },
    ] } });
    runtime.presentFinalPath(shot); const count = sink.mock.calls.length;
    expect(sink.mock.calls.every(call => call[3] === shot.id && call[4] === 'BFG')).toBe(true);
    runtime.presentFinalPath(shot); expect(sink).toHaveBeenCalledTimes(count);
    const paths = sink.mock.calls.map(([s]) => [s.from.x, s.from.y, s.to.x, s.to.y]);
    expect(paths).toContainEqual([0, 0, 10, 0]); expect(paths).toContainEqual([10, 0, 10, 10]);
    expect(paths).toContainEqual([90, 90, 90, 95]); expect(paths).not.toContainEqual([10, 10, 90, 90]);
    const next = vi.fn(); runtime.bindGroundFogSegments(next); release();
    runtime.presentFinalPath({ ...shot, id: 8 }); expect(next).toHaveBeenCalled();
    runtime.releaseWorldPresentation(); runtime.presentFinalPath({ ...shot, id: 9 });
    expect(sink).toHaveBeenCalledTimes(count); expect(next).toHaveBeenCalledTimes(count);
  });
  it('feeds Hydra wake with confirmed segments once, including final history', () => {
    const runtime = new ProjectilePresentationRuntime({} as never);
    const tracer = { ...passiveRenderer(), has: () => false };
    runtime.bindRenderers({ tracer } as never, null);
    const shot = projectile({ style: 'hydra', tracer: WEAPON_CONFIGS.HYDRA.tracerConfig,
      flightPath: { timeMs: 120, ended: true, points: [
      { sequence: 1, timeMs: 100, x: 40, y: 80, vx: 100, vy: -100, breakBefore: true },
      { sequence: 2, timeMs: 120, x: 42, y: 78, vx: 100, vy: -100 },
    ] } });
    runtime.presentFinalPath(shot);
    runtime.presentFinalPath(shot);
    expect(tracer.createTracer).toHaveBeenCalledWith(shot.id, shot.x, shot.y, shot.tracer, shot.color);
    expect(tracer.addSegment).toHaveBeenCalledExactlyOnceWith(shot.id, expect.objectContaining({
      from: expect.objectContaining({ x: 40, y: 80 }), to: expect.objectContaining({ x: 42, y: 78 }),
    }), false);
    runtime.releaseWorldPresentation();
  });
  it('presents replicated prism heads and trails without a firing flash and releases them', () => {
    const runtime = new ProjectilePresentationRuntime({} as never);
    const replica = new ProjectileClientReplica();
    const renderer = { ...passiveRenderer(), has: () => false, sync: vi.fn(), retain: vi.fn() };
    const muzzleFlash = { playProjectileFlash: vi.fn(), clear: vi.fn() };
    const renderers = { ...Object.fromEntries(['bullet', 'projectileBurn', 'flame', 'leafBlower', 'bfg',
      'energyBall', 'hydra', 'gauss', 'holyGrenade', 'rocket', 'fireball', 'spore', 'grenade',
      'translocatorPuck', 'teslaBolt', 'tracer'].map(key => [key, renderer])), muzzleFlash };
    runtime.bindRenderers(renderers as never, null);
    const shot = projectile({ size: 3, bulletVisualPreset: 'time_prism', tracer: { profile: 'prismatic' },
      suppressSpawnFx: true, shotAudioKey: undefined });
    runtime.presentClientFrame(replica.sync([shot], 1000));
    expect(renderer.createVisual).toHaveBeenCalledWith(shot.id, shot.x, shot.y, shot.size,
      shot.color, 'time_prism', shot.color);
    expect(renderer.createTracer).toHaveBeenCalledWith(shot.id, shot.x, shot.y, shot.tracer, shot.color);
    expect(muzzleFlash.playProjectileFlash).not.toHaveBeenCalled();
    runtime.releaseWorldPresentation();
    expect(renderer.destroyAll).toHaveBeenCalled();
  });
  it('animates confirmed turret shots but not baselines, refreshes or suppressed spawns', () => {
    const runtime = new ProjectilePresentationRuntime({} as never);
    const replica = new ProjectileClientReplica();
    const turretAnimations = { onShot: vi.fn() };
    const renderer = { ...passiveRenderer(), sync: vi.fn(), retain: vi.fn() };
    const renderers = { ...Object.fromEntries(['bullet', 'projectileBurn', 'flame', 'leafBlower', 'bfg',
      'energyBall', 'hydra', 'gauss', 'holyGrenade', 'rocket', 'fireball', 'spore', 'grenade',
      'translocatorPuck', 'teslaBolt', 'tracer'].map(key => [key, renderer])), turretAnimations };
    runtime.bindRenderers(renderers as never, null);
    const old = projectile({ sourceTurretId: 'base:rocket' });
    runtime.presentClientFrame(replica.sync([old], 1000));
    expect(turretAnimations.onShot).not.toHaveBeenCalled();
    const fresh = projectile({ id: 8, sourceTurretId: 'base:rocket' });
    const batch = [old, fresh, projectile({ id: 9, sourceTurretId: '7', suppressSpawnFx: true })];
    runtime.presentClientFrame(replica.sync(batch, 1050));
    runtime.presentClientFrame(replica.sync(batch, 1100));
    expect(turretAnimations.onShot).toHaveBeenCalledExactlyOnceWith('base:rocket');
    runtime.createSpawnFeedback(10, 0, 0, 0, 0, 0, 'owner', { sourceTurretId: '7', speed: 100 } as never);
    expect(turretAnimations.onShot).toHaveBeenLastCalledWith('7');
    runtime.createSpawnFeedback(11, 0, 0, 0, 0, 0, 'owner', { sourceTurretId: '7', suppressSpawnFx: true } as never);
    expect(turretAnimations.onShot).toHaveBeenCalledTimes(2);
    runtime.releaseWorldPresentation();
    runtime.bindRenderers(renderers as never, null);
    runtime.presentClientFrame(new ProjectileClientReplica().sync([fresh], 2000));
    expect(turretAnimations.onShot).toHaveBeenCalledTimes(2);
  });

  it('buffers heads and trails together and preserves the cursor when terminal history arrives late', () => {
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      const renderer = { ...passiveRenderer(), sync: vi.fn(), retain: vi.fn(), playProjectileFlash: vi.fn() };
      const runtime = new ProjectilePresentationRuntime({} as never);
      const replica = new ProjectileClientReplica();
      runtime.bindRenderers(Object.fromEntries(['bullet', 'projectileBurn', 'flame', 'leafBlower', 'bfg',
        'energyBall', 'hydra', 'gauss', 'holyGrenade', 'rocket', 'fireball', 'spore', 'grenade',
        'translocatorPuck', 'teslaBolt', 'tracer', 'muzzleFlash'].map(key => [key, renderer])) as never, null);
      const path = { timeMs: 100, points: [
        { sequence: 1, timeMs: 0, x: 0, y: 0, vx: 1000, vy: 0, breakBefore: true },
        { sequence: 2, timeMs: 100, x: 100, y: 0, vx: 1000, vy: 0 },
      ] };
      const shot = projectile({ tracer: { profile: 'heavy' }, flightPath: path, suppressSpawnFx: true });
      runtime.presentClientFrame(replica.sync([shot], now));
      expect(renderer.updatePosition).toHaveBeenLastCalledWith(7, 50, 0, 1000, 0);
      expect(renderer.addSegment).toHaveBeenLastCalledWith(7, expect.objectContaining({
        to: expect.objectContaining({ x: 50 }),
      }), false);
      now = 1100;
      runtime.presentClientFrame(replica.sync([], now));
      const calls = (renderer.addSegment as ReturnType<typeof vi.fn>).mock.calls.length;
      const end = { ...shot, flightPath: { timeMs: 120, ended: true, points: [...path.points,
        { sequence: 3, timeMs: 120, x: 120, y: 0, vx: 1000, vy: 0 }] } };
      now = 1120;
      runtime.presentClientFrame(replica.sync([end], now));
      expect(renderer.addSegment).toHaveBeenCalledTimes(calls + 1);
      expect(renderer.addSegment).toHaveBeenLastCalledWith(7, expect.objectContaining({
        from: expect.objectContaining({ x: 100 }), to: expect.objectContaining({ x: 120 }),
      }), false);
      runtime.presentClientFrame(replica.sync([end], now));
      expect(renderer.addSegment).toHaveBeenCalledTimes(calls + 1);
      expect(renderer.updatePosition).toHaveBeenCalledTimes(1);
      runtime.releaseWorldPresentation();
    } finally { clock.mockRestore(); }
  });

  it('does not replay predicted local projectile audio on snapshot presentation', () => {
    const muzzleFlash = { playProjectileFlash: vi.fn(), clear: vi.fn() };
    const projectileBurn = {
      sync: vi.fn(),
      retain: vi.fn(),
      destroyVisual: vi.fn(),
      destroyAll: vi.fn(),
    };
    const runtime = new ProjectilePresentationRuntime({} as never);
    const replica = new ProjectileClientReplica();
    const renderers = passiveRenderer();
    runtime.bindRenderers({
      bullet: renderers,
      projectileBurn,
      flame: renderers,
      leafBlower: renderers,
      bfg: renderers,
      energyBall: renderers,
      hydra: renderers,
      gauss: renderers,
      holyGrenade: renderers,
      rocket: renderers,
      fireball: renderers,
      spore: renderers,
      grenade: renderers,
      translocatorPuck: renderers,
      teslaBolt: renderers,
      tracer: renderers,
      muzzleFlash,
    } as never, null);
    const audio = { playSound: vi.fn() };
    runtime.setAudioSystem(audio as never);

    runtime.presentClientFrame(replica.sync([projectile()], 1_000), 'local');
    runtime.presentClientFrame(replica.sync([projectile({ x: 120 })], 1_100), 'local');
    runtime.presentClientFrame(replica.sync([projectile({ ownerId: 'reflector', ownerColor: 0x123456 })], 1_200), 'local');

    expect(muzzleFlash.playProjectileFlash).toHaveBeenCalledTimes(1);
    expect(muzzleFlash.playProjectileFlash.mock.calls[0][8]).toBe('local');
    expect(audio.playSound).not.toHaveBeenCalled();
    expect(renderers.destroyVisual).toHaveBeenCalledWith(7);
    expect(renderers.destroyTracer).toHaveBeenCalledWith(7);
    runtime.releaseWorldPresentation();
    expect(muzzleFlash.clear).toHaveBeenCalledOnce();
  });

  it('rebuilds a same-ID flame chain when owner, color or source changes', () => {
    const projectileBurn = {
      sync: vi.fn(),
      retain: vi.fn(),
      destroyVisual: vi.fn(),
      destroyAll: vi.fn(),
    };
    const flameIds = new Set<number>();
    const flame = {
      ...passiveRenderer(),
      has: (id: number) => flameIds.has(id),
      createVisual: vi.fn((id: number) => { flameIds.add(id); }),
      destroyVisual: vi.fn((id: number) => { flameIds.delete(id); }),
    };
    const runtime = new ProjectilePresentationRuntime({} as never);
    const replica = new ProjectileClientReplica();
    const renderers = passiveRenderer();
    runtime.bindRenderers({
      bullet: renderers,
      projectileBurn,
      flame,
      leafBlower: renderers,
      bfg: renderers,
      energyBall: renderers,
      hydra: renderers,
      gauss: renderers,
      holyGrenade: renderers,
      rocket: renderers,
      fireball: renderers,
      spore: renderers,
      grenade: renderers,
      translocatorPuck: renderers,
      teslaBolt: renderers,
      tracer: renderers,
    } as never, null);

    runtime.presentClientFrame(replica.sync([projectile({ style: 'flame', sourceTurretId: 'turret-a' })], 1_000));
    runtime.presentClientFrame(replica.sync([projectile({
      style: 'flame', ownerId: 'reflector', color: 0x123456, ownerColor: 0x654321, sourceTurretId: 'turret-b',
    })], 1_100));

    expect(flame.destroyVisual).toHaveBeenCalledWith(7);
    expect(flame.createVisual).toHaveBeenLastCalledWith(7, 100, 200, 12, 0x123456, 'turret-b');
    runtime.presentClientFrame(replica.sync([
      projectile({ style: 'flame', flameStreamKey: 'fireball:1' }),
      projectile({ id: 8, style: 'flame', flameStreamKey: 'fireball:2' }),
    ], 1200));
    expect(flame.createVisual).toHaveBeenCalledWith(7, 100, 200, 12, expect.any(Number), 'fireball:1');
    expect(flame.createVisual).toHaveBeenCalledWith(8, 100, 200, 12, expect.any(Number), 'fireball:2');
  });

  it('presents the authoritative impact point instead of the following snapshot position', () => {
    const projectileBurn = {
      sync: vi.fn(),
      retain: vi.fn(),
      destroyVisual: vi.fn(),
      destroyAll: vi.fn(),
    };
    const runtime = new ProjectilePresentationRuntime({} as never);
    const replica = new ProjectileClientReplica();
    const renderers = passiveRenderer();
    runtime.bindRenderers({
      bullet: renderers,
      projectileBurn,
      flame: renderers,
      leafBlower: renderers,
      bfg: renderers,
      energyBall: renderers,
      hydra: renderers,
      gauss: renderers,
      holyGrenade: renderers,
      rocket: renderers,
      fireball: renderers,
      spore: renderers,
      grenade: renderers,
      translocatorPuck: renderers,
      teslaBolt: renderers,
      tracer: renderers,
    } as never, null);

    runtime.presentClientFrame(replica.sync([projectile()], 1_000), 'local');
    runtime.presentClientFrame(replica.sync([projectile({
      x: 160,
      vx: -120,
      bounce: { sequence: 1, x: 123.25, y: 198.5, vx: -120, vy: 0, tracerBounce: true },
    })], 1_100), 'local');
    runtime.presentClientFrame(replica.sync([projectile({
      x: 172,
      vx: -120,
      bounce: { sequence: 1, x: 123.25, y: 198.5, vx: -120, vy: 0, tracerBounce: true },
    })], 1_200), 'local');

    expect(renderers.playImpactSparks).toHaveBeenCalledTimes(1);
    expect(renderers.playImpactSparks).toHaveBeenCalledWith(7, 123.25, 198.5, -120, 0, 0xffcc00);
  });
});

it.each(['he_cluster_shard', 'he_demolition_shard', 'molotov_void'] as const)('presents confirmed %s and cleans up', grenadeVisualPreset => {
  const runtime = new ProjectilePresentationRuntime({} as never);
  const renderer = { ...passiveRenderer(), has: () => false };
  runtime.bindRenderers({ grenade: renderer } as never, null);
  runtime.presentClientFrame(new ProjectileClientReplica().sync([projectile({ style: 'grenade', grenadeVisualPreset, suppressSpawnFx: true })], 1000));
  expect(renderer.createVisual).toHaveBeenCalledWith(7, 100, 200, 12, grenadeVisualPreset, 0xffcc00);
  runtime.releaseWorldPresentation();
  expect(renderer.destroyAll).toHaveBeenCalledTimes(1);
});
