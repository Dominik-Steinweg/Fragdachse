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
    updateTracer: vi.fn(),
    notifyBounce: vi.fn(),
    destroyTracer: vi.fn(),
  };
}

describe('ProjectilePresentationRuntime', () => {
  it('does not replay predicted local projectile audio on snapshot presentation', () => {
    const muzzleFlash = { playProjectileFlash: vi.fn() };
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
    expect(audio.playSound).not.toHaveBeenCalled();
    expect(renderers.destroyVisual).toHaveBeenCalledWith(7);
    expect(renderers.destroyTracer).toHaveBeenCalledWith(7);
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
    expect(renderers.notifyBounce).toHaveBeenCalledTimes(1);
    expect(renderers.notifyBounce).toHaveBeenCalledWith(7, 123.25, 198.5);
  });
});
