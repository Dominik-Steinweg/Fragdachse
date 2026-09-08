import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) },
  Geom: { Line: class {}, Rectangle: class {}, Intersects: {} },
}));
import { createProjectileRuntimeTestWorld, projectilePhysicsContact } from './ProjectileRuntimeTestHelper';
import { heEffect, heRequest } from './HeGrenadeTestHelper';
import type { ProjectileTargetRef } from '../src/projectile/ProjectileTargetPort';

function world(role: (target: ProjectileTargetRef) => 'character' | 'structure' | null = () => null) {
  const f = createProjectileRuntimeTestWorld();
  f.runtime.setProjectileTargetabilityPort({
    canDamage: () => true, canDamageOwner: () => true, isTargetCurrentlyValid: () => true,
    getGrenadeContactRole: (_p, target) => role(target),
  });
  return f;
}

describe('HE world projectile lifecycle', () => {
  it('sweeps enemy characters and emits one primary payload followed by physical, fuse-only children', () => {
    const f = world(target => target.kind === 'enemy' ? 'character' : null);
    f.runtime.setProjectileCollisionTargetQueryPort({
      readCollisionTargets: emit => emit('enemy', 'enemy-1', 'enemy-1', 60, 0, 8, 52, -8, 68, 8),
    });
    const id = f.runtime.spawnProjectile(heRequest())!;
    f.physics.handles.get(id)!.sprite.x = 120;
    f.setHostNowMs(100); f.runtime.runHostInteractionStage(100);
    const primary = f.runtime.runHostProjectileStage(100, 100).grenadePayloads;
    expect(primary).toHaveLength(1);
    expect(primary[0].x).toBeLessThan(60);
    expect(f.runtime.runHostProjectileStage(0, 100).grenadePayloads).toEqual([]);
    f.runtime.completeGrenadeDetonation(id);
    const count = heEffect().clusterCount!;
    expect(f.runtime.activeCount).toBe(count);
    f.runtime.completeGrenadeDetonation(id);
    expect(f.runtime.activeCount).toBe(count);
    const childId = f.physics.specs[1].id;
    // Repeated terminal terrain bounces cannot detonate a fragment before its fuse.
    for (let i = 0; i < 8; i++) f.physics.emit(projectilePhysicsContact(childId, { kind: 'world-boundary' }));
    expect(f.runtime.runHostProjectileStage(99, 199).grenadePayloads).toEqual([]);
    f.setHostNowMs(600);
    const children = f.runtime.runHostProjectileStage(401, 600).grenadePayloads;
    expect(children).toHaveLength(count);
    for (const child of children) {
      expect(child.effect).toMatchObject({ role: 'cluster', baseDamageMult: heEffect().baseDamageMult });
      f.runtime.completeGrenadeDetonation(child.projectileId);
    }
    expect(f.runtime.activeCount).toBe(0);
    expect(new Set(f.physics.released).size).toBe(count + 1);
  });

  it('blocks R2 through walls and physically reflects fast HE throws at the surface', () => {
    const f = world(target => target.kind === 'enemy' ? 'character' : null);
    f.runtime.setProjectileCollisionTargetQueryPort({
      readCollisionTargets: emit => {
        emit('enemy', 'enemy-1', 'enemy-1', 80, 0, 8, 72, -8, 88, 8);
        emit('rock', 3, '', 45, 0, 5, 40, -20, 50, 20);
      },
    });
    f.physics.binding.findNearestRockSweep.mockReturnValue({ rockIndex: 3, x: 40, y: 0,
      centerX: 35, centerY: 0, normalX: -1, normalY: 0 });
    const id = f.runtime.spawnProjectile(heRequest())!;
    const handle = f.physics.handles.get(id)!; handle.sprite.x = 120;
    f.runtime.runHostInteractionStage(100);
    expect(f.runtime.runHostProjectileStage(100, 100).grenadePayloads).toEqual([]);
    expect(handle.sprite.x).toBeLessThan(40);
    expect(handle.body.velocity.x).toBeLessThan(0);
  });

  it('triggers demolition only once without detonating or stopping its parent', () => {
    const f = world(target => target.kind === 'base' ? 'structure' : null);
    const id = f.runtime.spawnProjectile(heRequest())!;
    f.physics.emit(projectilePhysicsContact(id, { kind: 'base', id: 'hostile-base' }));
    const count = heEffect().fragmentation!.demolition.count;
    expect(f.runtime.activeCount).toBe(count + 1);
    f.physics.emit(projectilePhysicsContact(id, { kind: 'base', id: 'hostile-base' }));
    expect(f.runtime.activeCount).toBe(count + 1);
    expect(f.physics.handles.get(id)!.body.velocity.x).not.toBe(0);
    expect(f.runtime.runHostProjectileStage(99, 99).grenadePayloads).toEqual([]);
    const demolition = f.runtime.runHostProjectileStage(101, 200).grenadePayloads;
    expect(demolition).toHaveLength(count);
    expect(demolition.every(p => p.effect.type === 'damage' && p.effect.role === 'demolition')).toBe(true);
    f.setHostNowMs(1000);
    const primary = f.runtime.runHostProjectileStage(800, 1000).grenadePayloads;
    expect(primary).toHaveLength(1);
    f.runtime.completeGrenadeDetonation(id);
    expect(f.runtime.activeCount).toBe(heEffect().clusterCount!);
  });

  it('uses the last actual movement direction when the parent stops', () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const f = world();
      const id = f.runtime.spawnProjectile(heRequest())!;
      const body = f.physics.handles.get(id)!.body;
      body.setVelocity(0, -100);
      f.runtime.runHostProjectileStage(100, 100);
      body.setVelocity(0, 0);
      f.setHostNowMs(1000); f.runtime.runHostProjectileStage(900, 1000);
      f.runtime.completeGrenadeDetonation(id);
      expect(f.physics.specs.slice(1).every(spec => spec.velocityY < 0 && Math.abs(spec.velocityX) < 0.0001)).toBe(true);
      f.runtime.destroy();
    } finally { random.mockRestore(); }
  });

  it('drops queued cascades when their world is destroyed', () => {
    const f = world();
    const id = f.runtime.spawnProjectile(heRequest())!;
    expect(f.runtime.runHostProjectileStage(1000, 1000).grenadePayloads).toHaveLength(1);
    f.runtime.destroy();
    f.runtime.completeGrenadeDetonation(id);
    expect(f.physics.specs).toHaveLength(1);
    expect(f.runtime.activeCount).toBe(0);
    expect(f.physics.releaseWorldState).toHaveBeenCalledTimes(1);
  });
});
