import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
import { CELL_SIZE } from '../src/config';
import { isCellInsidePersistentBaseZone } from '../src/persistentBase/PersistentBaseZone';
import type { PersistentBaseBuildArea } from '../src/persistentBase/PersistentBaseCore';
import { PersistentBaseVisuals } from '../src/scenes/arena/PersistentBaseVisuals';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';
import type { WorldPersistentBaseSite } from '../src/world/WorldRuntimeContext';

type Point = [number, number];
type Edge = [Point, Point];
const edgeKey = (edge: Edge): string => edge.map(point => point.join(':')).sort().join('/');
const metrics = resolveCoopDefenseWorldMetrics(20, 20);
function site(buildArea: PersistentBaseBuildArea, gridX = 5, gridY = 5): WorldPersistentBaseSite {
  return { anchor: { gridX, gridY }, buildArea } as WorldPersistentBaseSite;
}
function setup() {
  let pen: Point = [0, 0];
  let path: Edge[] = [];
  const graphics = {
    visible: false,
    setDepth: vi.fn().mockReturnThis(),
    setVisible: vi.fn(function (visible: boolean) { graphics.visible = visible; return graphics; }),
    clear: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(),
    fillRect: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(),
    beginPath: vi.fn(() => { path = []; return graphics; }),
    moveTo: vi.fn((x: number, y: number) => { pen = [x, y]; return graphics; }),
    lineTo: vi.fn((x: number, y: number) => { path.push([pen, [x, y]]); pen = [x, y]; return graphics; }),
    strokePath: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
  };
  const visuals = new PersistentBaseVisuals({ add: { graphics: () => graphics } } as never);
  return { visuals, graphics, outline: () => path };
}

describe('persistent build-zone guide', () => {
  it.each([
    site({ kind: 'square', sizeCells: 3 }),
    site({ kind: 'radius', radiusCells: 2 }),
    site({ kind: 'radius', radiusCells: 2 }, 0, 0),
  ])('outlines only exposed edges of the buildable cells, including world clipping ($buildArea.kind)', (base) => {
    const h = setup();
    h.visuals.sync(base, metrics, true);
    const cells: Point[] = [];
    const edgeCounts = new Map<string, number>();
    for (let row = 0; row < metrics.gridRows; row++) for (let col = 0; col < metrics.gridCols; col++) {
      if (!isCellInsidePersistentBaseZone(col - base.anchor.gridX, row - base.anchor.gridY, base.buildArea)) continue;
      const x = metrics.offsetX + col * CELL_SIZE, y = metrics.offsetY + row * CELL_SIZE;
      cells.push([x, y]);
      const corners: Point[] = [[x, y], [x + CELL_SIZE, y], [x + CELL_SIZE, y + CELL_SIZE], [x, y + CELL_SIZE]];
      corners.forEach((point, index) => {
        const key = edgeKey([point, corners[(index + 1) % corners.length]]);
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      });
    }
    expect(h.graphics.fillRect.mock.calls.filter(call => call[2] === CELL_SIZE)
      .map(call => call.slice(0, 2))).toEqual(cells);
    const boundary = [...edgeCounts].filter(([, count]) => count === 1).map(([key]) => key).sort();
    expect(h.outline().map(edgeKey).sort()).toEqual(boundary);
    expect(h.graphics.visible).toBe(true);
  });

  it('caches unchanged guides, rebuilds for world metrics and clears on presentation loss', () => {
    const h = setup(); const base = site({ kind: 'square', sizeCells: 3 });
    h.visuals.sync(base, metrics, true);
    const draws = h.graphics.fillRect.mock.calls.length;
    h.visuals.sync(base, metrics, true);
    expect(h.graphics.fillRect).toHaveBeenCalledTimes(draws);
    const previousOutline = h.outline();
    h.visuals.sync(base, { ...metrics, offsetX: metrics.offsetX + CELL_SIZE }, true);
    expect(h.outline()).toEqual(previousOutline.map(edge => edge.map(([x, y]) => [x + CELL_SIZE, y])));
    h.visuals.sync(base, metrics, false);
    expect(h.graphics.visible).toBe(false);
    h.visuals.sync(base, metrics, true);
    h.visuals.sync(null, metrics, true);
    expect(h.graphics.visible).toBe(false);
    h.visuals.sync(base, null, true);
    expect(h.graphics.visible).toBe(false);
    h.visuals.destroy();
    expect(h.graphics.destroy).toHaveBeenCalledOnce();
  });
});
