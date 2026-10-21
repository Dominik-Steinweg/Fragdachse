import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
// Pixel extraction and shared atlas lifetime are covered by BaseAccentMask.test.ts.
vi.mock('../src/arena/BaseAccentGlowTexture', () => ({
  acquireBaseAccentGlowTexture: vi.fn(() => ({
    key: 'test-base-accent', frames: new Set(Array.from({ length: 55 }, (_, i) => String(i))), release: vi.fn(),
  })),
}));

import { CELL_SIZE, VOID_PALETTE } from '../src/config';
import { buildBaseGroundingLayout } from '../src/arena/BaseGroundingLayout';
import { BASE_GROUNDING_ASSETS } from '../src/arena/BaseGroundingConfig';
import { getBaseApronRaster, writeBaseApron } from '../src/arena/BaseGroundingField';
import { BaseEntity } from '../src/entities/BaseEntity';
import type { BaseSpec } from '../src/arena/BaseRegistry';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { createFakeArenaScene, FakeImage } from './fakeArenaRenderScene';
import { acquireBaseAccentGlowTexture } from '../src/arena/BaseAccentGlowTexture';
import { BaseAccentGlowRenderer } from '../src/arena/BaseAccentGlowRenderer';

const cells = [
  { gridX: 3, gridY: 3 }, { gridX: 4, gridY: 3 }, { gridX: 3, gridY: 4 },
  { gridX: 8, gridY: 3 },
];
const metrics = resolveCoopDefenseWorldMetrics(20, 20);

describe('Base foundation layout', () => {
  it('composes stones and gravel, without soil stains, as separated nests across varied footprints', () => {
    const variedCells = Array.from({ length: 16 }, (_, index) => ({ gridX: index * 4, gridY: (index % 3) * 4 }));
    const layout = buildBaseGroundingLayout(variedCells, metrics);
    const used = new Set(layout.map((item) => item.asset));
    expect([...used].sort()).toEqual([...BASE_GROUNDING_ASSETS].sort());
    const clusters = layout.filter((item) => item.kind === 'cluster');
    // Nests are an accent, not an outline: far fewer than the exposed edges.
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.length).toBeLessThan(variedCells.length * 4 / 3);
    for (const cluster of clusters) {
      expect(layout.some((item) => item.cellIndex === cluster.cellIndex && item.kind === 'gravel'
        && item.asset.startsWith('edge-') && Math.hypot(item.x - cluster.x, item.y - cluster.y) < CELL_SIZE / 2)).toBe(true);
    }
    for (const pebble of layout.filter((item) => item.kind === 'pebble')) {
      const nest = clusters.find((cluster) => cluster.cellIndex === pebble.cellIndex);
      expect(nest).toBeDefined();
      expect(pebble.width).toBeLessThan(nest!.width);
      expect(pebble.alpha).toBeLessThan(nest!.alpha);
    }
  });

  it('is independent of cell enumeration and translates with world metrics', () => {
    const normalize = (items: ReturnType<typeof buildBaseGroundingLayout>) => items
      .map(({ cellIndex: _index, ...item }) => JSON.stringify(item)).sort();
    const layout = buildBaseGroundingLayout(cells, metrics);
    expect(normalize(layout)).toEqual(normalize(buildBaseGroundingLayout([...cells].reverse(), metrics)));
    const shifted = buildBaseGroundingLayout(cells, { offsetX: metrics.offsetX + 123, offsetY: metrics.offsetY - 97 });
    expect(shifted.map((item) => ({ ...item, x: item.x - 123, y: item.y + 97 })))
      .toEqual(layout);
  });

  it('places decorations outside exposed edges of concave and disconnected footprints, within a cell of them', () => {
    const footprints = [cells, Array.from({ length: 16 }, (_, i) => ({ gridX: 2 + (i % 4), gridY: 2 + Math.floor(i / 4) }))];
    for (const footprint of footprints) {
      const layout = buildBaseGroundingLayout(footprint, metrics);
      for (const item of layout) {
        const cell = footprint[item.cellIndex];
        const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
        const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
        const dx = item.x - cx;
        const dy = item.y - cy;
        const normal = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        expect(footprint.some((other) => other.gridX === cell.gridX + normal[0] && other.gridY === cell.gridY + normal[1])).toBe(false);
        const halfX = (Math.abs(Math.cos(item.rotation)) * item.width + Math.abs(Math.sin(item.rotation)) * item.height) / 2;
        const halfY = (Math.abs(Math.sin(item.rotation)) * item.width + Math.abs(Math.cos(item.rotation)) * item.height) / 2;
        expect(Math.abs(dx) + halfX).toBeLessThanOrEqual(CELL_SIZE * 1.5);
        expect(Math.abs(dy) + halfY).toBeLessThanOrEqual(CELL_SIZE * 1.5);
      }
    }
    expect(buildBaseGroundingLayout([], metrics)).toEqual([]);
  });

  it('leaves gaps between stone nests', () => {
    const block = Array.from({ length: 36 }, (_, i) => ({ gridX: 2 + (i % 6), gridY: 2 + Math.floor(i / 6) }));
    const clusters = buildBaseGroundingLayout(block, metrics).filter((item) => item.kind === 'cluster');
    expect(clusters.length).toBeGreaterThan(1);
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i], b = clusters[j];
        const reach = (Math.hypot(a.width, a.height) + Math.hypot(b.width, b.height)) / 2;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(reach);
      }
    }
  });
});

describe('Base foundation apron', () => {
  const material = (salt: number) => ({ width: 64, height: 64,
    rgba: Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) => i % 4 === 3 ? 255 : (Math.imul(i + salt, 2654435761) >>> 24)) });
  const materials = { soil: material(1), gravel: material(2),
    grassHeight: { width: 64, height: 64, data: Uint8Array.from({ length: 4096 }, (_, i) => Math.imul(i, 2654435761) >>> 24) } };
  const apron = (footprint: typeof cells, frame: { offsetX: number; offsetY: number } = metrics) => {
    const raster = getBaseApronRaster(footprint, frame)!;
    const data = new Uint8ClampedArray(raster.width * raster.height * 4);
    writeBaseApron(data, raster, footprint, frame, materials);
    return { raster, data };
  };

  it('is a pure function of the footprint and the World frame', () => {
    const { raster, data } = apron(cells);
    expect(apron([...cells].reverse()).data).toEqual(data);
    const moved = apron(cells, { offsetX: metrics.offsetX + 64, offsetY: metrics.offsetY - 32 });
    expect(moved.raster.worldX - raster.worldX).toBe(64);
    expect(moved.data).toEqual(data);
    expect(getBaseApronRaster([], metrics)).toBeNull();
  });

  it('keeps the foundation under the footprint and ends within its reach', () => {
    const { raster, data } = apron(cells);
    const alphaAt = (worldX: number, worldY: number) =>
      data[((Math.floor(worldY) - raster.worldY) * raster.width + Math.floor(worldX) - raster.worldX) * 4 + 3];
    for (const cell of cells) {
      for (let y = 2; y < CELL_SIZE; y += 6) for (let x = 2; x < CELL_SIZE; x += 6) {
        expect(alphaAt(metrics.offsetX + cell.gridX * CELL_SIZE + x, metrics.offsetY + cell.gridY * CELL_SIZE + y)).toBe(255);
      }
    }
    for (let x = 0; x < raster.width; x++) {
      expect(data[x * 4 + 3]).toBe(0);
      expect(data[((raster.height - 1) * raster.width + x) * 4 + 3]).toBe(0);
    }
  });

  it('wanders between grass at the plates and a wide trodden patch along a long edge', () => {
    const strip = Array.from({ length: 16 }, (_, i) => ({ gridX: 2 + i, gridY: 4 }));
    const { raster, data } = apron(strip);
    const edgeY = metrics.offsetY + 4 * CELL_SIZE;
    const covered = (distance: number) => Array.from({ length: 16 * CELL_SIZE / 4 }, (_, i) => {
      const x = metrics.offsetX + 2 * CELL_SIZE + i * 4 - raster.worldX, y = edgeY - distance - raster.worldY;
      return data[(y * raster.width + x) * 4 + 3];
    });
    const near = covered(6), far = covered(16);
    // Grass reaches the plates in places, trodden ground runs out further in others.
    expect(near.some((alpha) => alpha === 0)).toBe(true);
    expect(near.some((alpha) => alpha > 200)).toBe(true);
    expect(far.some((alpha) => alpha > 200)).toBe(true);
    expect(near.filter((alpha) => alpha > 200).length).toBeGreaterThan(far.filter((alpha) => alpha > 200).length);
  });
});

function setup(faction: BaseSpec['faction'], role: BaseSpec['role'], presentation = true, dormant = false) {
  const scene = createFakeArenaScene();
  const images: FakeImage[] = [];
  scene.add.image = (x: number, y: number, key: string, frame?: string | number) => {
    const image = new FakeImage(key, x, y, frame);
    images.push(image);
    return image;
  };
  Object.assign(scene.add, { rectangle: (x: number, y: number) => Object.assign(new FakeImage('body', x, y), {
    setData: vi.fn(), body: { setSize: vi.fn(), updateFromGameObject: vi.fn() },
  }) });
  Object.assign(scene, { physics: { add: { existing: vi.fn() } } });
  const spec: BaseSpec = {
    id: 'base-test', cells, faction, role, hpMax: 100, dormant,
    region: { minGridX: 3, minGridY: 3, maxGridX: 8, maxGridY: 4 },
    turrets: [], powerUpPedestals: [],
  };
  const base = new BaseEntity(scene as never, spec, metrics, presentation, true);
  return {
    base, images, scene,
    grounding: () => images.filter((image) => image.key.startsWith('base-grounding-')),
    accents: () => images.filter((image) => image.key === 'test-base-accent'),
  };
}

describe('Base foundation ownership', () => {
  it('releases the vulnerability marker when its entity is destroyed directly', () => {
    const { base, scene } = setup('hostile', 'main');
    const marker = Object.assign(new FakeImage('vulnerability-marker', 0, 0), {
      lineStyle: () => marker,
      strokeRect: () => marker,
    });
    Object.assign(scene.add, { graphics: () => marker });
    Object.assign(scene, { tweens: { add: vi.fn() } });
    base.setVulnerable(true);
    expect(marker.active).toBe(true);
    base.destroy();
    expect(marker.active).toBe(false);
    base.destroy();
    expect(marker.active).toBe(false);
  });

  it.each([
    ['friendly', 'main'], ['hostile', 'main'], ['friendly', 'outpost'], ['hostile', 'outpost'],
  ] as const)('follows %s %s cells through staggered destruction and reset', (faction, role) => {
    const { base, grounding, accents, scene, images } = setup(faction, role);
    const original = grounding();
    const initialAccents = accents();
    expect(initialAccents.length).toBeGreaterThan(0);
    expect(acquireBaseAccentGlowTexture).toHaveBeenLastCalledWith(scene.textures, faction === 'hostile' ? 'base_hostile' : 'base');
    if (faction === 'hostile') {
      expect(initialAccents[0].tint).toBe(VOID_PALETTE.primary);
      expect(initialAccents[1].tint).toBe(VOID_PALETTE.bright);
    }
    expect(original.length).toBeGreaterThan(0);
    expect(base.getSurfaceImages()).toHaveLength(cells.length);
    expect(base.getSurfaceImages().some((image) => original.includes(image as unknown as FakeImage))).toBe(false);
    base.setOnDestroyed(() => {});
    base.setHp(0);
    expect(initialAccents.every(image => !image.active)).toBe(true);
    expect(scene.events.listenerCount('postupdate')).toBe(0);
    expect(original.every((image) => image.active)).toBe(true);
    const apron = images.filter((image) => image.key.startsWith('__base_apron_'));
    expect(apron).toHaveLength(1);
    base.destroyCellVisual(0);
    const placements = buildBaseGroundingLayout(cells, metrics);
    original.forEach((image, index) => expect(image.active).toBe(placements[index].cellIndex !== 0));
    // The trodden foundation stays while single cells fall.
    expect(apron[0].active).toBe(true);
    base.clearActivityOverlay();
    expect(original.every((image) => !image.active)).toBe(true);
    expect(grounding().slice(original.length).every((image) => image.active)).toBe(true);
    expect(accents().slice(initialAccents.length).every(image => image.active)).toBe(true);
    base.destroy();
    base.destroy();
    expect(grounding().every((image) => !image.active)).toBe(true);
    expect(images.filter((image) => image.key.startsWith('__base_apron_')).every((image) => !image.active)).toBe(true);
    expect(accents().every(image => !image.active)).toBe(true);
    expect(scene.events.eventNames()).toEqual([]);
  });

  it.each(['friendly', 'hostile'] as const)('creates %s decoration once on activation, and none without presentation', faction => {
    const dormant = setup(faction, 'outpost', true, true);
    expect(dormant.grounding()).toHaveLength(0);
    expect(dormant.accents()).toHaveLength(0);
    expect(dormant.scene.events.eventNames()).toEqual([]);
    expect(dormant.base.activate()).toBe(true);
    const count = dormant.grounding().length;
    expect(count).toBeGreaterThan(0);
    const accentCount = dormant.accents().length;
    expect(accentCount).toBeGreaterThan(0);
    expect(dormant.base.activate()).toBe(false);
    expect(dormant.grounding()).toHaveLength(count);
    expect(dormant.accents()).toHaveLength(accentCount);
    dormant.base.setHp(0);
    expect(dormant.grounding().every((image) => !image.active)).toBe(true);
    dormant.base.destroy();
    const headless = setup(faction, 'main', false);
    expect(headless.images).toHaveLength(0);
    headless.base.destroy();
  });

  it('keeps the pulse in phase across creation times, independent of HP and source geometry', () => {
    const { base, accents, scene } = setup('friendly', 'main');
    const initial = accents().map(image => image.alpha);
    const geometry = accents().map(image => [image.x, image.y, image.displayWidth, image.displayHeight]);
    scene.time.now += 700;
    scene.events.emit('postupdate');
    const brightened = accents().map(image => image.alpha);
    expect(brightened.every((alpha, index) => alpha > initial[index] && alpha <= 1)).toBe(true);
    base.applyDamage(10);
    scene.events.emit('postupdate');
    expect(accents().map(image => image.alpha)).toEqual(brightened);
    const originalCount = accents().length;
    const peer = new BaseAccentGlowRenderer(scene as never, base.getSurfaceImages());
    expect(accents().slice(originalCount).map(image => image.alpha)).toEqual(brightened);
    expect(accents().slice(0, originalCount).map(image => [image.x, image.y, image.displayWidth, image.displayHeight])).toEqual(geometry);
    base.destroyCellVisual(0);
    expect(accents().slice(0, 2).every(image => !image.active)).toBe(true);
    base.destroy();
    peer.destroy();
    expect(scene.events.eventNames()).toEqual([]);
  });

  it('follows source frame, size and visibility and releases the texture on scene shutdown', () => {
    const { base, accents, scene } = setup('friendly', 'main');
    const source = base.getSurfaceImages()[0];
    expect(accents()[0].frame.name).toBe(`${source.frame.name}:halo`);
    expect(accents()[1].frame.name).toBe(`${source.frame.name}:core`);
    expect(accents()[0].x).toBe(source.x);
    expect(accents()[0].displayWidth).toBeGreaterThan(source.displayWidth);
    expect(accents()[0].depth).toBeGreaterThan(source.depth);
    const acquired = vi.mocked(acquireBaseAccentGlowTexture).mock.results.at(-1)!.value;
    source.visible = false;
    scene.events.emit('postupdate');
    expect(accents().slice(0, 2).every(image => image.alpha === 0)).toBe(true);
    scene.events.emit('shutdown');
    expect(accents().every(image => !image.active)).toBe(true);
    expect(scene.events.eventNames()).toEqual([]);
    base.destroy();
    expect(acquired.release).toHaveBeenCalledTimes(1);
  });
});
