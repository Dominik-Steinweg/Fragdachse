import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Geom: {
    Rectangle: class {
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
      readonly centerX: number;
      readonly centerY: number;

      constructor(x: number, y: number, width: number, height: number) {
        this.left = x;
        this.right = x + width;
        this.top = y;
        this.bottom = y + height;
        this.centerX = x + width * 0.5;
        this.centerY = y + height * 0.5;
      }
    },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Linear: (from: number, to: number, progress: number) => from + (to - from) * progress,
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));
import { FireSystem } from '../src/effects/FireSystem';
import { resolvedDecoy } from './DecoyTestHelper';

describe('Decoy normal ground fire', () => {
  it('fills long physical segments, reuses cell sources and leaves independent expiring normal burn', () => {
    const cfg = resolvedDecoy(), fire = new FireSystem({} as never);
    const options = { sourceKey: 'decoy-trail:1', ownerId: 'p', durationMs: cfg.fireTrailDurationMs,
      burn: { durationMs: cfg.fireChunkBurst.burnDurationMs, damagePerTick: cfg.fireChunkBurst.burnDamagePerTick },
      sourceId: 'ground_fire.decoy_trail', visualStyle: 'normal' as const };
    fire.hostRefreshGroundCellsAlongSegment(304, 304, 624, 304, options, 1000);
    const initial = fire.hostUpdate(1000).ground.cells;
    expect(initial.length).toBeGreaterThanOrEqual(20);
    for (let x = 312; x < 624; x += 16) {
      const contacts = fire.collectContacts(x, 312, 0, 1100);
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ burn: options.burn, visualStyle: 'normal', damagePerTick: 0 });
    }
    fire.hostRefreshGroundCellsAlongSegment(304, 304, 624, 304, options, 1200);
    expect(fire.hostUpdate(1200).ground.cells).toHaveLength(initial.length);
    expect(fire.collectContacts(312, 312, 0, 1200)).toHaveLength(1);
    expect(fire.hostUpdate(7000).ground.cells.length).toBeGreaterThan(0);
    expect(fire.collectContacts(312, 312, 0, 7201)).toEqual([]);
    expect(fire.hostUpdate(7800).ground.cells).toEqual([]);
  });
});
