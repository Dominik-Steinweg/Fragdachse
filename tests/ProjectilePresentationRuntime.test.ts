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

    expect(muzzleFlash.playProjectileFlash).toHaveBeenCalledTimes(1);
    expect(audio.playSound).not.toHaveBeenCalled();
  });
});
