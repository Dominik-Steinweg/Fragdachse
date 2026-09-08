import { describe, expect, it } from 'vitest';
import type { SyncedBurningGroundCell } from '../src/types';
import { buildGroundFireClusterLayouts, buildGroundFireEmissionLayouts, groundFireCellsSignature } from '../src/effects/GroundFireClusters';

function cell(
  id: number,
  gridX: number,
  gridY: number,
  visualStyle: SyncedBurningGroundCell['visualStyle'] = 'normal',
): SyncedBurningGroundCell {
  return { id, gridX, gridY, expiresAt: 10_000, intensity: 1, visualStyle };
}

describe('GroundFire cluster layouts', () => {
  it('connects only orthogonal neighbours and keeps visual styles separate', () => {
    const layouts = buildGroundFireClusterLayouts([
      cell(1, 0, 0),
      cell(2, 1, 0),
      cell(3, 1, 1),
      cell(4, 3, 0),
      cell(5, 0, 1, 'void'),
    ]);

    expect(layouts.map(layout => [layout.id, layout.cells.length])).toEqual([
      ['groundfire:normal:0:0', 3],
      ['groundfire:normal:3:0', 1],
      ['groundfire:void:0:1', 1],
    ]);
  });

  it('does not bridge diagonal cells', () => {
    const layouts = buildGroundFireClusterLayouts([cell(1, 0, 0), cell(2, 1, 1)]);
    expect(layouts).toHaveLength(2);
    expect(layouts.map(layout => layout.id)).toEqual([
      'groundfire:normal:0:0',
      'groundfire:normal:1:1',
    ]);
  });

  it('uses an order-independent snapshot signature', () => {
    const first = [cell(1, 2, 3), cell(2, 1, 3)];
    const second = [...first].reverse();
    expect(groundFireCellsSignature(first)).toBe(groundFireCellsSignature(second));
  });

  it('keeps emission region identities when their first cell expires or neighbours connect', () => {
    const initial = buildGroundFireEmissionLayouts([cell(1, 0, 0), cell(2, 1, 0), cell(3, 3, 0)]);
    const changed = buildGroundFireEmissionLayouts([cell(3, 3, 0), cell(2, 1, 0), cell(4, 2, 0)]);
    expect(changed.map(region => [region.id, region.seed])).toEqual(initial.map(region => [region.id, region.seed]));
  });

  it('bounds emission regions in world space and separates styles across negative coordinates', () => {
    const input = [cell(1, -1, 0), cell(2, 0, 0), cell(3, 8, 0), cell(4, 0, 0, 'void')];
    const layouts = buildGroundFireEmissionLayouts(input);
    expect(layouts).toHaveLength(4);
    expect(buildGroundFireEmissionLayouts([...input].reverse())).toEqual(layouts);
    expect(layouts.flatMap(region => region.cells)).toHaveLength(input.length);
  });
});
