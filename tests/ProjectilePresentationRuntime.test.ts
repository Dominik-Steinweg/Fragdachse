import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import { ProjectileClientReplica } from '../src/projectile/ProjectileClientReplica';
import { ProjectilePresentationRuntime } from '../src/projectile/ProjectilePresentationRuntime';
import type { SyncedProjectile } from '../src/types';

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
    destroyVisual: vi.fn(),
    destroyAll: vi.fn(),
    createTracer: vi.fn(),
    addSegment: vi.fn(),
    destroyTracer: vi.fn(),
  };
}

describe('ProjectilePresentationRuntime', () => {
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
