import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../src/config';
import { getExplosiveReactivePropKind } from '../src/config/reactiveProps/reactivePropKinds';
import {
  REACTIVE_PROP_VISUAL, isObservedReactivePropRelease, resolveReactivePropFrame, resolveReactivePropPoses,
  resolveReactivePropVisual, resolveReactivePropWarning, type ReactivePropSheetClip,
} from '../src/effects/reactiveProps/ReactivePropVisualModel';
import type { ReactivePropCell } from '../src/types';

const barrels = (cells: readonly [number, number][]): ReactivePropCell[] =>
  cells.map(([gridX, gridY]) => ({ kind: 'explosive_barrel', gridX, gridY }));

function minCenterDistance(cells: readonly ReactivePropCell[]): number {
  const poses = resolveReactivePropPoses(cells);
  let min = Number.POSITIVE_INFINITY;
  for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
    min = Math.min(min, Math.hypot(
      (cells[b].gridX - cells[a].gridX) * CELL_SIZE + poses[b].offsetX - poses[a].offsetX,
      (cells[b].gridY - cells[a].gridY) * CELL_SIZE + poses[b].offsetY - poses[a].offsetY));
  }
  return min;
}

describe('ReactivePropVisualModel', () => {
  it('keeps barrels as solid bodies: grouped barrels never overlap, wherever the group stands', () => {
    // Cell centres one cell apart are the fallback guarantee.
    expect(REACTIVE_PROP_VISUAL.minCenterDistancePx).toBeLessThanOrEqual(CELL_SIZE);
    const shapes: [number, number][][] = [
      [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 1]],
      [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [0, 1], [1, 1]],
      [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
    ];
    for (const shape of shapes) {
      for (let ox = 0; ox < 40; ox += 3) for (let oy = 0; oy < 40; oy += 7) {
        const cells = barrels(shape.map(([x, y]) => [x + ox, y + oy]));
        expect(minCenterDistance(cells)).toBeGreaterThanOrEqual(REACTIVE_PROP_VISUAL.minCenterDistancePx);
      }
    }
  });

  it('places a layout deterministically', () => {
    const cells = [[4, 4], [5, 4], [5, 5]] as [number, number][];
    expect(resolveReactivePropPoses(barrels(cells))).toEqual(resolveReactivePropPoses(barrels(cells)));
  });

  it('holds the announced blast time between burn ticks and pulls it forward on a real hit', () => {
    const kind = getExplosiveReactivePropKind('explosive_barrel');
    const perHp = 1000 / kind.priming.selfDamagePerSecond;
    const tickHp = kind.priming.selfDamagePerSecond * 0.25;
    const first = resolveReactivePropWarning(kind, 'primed', 10 / kind.integrity.maxHp, 5_000);
    // The next burn tick 250 ms later, observed when it arrives: same announced blast.
    const tick = resolveReactivePropWarning(kind, 'primed', (10 - tickHp) / kind.integrity.maxHp, 5_250);
    expect(first && tick && Math.abs(first.hitAt - tick.hitAt)).toBeLessThan(1);
    // A hit taking 5 HP at the same moment: earlier by the burn time of those HP.
    const hit = resolveReactivePropWarning(kind, 'primed', 5 / kind.integrity.maxHp, 5_000);
    expect(first!.hitAt - hit!.hitAt).toBeCloseTo(5 * perHp, 5);
    expect(resolveReactivePropWarning(kind, 'primed', 0.9, 5_000)).toBeNull();
    expect(resolveReactivePropWarning(kind, 'idle', 0.1, 5_000)).toBeNull();
  });

  const puffballClips: ReactivePropSheetClip[] = [
    { name: 'swell', frames: [1, 2, 3, 4, 5, 6], frameRate: 24, loop: false },
    { name: 'burst', frames: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], frameRate: 24, loop: false },
    { name: 'refill', frames: [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34], frameRate: 12, loop: false },
  ];

  it('refills a puffball monotonically with the recharge and never shows flames on it', () => {
    let previous = -1;
    for (let progress = 0; progress <= 1; progress += .05) {
      const frame = resolveReactivePropFrame('puffball', 'recharging', progress, puffballClips, 0, 10_000, null);
      expect(frame).toBeGreaterThanOrEqual(previous);
      previous = frame;
    }
    for (const phase of ['idle', 'triggered', 'recharging'] as const) {
      expect(resolveReactivePropVisual(phase, .2, 'puffball').burnStacks).toBe(0);
      expect(resolveReactivePropVisual(phase, .2, 'hive').burnStacks).toBe(0);
    }
  });

  it('plays the burst only after a release this client saw, never on late join', () => {
    expect(isObservedReactivePropRelease('triggered', 'recharging', .02)).toBe(true);
    expect(isObservedReactivePropRelease(null, 'recharging', .02)).toBe(false);
    expect(isObservedReactivePropRelease('recharging', 'recharging', .02)).toBe(false);
    const seen = resolveReactivePropFrame('puffball', 'recharging', .01, puffballClips, 0, 1_100, 1_000);
    const lateJoin = resolveReactivePropFrame('puffball', 'recharging', .01, puffballClips, 0, 1_100, null);
    expect(puffballClips[1].frames).toContain(seen);
    expect(puffballClips[2].frames).toContain(lateJoin);
  });
});
