import { describe, expect, it } from 'vitest';
import {
  clusterEdgeMarkers,
  formatEdgeMarkerLabel,
  type EdgeMarkerCandidate,
} from '../src/effects/coopDefenseSecondaryObjectiveEdgeMarkers';

function candidate(overrides: Partial<EdgeMarkerCandidate> = {}): EdgeMarkerCandidate {
  return { screenX: 0, screenY: 0, angle: 0, distancePx: 100, category: 'focus', ...overrides };
}

describe('Coop defense secondary objective edge markers', () => {
  it('keeps one arrow per target while they stand apart', () => {
    const clusters = clusterEdgeMarkers([
      candidate({ screenX: 0, screenY: 0, distancePx: 100 }),
      candidate({ screenX: 0, screenY: 200, distancePx: 200 }),
      candidate({ screenX: 0, screenY: 400, distancePx: 300 }),
    ], 74, 6);
    expect(clusters).toHaveLength(3);
    expect(clusters.every((cluster) => cluster.count === 1)).toBe(true);
  });

  it('merges only arrows that would overlap', () => {
    const clusters = clusterEdgeMarkers([
      candidate({ screenX: 0, screenY: 0, distancePx: 100 }),
      candidate({ screenX: 20, screenY: 10, distancePx: 140 }),
      candidate({ screenX: 0, screenY: 300, distancePx: 320 }),
    ], 74, 6);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].count).toBe(2);
    expect(clusters[1].count).toBe(1);
  });

  it('lets the nearest target of a group define position, angle and distance', () => {
    const clusters = clusterEdgeMarkers([
      candidate({ screenX: 30, screenY: 0, angle: 1.5, distancePx: 400 }),
      candidate({ screenX: 0, screenY: 0, angle: 0.5, distancePx: 120 }),
    ], 74, 6);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].distancePx).toBe(120);
    expect(clusters[0].angle).toBe(0.5);
    expect(clusters[0].screenX).toBe(0);
  });

  it('never merges arrows of different categories, however close they sit', () => {
    // Ein zusammengefasster Pfeil traegt genau eine Leitfarbe. Zwei Kategorien in einem Pfeil
    // wuerden die Zugehoerigkeit einer der beiden Missionen falsch behaupten.
    const clusters = clusterEdgeMarkers([
      candidate({ screenX: 0, screenY: 0, distancePx: 100, category: 'focus' }),
      candidate({ screenX: 4, screenY: 2, distancePx: 140, category: 'background' }),
    ], 74, 6);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.category)).toEqual(['focus', 'background']);
    expect(clusters.every((cluster) => cluster.count === 1)).toBe(true);
  });

  it('keeps the category of the group it merged', () => {
    const clusters = clusterEdgeMarkers([
      candidate({ screenX: 0, screenY: 0, distancePx: 100, category: 'background' }),
      candidate({ screenX: 10, screenY: 0, distancePx: 150, category: 'background' }),
    ], 74, 6);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ category: 'background', count: 2 });
  });

  it('drops the farthest groups on overflow', () => {
    const overflow = clusterEdgeMarkers([
      candidate({ screenX: 0, screenY: 0, distancePx: 500 }),
      candidate({ screenX: 0, screenY: 300, distancePx: 100 }),
      candidate({ screenX: 0, screenY: 600, distancePx: 300 }),
    ], 74, 2);
    expect(overflow).toHaveLength(2);
    expect(overflow.map((cluster) => cluster.distancePx)).toEqual([100, 300]);
  });

  it('handles empty input and formats labels with and without a count', () => {
    expect(clusterEdgeMarkers([], 74, 6)).toEqual([]);
    expect(formatEdgeMarkerLabel({ ...candidate({ distancePx: 320 }), count: 1 }, 32)).toBe('10 m');
    expect(formatEdgeMarkerLabel({ ...candidate({ distancePx: 320 }), count: 3 }, 32)).toBe('3× · 10 m');
  });
});
