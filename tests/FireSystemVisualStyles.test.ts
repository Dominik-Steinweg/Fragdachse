import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';

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

describe('FireSystem visual styles and damage targets', () => {
  it('keeps normal and void fire independent on the same grid cell', () => {
    const fireSystem = new FireSystem({} as Phaser.Scene);
    const now = 1_000;

    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'player-fire',
      ownerId: 'p0',
      durationMs: 2_000,
      burn: { durationMs: 2_000, damagePerTick: 1 },
      sourceId: 'test.burning-ground',
    }, now);
    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'boss-void-fire',
      ownerId: 'boss-1',
      durationMs: 2_000,
      burn: { durationMs: 2_000, damagePerTick: 0.5 },
      sourceId: 'test.purple-hellfire',
      visualStyle: 'void',
      damageTarget: 'players',
    }, now);

    const update = fireSystem.hostUpdate(now);
    expect(update.ground.cells).toHaveLength(2);
    expect(update.ground.cells.map(cell => cell.visualStyle).sort()).toEqual(['normal', 'void']);
    expect(new Set(update.ground.cells.map(cell => `${cell.gridX}:${cell.gridY}`)).size).toBe(1);

    const contacts = fireSystem.collectContacts(300, 300, 1, now);
    expect(contacts).toHaveLength(2);
    expect(contacts.find(contact => contact.ownerId === 'p0')?.damageTarget).toBe('all');
    expect(contacts.find(contact => contact.ownerId === 'p0')?.visualStyle).toBe('normal');
    expect(contacts.find(contact => contact.ownerId === 'boss-1')).toMatchObject({
      damageTarget: 'players',
      visualStyle: 'void',
    });
  });

  it('fills every grid cell touched by a moving boss footprint without gaps', () => {
    const fireSystem = new FireSystem({} as Phaser.Scene);
    const now = 2_000;

    fireSystem.hostRefreshGroundCellsAlongSweptCircle(
      320,
      320,
      368,
      320,
      34,
      {
        sourceKey: 'void-fire-trail:boss-1',
        ownerId: 'boss-1',
        durationMs: 6_000,
        burn: { durationMs: 2_000, damagePerTick: 0.5 },
      sourceId: 'test.purple-trail',
        visualStyle: 'void',
        damageTarget: 'players',
      },
      now,
    );

    const cells = fireSystem.hostUpdate(now).ground.cells;
    expect(cells.length).toBeGreaterThan(12);
    expect(cells.every(cell => cell.visualStyle === 'void' && cell.expiresAt === now + 6_000)).toBe(true);

    const centerRow = cells
      .filter(cell => cell.gridY === Math.floor(320 / 16))
      .map(cell => cell.gridX)
      .sort((left, right) => left - right);
    expect(centerRow).toEqual(
      Array.from(
        { length: centerRow.at(-1)! - centerRow[0]! + 1 },
        (_, index) => centerRow[0]! + index,
      ),
    );
  });

  it('keeps persistent map fire alive beyond any gameplay timer until arena teardown', () => {
    const fireSystem = new FireSystem({} as Phaser.Scene);
    const now = 3_000;

    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'map-event:persistent-hazard:1',
      ownerId: 'map-hazard:15',
      durationMs: 1,
      permanent: true,
    }, now);

    expect(fireSystem.hostUpdate(now + 60_000).ground.cells).toHaveLength(1);
    fireSystem.destroyAll();
    expect(fireSystem.hostUpdate(now + 60_000).ground.cells).toEqual([]);
  });

  it('removes only the requested map-event source and preserves independent fire', () => {
    const fireSystem = new FireSystem({} as Phaser.Scene);
    const now = 4_000;
    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'map-event:hazard-a:1',
      ownerId: 'map-hazard:hazard-a',
      durationMs: 2_000,
      permanent: true,
      visualStyle: 'void',
    }, now);
    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'player-fire',
      ownerId: 'player-1',
      durationMs: 2_000,
      permanent: true,
      visualStyle: 'normal',
    }, now);

    fireSystem.hostRemoveGroundSourcesBySourceKey('map-event:hazard-a:1');
    const remaining = fireSystem.hostUpdate(now).ground.cells;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.visualStyle).toBe('normal');
  });

  it('keeps permanent map-hazard cells out of per-frame dynamic source work', () => {
    const fireSystem = new FireSystem({} as Phaser.Scene);
    const now = 5_000;
    for (let index = 0; index < 200; index += 1) {
      fireSystem.hostRefreshGroundCell(300 + (index % 20) * 16, 300 + Math.floor(index / 20) * 16, {
        sourceKey: 'map-event:permanent-hazard:1',
        ownerId: 'map-hazard:15',
        durationMs: 1,
        permanent: true,
        static: true,
        visualStyle: 'void',
      }, now);
    }
    fireSystem.hostRefreshGroundCell(300, 300, {
      sourceKey: 'player-fire',
      ownerId: 'p0',
      durationMs: 2_000,
      damagePerTick: 1,
    }, now);

    const update = fireSystem.hostUpdate(now);
    expect(update.synced).toEqual([]);
    expect(update.damageEvents).toHaveLength(1);
    expect(update.damageEvents[0]?.sourceId).toBe('ground_fire.player_fire');
    expect(update.ground.cells.length).toBeGreaterThan(0);
  });
});
