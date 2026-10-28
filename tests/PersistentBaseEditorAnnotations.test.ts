import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../src/config';
import { PERSISTENT_BASE_AREA_STAGES, resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';
import { buildPersistentBaseAreaBoundary, getPersistentBaseEditorFraming } from '../src/persistentBase/PersistentBaseExpansionPreview';
import { createDawnMerchantExpansionPreview } from '../src/ui/DawnMerchantExpansionPreview';

vi.mock('../src/ui/ForestModal', () => ({ textStyle: (_role: string, style: object) => style }));

function presentation() {
  const strokes: { width: number; color: number; alpha: number }[] = [];
  const lines: number[][] = [];
  const graphics = {
    lineStyle(width: number, color: number, alpha: number) { strokes.push({ width, color, alpha }); return this; },
    lineBetween(...points: number[]) { lines.push(points); return this; },
  };
  const label = { width: 230, height: 36, setPosition: vi.fn(), destroy: vi.fn() };
  const root = { add: vi.fn() };
  const text = vi.fn(() => label);
  const scene = { add: { graphics: () => graphics, container: () => root, text } } as unknown as Phaser.Scene;
  return { scene, strokes, lines, label, root, text };
}

describe('editor annotations', () => {
  it('renders a dashed expansion with a backed label in the same owner container', () => {
    const area = resolvePersistentBaseBuildAreaForStage(4);
    const frame = getPersistentBaseEditorFraming({ x: 88, y: 236, width: 648, height: 680 }, area);
    const edges = buildPersistentBaseAreaBoundary(area);
    const p = presentation();
    expect(createDawnMerchantExpansionPreview(p.scene, frame, edges, 'Radius 8 · 300 Schrott')).toBe(p.root);
    const fullCellLength = CELL_SIZE * frame.zoom;
    // The drawn segments leave gaps, while the final line connects the label to its contour edge.
    expect(p.lines.length).toBe(edges.length * 2 + 1);
    for (const [x1, y1, x2, y2] of p.lines.slice(0, -1)) {
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeGreaterThan(0);
      expect(Math.hypot(x2 - x1, y2 - y1)).toBeLessThan(fullCellLength);
    }
    expect(p.text).toHaveBeenCalledWith(0, 0, 'Radius 8 · 300 Schrott', expect.objectContaining({ backgroundColor: expect.any(String) }));
    expect(p.root.add).toHaveBeenCalledWith(p.label);
    expect(p.label.setPosition).toHaveBeenCalledOnce();
  });
});
