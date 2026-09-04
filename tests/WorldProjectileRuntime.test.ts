import { describe, expect, it, vi } from 'vitest';

import {
  WorldProjectileRuntime,
  type LegacyProjectileHostSimulation,
  type ProjectileOwnerSeam,
} from '../src/projectile/WorldProjectileRuntime';
import type { ProjectileSpawnConfig, TrackedProjectile } from '../src/types';

function createSimulation() {
  const created: TrackedProjectile[] = [];
  const released: TrackedProjectile[] = [];
  let boundOwner: ProjectileOwnerSeam | null = null;
  const simulation: LegacyProjectileHostSimulation = {
    bindProjectileOwner: (owner) => { boundOwner = owner; },
    createProjectile: (id) => {
      const record = { id, pendingDestroy: false } as unknown as TrackedProjectile;
      created.push(record);
      return record;
    },
    releaseProjectileResources: (record) => { released.push(record); },
    releaseWorldProjectileState: vi.fn(),
  };
  return { simulation, created, released, getBoundOwner: () => boundOwner };
}

function createRuntime() {
  const simulation = createSimulation();
  const runtime = new WorldProjectileRuntime({
    simulation: simulation.simulation,
    hostNowMs: () => 1_000,
  });
  return { runtime, ...simulation };
}

const payload = {} as ProjectileSpawnConfig;

describe('WorldProjectileRuntime – world-owned Projectile-Registry', () => {
  it('vergibt Identity genau einmal und macht jeden Spawn auffindbar', () => {
    const { runtime } = createRuntime();

    const first = runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);
    const second = runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);

    expect(second).not.toBe(first);
    expect(runtime.store.getById(first)?.id).toBe(first);
    expect(runtime.store.getById(second)?.id).toBe(second);
    expect(runtime.activeCount).toBe(2);
  });

  it('entfernt ein Projectile vollständig und bleibt bei Wiederholung wirkungslos', () => {
    const { runtime, released } = createRuntime();
    const id = runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);

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
    runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);
    runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);
    expect(getBoundOwner()).toBe(runtime);

    runtime.destroy();
    runtime.destroy();

    expect(released).toHaveLength(2);
    expect(simulation.releaseWorldProjectileState).toHaveBeenCalledOnce();
    expect(getBoundOwner()).toBeNull();
    expect(runtime.store.stepOrder).toHaveLength(0);
    expect(runtime.activeCount).toBe(0);
  });

  it('taktet den Flight-Core mit der vom Host gelieferten Zeit vor der Legacy-Stufe', () => {
    const projectile = {
      id: 0,
      ownerId: 'owner',
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
    const simulation: LegacyProjectileHostSimulation = {
      bindProjectileOwner: () => {},
      createProjectile: () => projectile,
      releaseProjectileResources: () => {},
      runLegacyProjectileStage: (_deltaMs, nowMs, coreStage) => {
        stageNowMs = nowMs;
        receivedAge = projectile.simulatedAgeMs ?? 0;
        expect(coreStage.lifetimeExpiredIds.has(projectile.id)).toBe(false);
        return { explodedProjectiles: [], explodedGrenades: [], countdownEvents: [] };
      },
      releaseWorldProjectileState: () => {},
    };
    const runtime = new WorldProjectileRuntime({ simulation, hostNowMs: () => 0 });
    runtime.spawnLegacyProjectile(0, 0, 0, 'owner', payload);

    runtime.runHostProjectileStage(100, 1_234);

    expect(stageNowMs).toBe(1_234);
    expect(receivedAge).toBe(100);
  });
});
