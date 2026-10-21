import { describe, expect, it } from 'vitest';
import { placeReactiveProps } from '../src/arena/ReactivePropLayout';

function grid(cols: number, rows: number, wallX: number | null = null): boolean[][] {
  return Array.from({ length: rows }, (_, gy) => Array.from({ length: cols }, (_, gx) => gx === wallX && gy !== 10));
}

/** 4-neighbour flood fill over free cells. */
function connected(blocked: boolean[][]): boolean {
  const rows = blocked.length, cols = blocked[0].length;
  const free: [number, number][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (!blocked[y][x]) free.push([x, y]);
  if (free.length === 0) return true;
  const seen = new Set([free[0].join()]);
  const queue = [free[0]];
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || blocked[ny][nx] || seen.has(`${nx},${ny}`)) continue;
      seen.add(`${nx},${ny}`); queue.push([nx, ny]);
    }
  }
  return seen.size === free.length;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

describe('reactive prop placement', () => {
  const scatter = [{ kind: 'explosive_barrel', clusters: 8, clusterSize: [1, 3] as const, minSpacingCells: 5 }];

  it('is deterministic per seed and never cuts walkable space apart', () => {
    const place = () => {
      const blocked = grid(40, 21, 20);
      const result = placeReactiveProps({ cols: 40, rows: 21, blocked, isReserved: () => false,
        isConnected: connected, anchors: [], scatter, rng: rng(7) });
      return { result, blocked };
    };
    const a = place(), b = place();
    expect(a.result).toEqual(b.result);
    expect(a.result.kind === 'placed' && a.result.cells.length).toBeGreaterThan(0);
    expect(connected(a.blocked)).toBe(true);
    // The single gap in the wall stays open.
    expect(a.blocked[10][20]).toBe(false);
  });

  it('keeps scattered props off reserved cells and on open ground', () => {
    const blocked = grid(40, 21);
    const result = placeReactiveProps({ cols: 40, rows: 21, blocked, isReserved: gx => gx < 20,
      isConnected: connected, anchors: [], scatter, rng: rng(3) });
    expect(result.kind).toBe('placed');
    if (result.kind === 'placed') for (const cell of result.cells) expect(cell.gridX).toBeGreaterThanOrEqual(21);
  });

  it('places authored anchors first and retries when an anchor would seal a passage', () => {
    const open = placeReactiveProps({ cols: 40, rows: 21, blocked: grid(40, 21), isReserved: () => false,
      isConnected: connected, anchors: [{ id: 'a', kind: 'explosive_barrel', gridX: 5, gridY: 5, variant: 'toxic' }],
      scatter: [], rng: rng(1) });
    expect(open).toEqual({ kind: 'placed', cells: [{ kind: 'explosive_barrel', gridX: 5, gridY: 5, anchorId: 'a', variant: 'toxic' }] });
    const sealing = placeReactiveProps({ cols: 40, rows: 21, blocked: grid(40, 21, 20), isReserved: () => false,
      isConnected: connected, anchors: [{ id: 'gap', kind: 'explosive_barrel', gridX: 20, gridY: 10 }], scatter: [], rng: rng(1) });
    expect(sealing.kind).toBe('retry');
  });
});
