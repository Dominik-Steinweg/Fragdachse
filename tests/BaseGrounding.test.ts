import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('./fakeArenaRenderScene')).createFakePhaserModule());

import { CELL_SIZE } from '../src/config';
import { buildBaseGroundingLayout } from '../src/arena/BaseGroundingLayout';
import { BaseEntity } from '../src/entities/BaseEntity';
import type { BaseSpec } from '../src/arena/BaseRegistry';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import { createFakeArenaScene, FakeImage } from './fakeArenaRenderScene';

const cells = [
  { gridX: 3, gridY: 3 }, { gridX: 4, gridY: 3 }, { gridX: 3, gridY: 4 },
  { gridX: 8, gridY: 3 },
];
const metrics = resolveCoopDefenseWorldMetrics(20, 20);

describe('Base foundation layout', () => {
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
      const edges = layout.filter((item) => item.cellIndex === cellIndex && item.asset.startsWith('edge-'));
      expect(edges).toHaveLength(exposed.length);
      const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
      const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
      for (const [dx, dy] of exposed) {
        expect(edges.some((item) => dx ? (item.x - cx) * dx > CELL_SIZE / 2
          : (item.y - cy) * dy > CELL_SIZE / 2)).toBe(true);
      }
      for (const item of layout.filter((placement) => placement.cellIndex === cellIndex)) {
        const halfX = (Math.abs(Math.cos(item.rotation)) * item.width + Math.abs(Math.sin(item.rotation)) * item.height) / 2;
        const halfY = (Math.abs(Math.sin(item.rotation)) * item.width + Math.abs(Math.cos(item.rotation)) * item.height) / 2;
        expect(Math.abs(item.x - cx) + halfX).toBeLessThanOrEqual(CELL_SIZE);
        expect(Math.abs(item.y - cy) + halfY).toBeLessThanOrEqual(CELL_SIZE);
      }
    }
    expect(buildBaseGroundingLayout([], metrics)).toEqual([]);
  });
});

function setup(faction: BaseSpec['faction'], role: BaseSpec['role'], presentation = true, dormant = false) {
  const scene = createFakeArenaScene();
  const images: FakeImage[] = [];
  scene.add.image = (x: number, y: number, key: string) => {
    const image = new FakeImage(key, x, y);
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
  return { base, images, grounding: () => images.filter((image) => image.key.startsWith('base-grounding-')) };
}

describe('Base foundation ownership', () => {
  it.each([
    ['friendly', 'main'], ['hostile', 'main'], ['friendly', 'outpost'], ['hostile', 'outpost'],
  ] as const)('follows %s %s cells through staggered destruction and reset', (faction, role) => {
    const { base, grounding } = setup(faction, role);
    const original = grounding();
    expect(original.length).toBeGreaterThan(0);
    expect(base.getSurfaceImages()).toHaveLength(cells.length);
    expect(base.getSurfaceImages().some((image) => original.includes(image as unknown as FakeImage))).toBe(false);
    base.setOnDestroyed(() => {});
    base.setHp(0);
    expect(original.every((image) => image.active)).toBe(true);
    base.destroyCellVisual(0);
    const placements = buildBaseGroundingLayout(cells, metrics);
    original.forEach((image, index) => expect(image.active).toBe(placements[index].cellIndex !== 0));
    base.clearActivityOverlay();
    expect(original.every((image) => !image.active)).toBe(true);
    expect(grounding().slice(original.length).every((image) => image.active)).toBe(true);
    base.destroy();
    base.destroy();
    expect(grounding().every((image) => !image.active)).toBe(true);
  });

  it('creates decoration once on activation, and none without presentation', () => {
    const dormant = setup('friendly', 'outpost', true, true);
    expect(dormant.grounding()).toHaveLength(0);
    expect(dormant.base.activate()).toBe(true);
    const count = dormant.grounding().length;
    expect(count).toBeGreaterThan(0);
    expect(dormant.base.activate()).toBe(false);
    expect(dormant.grounding()).toHaveLength(count);
    dormant.base.setHp(0);
    expect(dormant.grounding().every((image) => !image.active)).toBe(true);
    dormant.base.destroy();
    const headless = setup('hostile', 'main', false);
    expect(headless.images).toHaveLength(0);
    headless.base.destroy();
  });
});
