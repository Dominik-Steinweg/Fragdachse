import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
vi.mock('../src/effects/gpu/GpuVfxAtlas', () => ({ buildGpuVfxAtlas: () => {}, GPU_VFX_ATLAS_KEY: 'shared-atlas' }));
const settings = vi.hoisted(() => ({ quality: 'high' }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: settings.quality }) }));

import { AdrenalineEssenceGpuRenderer } from '../src/adrenalineEssence/AdrenalineEssenceGpuRenderer';
import type { EssenceClusterSnapshot, EssenceState, EssenceTransferReceipt, EssenceTransferSnapshot } from '../src/adrenalineEssence/AdrenalineEssenceTypes';
import { findFakeLane, makeFakeGpuVfxScene, type FakeGpuLayer } from './fakeGpuVfxScene';

function cluster(overrides: Partial<EssenceClusterSnapshot> = {}): EssenceClusterSnapshot {
  return {
    id: 'c1', accessGroup: { kind: 'coop' }, x: 100, y: 100, originX: 80, originY: 80,
    seed: 15, value: 12, createdAt: 0, landAt: 200, expiresAt: 8_200, state: 'grounded', ...overrides,
  };
}
function state(clusters: EssenceClusterSnapshot[], transfers: EssenceTransferSnapshot[] = [], revision = 1): EssenceState {
  return { worldRevision: 1, activityRevision: 1, revision, clusters, transfers };
}
function latestMember(layer: FakeGpuLayer, slot: number) {
  return layer.members[layer.edited.lastIndexOf(slot)];
}
function setup(lighting?: ConstructorParameters<typeof AdrenalineEssenceGpuRenderer>[2]) {
  const scene = makeFakeGpuVfxScene();
  const factory = scene.add.spriteGPULayer;
  scene.add.spriteGPULayer = (key, size) => {
    const layer = factory(key, size);
    return Object.assign(layer, {
      resize: (next: number) => { layer.size = next; },
      destroy: vi.fn(),
    });
  };
  const target = { x: 180, y: 100 };
  const renderer = new AdrenalineEssenceGpuRenderer(scene as never, () => target, lighting);
  return { scene, renderer, target, body: findFakeLane(scene, 'adrenaline-essence-body'), glow: findFakeLane(scene, 'adrenaline-essence-glow') };
}

describe('AdrenalineEssenceGpuRenderer ownership and visual semantics', () => {
  beforeEach(() => { settings.quality = 'high'; });

  it('reuses two GPU layers and stable source slots from ejection to grounded upserts', () => {
    const { scene, renderer, body } = setup();
    renderer.update(state([cluster({ state: 'ejecting' })]), 0);
    const allocated = body.added;
    expect(latestMember(body, 0).x.base).toBe(80);
    renderer.update(state([cluster()], [], 2), 250);
    expect(latestMember(body, 0).x.base).toBe(100);
    expect(latestMember(body, 0).y.base).toBe(100);
    expect(body.added).toBe(allocated);
    expect(scene.layers).toHaveLength(2);
    expect(renderer.getStats().reconstructedDroplets).toBeGreaterThan(1);
  });

  it('reduces satellites at low quality but preserves the same visible core and clears retired slots', () => {
    const { renderer, body } = setup();
    const snapshot = state([cluster()]);
    renderer.update(snapshot, 500);
    const rich = renderer.getStats().reconstructedDroplets;
    settings.quality = 'low';
    renderer.update(snapshot, 510);
    expect(renderer.getStats().reconstructedDroplets).toBeLessThan(rich);
    expect(latestMember(body, 0).alpha.base).toBeGreaterThan(0);
    renderer.clear();
    expect(latestMember(body, 0).alpha.base).toBe(0);
    expect(body.visible).toBe(false);
    expect(renderer.getStats().activeGroups).toBe(0);
  });

  it('draws a small value as one rounded coloured liquid core with morphing material and no rotating shards', () => {
    const { renderer, body } = setup();
    const snapshot = state([cluster({ value: 1 })]);
    renderer.update(snapshot, 200);
    const landed = latestMember(body, 0);
    expect(landed.scaleX.base).toBeGreaterThan(landed.scaleY.base);
    renderer.update(snapshot, 500);
    const first = latestMember(body, 0);
    expect(first.frame).toMatch(/^essence-liquid-\d-\d$/);
    expect(first.tint).toBe(0xffffff); // Baked cyan shading, without a white fill over it.
    expect(renderer.getStats().reconstructedDroplets).toBe(1);
    expect(first.rotation.base).toBe(0);
    expect(first.scaleX.base / first.scaleY.base).toBeGreaterThan(0.9);
    expect(first.scaleX.base / first.scaleY.base).toBeLessThan(1.1);
    renderer.update(snapshot, 2_300);
    expect(latestMember(body, 0).frame).not.toBe(first.frame);
    expect(latestMember(body, 0).rotation.base).toBe(0);
  });

  it('updates illumination independently of GPU refreshes using the same ejection and transfer poses', () => {
    const lighting = { update: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { renderer, body } = setup(lighting);
    const snapshot = state([cluster({ value: 1 })]);
    renderer.update(snapshot, 90);
    expect(lighting.update.mock.lastCall![0][0]).toMatchObject({
      x: latestMember(body, 0).x.base, y: latestMember(body, 0).y.base,
    });
    renderer.update(snapshot, 500);
    const writes = body.edited.length;
    renderer.update(snapshot, 501);
    expect(body.edited).toHaveLength(writes);
    expect(lighting.update).toHaveBeenCalledTimes(3);
    const transfer: EssenceTransferSnapshot = {
      id: 't1', clusterId: 'c1', accessGroup: { kind: 'coop' }, playerId: 'local',
      lifeRevision: 1, participationRevision: 1, value: 1, sourceX: 100, sourceY: 100,
      targetX: 180, targetY: 100, startedAt: 510, arrivalAt: 710, seed: 17,
    };
    renderer.update(state([], [transfer], 2), 600);
    const liveSource = lighting.update.mock.lastCall![0].find((source: { id: string }) => source.id === 't:t1');
    const liveMember = body.members.findLast(member => member.frame?.startsWith('essence-liquid-')
      && member.x.base === liveSource.x && member.y.base === liveSource.y);
    expect(liveMember).toBeDefined();
    renderer.setSuppressed(true);
    expect(lighting.clear).toHaveBeenLastCalledWith(true);
    renderer.clear();
    expect(lighting.clear).toHaveBeenLastCalledWith(true);
    renderer.destroy();
    expect(lighting.destroy).toHaveBeenCalledOnce();
  });

  it('keeps surviving mixed-expiry value visible when an earlier bucket disappears', () => {
    const { renderer, body } = setup();
    renderer.update(state([cluster({ expiresAt: 1_000, lastExpiresAt: 1_200 })]), 995);
    const before = latestMember(body, 0).alpha.base;
    expect(before).toBeGreaterThan(0);
    renderer.update(state([cluster({ value: 6, expiresAt: 1_200 })], [], 2), 995);
    expect(latestMember(body, 0).alpha.base).toBeCloseTo(before);
  });

  it('ranks lights against the actual origin-zero camera view at elevated render resolution', () => {
    const lighting = { update: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
    const { renderer, scene } = setup(lighting);
    Object.assign(scene, { cameras: { main: {
      width: 1_600, height: 1_200, zoom: 2, originX: 0, originY: 0, scrollX: 100, scrollY: 200,
      worldView: { x: 500, y: 500, width: 800, height: 600 },
    } } });
    renderer.update(state([cluster({ value: 1 })]), 500);
    expect(lighting.update.mock.lastCall![2]).toMatchObject({ x: 100, y: 200, width: 800, height: 600 });
  });

  it('does not cap logical cores when the initial detail budget is exceeded', () => {
    const { renderer, scene } = setup();
    const count = renderer.getStats().groupCapacity + 1;
    renderer.update(state(Array.from({ length: count }, (_, index) => cluster({ id: `c${index}`, value: 0.25 }))), 500);
    expect(renderer.getStats().activeGroups).toBe(count);
    expect(renderer.getStats().reconstructedDroplets).toBeGreaterThanOrEqual(count);
    expect(renderer.getStats().capacityDrops).toBe(0);
    expect(scene.layers).toHaveLength(2);
  });

  it('hands an immediately re-reserved return to the new flight without duplicating its pearl', () => {
    const { renderer } = setup();
    const transfer: EssenceTransferSnapshot = {
      id: 't1', clusterId: 'c1', accessGroup: { kind: 'coop' }, playerId: 'local',
      lifeRevision: 1, participationRevision: 1, value: 2, sourceX: 100, sourceY: 100,
      targetX: 180, targetY: 100, startedAt: 200, arrivalAt: 500, seed: 17,
    };
    renderer.update(state([], [transfer]), 420);
    const returned: EssenceTransferReceipt = {
      worldRevision: 1, activityRevision: 1, id: 't1', accessGroup: { kind: 'coop' },
      playerId: 'local', lifeRevision: 1, participationRevision: 1,
      status: 'returned', creditedValue: 0, returnedValue: 2, expiredValue: 0,
      completedAt: 420, resourceRevision: 1, sourceX: 100, sourceY: 100, targetX: 180, targetY: 100,
    };
    renderer.update(state([], [{ ...transfer, id: 't2', playerId: 'other', startedAt: 420, arrivalAt: 620 }], 2), 420, [returned]);
    expect(renderer.getStats().activeGroups).toBe(1);
  });

  it('returns a cancelled transfer to its source without an arrival and detaches on scope changes', () => {
    const { renderer, body } = setup();
    const transfer: EssenceTransferSnapshot = {
      id: 't1', clusterId: 'c1', accessGroup: { kind: 'coop' }, playerId: 'local',
      lifeRevision: 1, participationRevision: 1, value: 2, sourceX: 100, sourceY: 100,
      targetX: 180, targetY: 100, startedAt: 200, arrivalAt: 500, seed: 17,
    };
    renderer.update(state([], [transfer]), 420);
    const flightX = latestMember(body, 0).x.base;
    const returned: EssenceTransferReceipt = {
      worldRevision: 1, activityRevision: 1, id: 't1', accessGroup: { kind: 'coop' },
      playerId: 'local', lifeRevision: 1, participationRevision: 1,
      status: 'returned', creditedValue: 0, returnedValue: 2, expiredValue: 0,
      completedAt: 420, resourceRevision: 1, sourceX: 100, sourceY: 100, targetX: 180, targetY: 100,
    };
    const empty = state([], [], 2);
    renderer.update(empty, 420, [returned]);
    renderer.update(empty, 500);
    expect(latestMember(body, 0).x.base).toBeLessThan(flightX);
    expect(latestMember(body, 0).x.base).toBeGreaterThanOrEqual(100);
    renderer.update({ ...empty, activityRevision: 2 }, 501);
    expect(renderer.getStats().activeGroups).toBe(0);
    expect(body.visible).toBe(false);
  });
});
