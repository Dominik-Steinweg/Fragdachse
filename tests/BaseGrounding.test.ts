import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());
// Pixel extraction and shared atlas lifetime are covered by BaseAccentMask.test.ts.
vi.mock('../src/arena/BaseAccentGlowTexture', () => ({
  acquireBaseAccentGlowTexture: vi.fn(() => ({
    key: 'test-base-accent', frames: new Set(Array.from({ length: 55 }, (_, i) => String(i))), release: vi.fn(),
  })),
}));

import { CELL_SIZE } from '../src/config';
import { buildBaseGroundingLayout } from '../src/arena/BaseGroundingLayout';
import { BASE_GROUNDING_ASSETS } from '../src/arena/BaseGroundingConfig';
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
  it('composes the active generated palette, including gravel and earth, across varied footprints', () => {
    const variedCells = Array.from({ length: 16 }, (_, index) => ({ gridX: index * 4, gridY: (index % 3) * 4 }));
    const layout = buildBaseGroundingLayout(variedCells, metrics);
    const used = new Set(layout.map((item) => item.asset));
    expect([...used].sort()).toEqual([...BASE_GROUNDING_ASSETS].sort());
    for (const cluster of layout.filter((item) => item.kind === 'cluster')) {
      expect(layout.some((item) => item.cellIndex === cluster.cellIndex && item.kind === 'gravel'
        && item.asset.startsWith('edge-') && Math.hypot(item.x - cluster.x, item.y - cluster.y) < CELL_SIZE / 2)).toBe(true);
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

  it('decorates exposed edges of concave and disconnected footprints, with bounded overhang', () => {
    const layout = buildBaseGroundingLayout(cells, metrics);
    for (const [cellIndex, cell] of cells.entries()) {
      const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const exposed = neighbors.filter(([dx, dy]) => !cells.some((other) =>
        other.gridX === cell.gridX + dx && other.gridY === cell.gridY + dy));
      const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
      const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
      for (const item of layout.filter((placement) => placement.cellIndex === cellIndex)) {
        const dx = item.x - cx;
        const dy = item.y - cy;
        const normal = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
        expect(exposed).toContainEqual(normal);
        const halfX = (Math.abs(Math.cos(item.rotation)) * item.width + Math.abs(Math.sin(item.rotation)) * item.height) / 2;
        const halfY = (Math.abs(Math.sin(item.rotation)) * item.width + Math.abs(Math.cos(item.rotation)) * item.height) / 2;
        expect(Math.abs(item.x - cx) + halfX).toBeLessThanOrEqual(CELL_SIZE);
        expect(Math.abs(item.y - cy) + halfY).toBeLessThanOrEqual(CELL_SIZE);
      }
    }
    expect(buildBaseGroundingLayout([], metrics)).toEqual([]);
  });

  it('leaves gaps between stone nests and grades smaller stones outward over connecting earth', () => {
    const layout = buildBaseGroundingLayout(cells, metrics);
    const clusters = layout.filter((item) => item.kind === 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i], b = clusters[j];
        const reach = (Math.hypot(a.width, a.height) + Math.hypot(b.width, b.height)) / 2;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(reach);
      }
    }
    expect(layout.filter((item) => item.kind === 'soil').length).toBeGreaterThan(clusters.length);
    for (const item of layout.filter((placement) => placement.kind === 'pebble')) {
      const cell = cells[item.cellIndex];
      const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
      const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
      const distance = Math.max(Math.abs(item.x - cx), Math.abs(item.y - cy));
      const nearer = layout.filter((other) => other.cellIndex === item.cellIndex && (other.kind === 'cluster' || other.kind === 'pebble')
        && Math.max(Math.abs(other.x - cx), Math.abs(other.y - cy)) < distance);
      expect(nearer.length).toBeGreaterThan(0);
      for (const other of nearer) {
        expect(item.width).toBeLessThan(other.width);
        expect(item.alpha).toBeLessThan(other.alpha);
      }
    }
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
  it.each([
    ['friendly', 'main'], ['hostile', 'main'], ['friendly', 'outpost'], ['hostile', 'outpost'],
  ] as const)('follows %s %s cells through staggered destruction and reset', (faction, role) => {
    const { base, grounding, accents, scene } = setup(faction, role);
    const original = grounding();
    const initialAccents = accents();
    expect(initialAccents.length > 0).toBe(faction === 'friendly');
    expect(original.length).toBeGreaterThan(0);
    expect(base.getSurfaceImages()).toHaveLength(cells.length);
    expect(base.getSurfaceImages().some((image) => original.includes(image as unknown as FakeImage))).toBe(false);
    base.setOnDestroyed(() => {});
    base.setHp(0);
    expect(initialAccents.every(image => !image.active)).toBe(true);
    expect(scene.events.listenerCount('postupdate')).toBe(0);
    expect(original.every((image) => image.active)).toBe(true);
    base.destroyCellVisual(0);
    const placements = buildBaseGroundingLayout(cells, metrics);
    original.forEach((image, index) => expect(image.active).toBe(placements[index].cellIndex !== 0));
    base.clearActivityOverlay();
    expect(original.every((image) => !image.active)).toBe(true);
    expect(grounding().slice(original.length).every((image) => image.active)).toBe(true);
    expect(accents().slice(initialAccents.length).every(image => image.active)).toBe(true);
    base.destroy();
    base.destroy();
    expect(grounding().every((image) => !image.active)).toBe(true);
    expect(accents().every(image => !image.active)).toBe(true);
    expect(scene.events.eventNames()).toEqual([]);
  });

  it('creates decoration once on activation, and none without presentation', () => {
    const dormant = setup('friendly', 'outpost', true, true);
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
    const headless = setup('friendly', 'main', false);
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
