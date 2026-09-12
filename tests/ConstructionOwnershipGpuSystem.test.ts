import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
import { ConstructionOwnershipGpuSystem, constructionOwnershipTarget } from '../src/effects/ConstructionOwnershipGpuSystem';
import { getTurretVisualSpec } from '../src/config/turretVisuals';
import { resolveCoopDefenseWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';
import type { SyncedPlaceableRock } from '../src/types';
import { findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

const metrics = resolveCoopDefenseWorldMetrics(30, 30);
function rock(id: number, overrides: Partial<SyncedPlaceableRock> = {}): SyncedPlaceableRock {
  return { id, kind: 'rock', constructionId: 'rock_barrier', ownership: 'guest-session',
    gridX: id, gridY: 3, ownerId: 'p1', ownerColor: 0x33aaff, hp: 100, maxHp: 100,
    expiresAt: 0, warningStartsAt: 0, angle: 0, ...overrides };
}
function setup() {
  const scene = makeFakeGpuVfxScene();
  const renderer = new ConstructionOwnershipGpuSystem(scene as never);
  return { scene, renderer, passive: findFakeLane(scene, 'construction-ownership-passive'),
    active: findFakeLane(scene, 'construction-ownership-active') };
}
describe('construction ownership persistent GPU markers', () => {
  it('keeps equal construction types independent, relocates in place and recycles removed slots', () => {
    const h = setup(); const rocks = [rock(1), rock(2)]; const own = new Set([1, 2, 3]);
    expect(h.renderer.sync(rocks, own, metrics, true, true).map(t => t.id)).toEqual([1, 2]);
    expect(h.active.added).toBe(4);
    h.renderer.sync([rocks[0], { ...rocks[1], gridX: 8 }], own, metrics, true, true);
    expect(h.active.edited).toEqual([2, 3]);
    expect(h.active.members.at(-1)?.x.base).toBe(worldCellCenter(metrics, 8, 3).x);
    h.renderer.sync([rocks[0]], own, metrics, true, true);
    h.renderer.sync([rocks[0], rock(3)], own, metrics, true, true);
    expect(h.active.added).toBe(4);
    expect(h.active.edited.slice(-2)).toEqual([2, 3]);
  });

  it('does not upload unchanged markers, HP or turret angles and toggles the layer without rebuilding slots', () => {
    const h = setup(); const turret = rock(1, { kind: 'turret', constructionId: 'rocket_turret', turretWeaponId: 'TURRET_ROCKET_BURST' });
    h.renderer.sync([turret], new Set([1]), metrics, true, true);
    const updated = { ...turret, hp: 50, angle: 2.5 };
    h.renderer.sync([updated], new Set([1]), metrics, true, false);
    expect(h.active.visible).toBe(false);
    h.renderer.sync([updated], new Set([1]), metrics, true, true);
    expect(h.active.visible).toBe(true);
    expect(h.passive.visible).toBe(false);
    expect(h.active.edited).toEqual([]);
    expect(constructionOwnershipTarget(updated, metrics)).toEqual(constructionOwnershipTarget(turret, metrics));
    expect(constructionOwnershipTarget(turret, metrics).width).toBeGreaterThan(getTurretVisualSpec('TURRET_ROCKET_BURST').displaySize);
  });

  it('retints in place and removes own or base-owned markings without affecting other owners', () => {
    const h = setup(); const first = rock(1), second = rock(2);
    h.renderer.sync([first, second], new Set([1]), metrics, true, true);
    h.renderer.sync([{ ...first, ownerId: 'p2' }, second], new Set(), metrics, true, true);
    expect(h.active.visible).toBe(false); expect(h.passive.visible).toBe(true);
    h.renderer.sync([{ ...first, ownerColor: 0xffaa00 }, { ...second, ownership: 'base-owned' }], new Set([2]), metrics, true, true);
    expect(h.passive.members.some(m => m.tint === 0xffaa00)).toBe(true);
    expect(h.active.visible).toBe(false);
    h.renderer.sync([{ ...first, ownership: 'base-owned' }], new Set([1]), metrics, true, true);
    expect(h.passive.visible).toBe(false);
  });

  it('grows buffers without moving surviving slots and destroys them idempotently', () => {
    const h = setup(); const initialSize = h.passive.size;
    h.renderer.sync([rock(1)], new Set([1]), metrics, true, true);
    const rocks = Array.from({ length: initialSize + 1 }, (_, i) => rock(i + 1));
    h.renderer.sync(rocks, new Set(rocks.map(r => r.id)), metrics, true, true);
    expect(h.passive.size).toBeGreaterThan(initialSize);
    expect(h.passive.edited).toEqual([]);
    h.renderer.sync([{ ...rocks[0], gridY: 8 }, ...rocks.slice(1)], new Set(), metrics, true, false);
    expect(h.passive.edited[0]).toBe(0);
    h.renderer.destroy(); h.renderer.destroy();
    expect(h.scene.layers.every(l => l.destroyed && !l.visible)).toBe(true);
    expect(h.renderer.sync(rocks, new Set(), metrics, true, true)).toEqual([]);
  });
});
