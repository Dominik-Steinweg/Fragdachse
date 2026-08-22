import { describe, expect, it } from 'vitest';
import { buildCountdownGroundFirePreview } from '../src/effects/CountdownGroundFirePreview';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import type { ArenaLayout } from '../src/types';

describe('countdown ground-fire preview', () => {
  it('derives a void visual from an authored start-of-round hazard without activating gameplay', () => {
    const layout: ArenaLayout = {
      seed: 1,
      rocks: [],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
      groundHazardZones: [{
        eventId: 'brandschneise-void-corridor',
        id: 'brandschneise-void-corridor',
        cells: [{ gridX: 29, gridY: 10 }],
      }],
    };

    const snapshot = buildCountdownGroundFirePreview(layout, getCoopDefenseMapConfig('14'));

    expect(snapshot.cells).toHaveLength(4);
    expect(new Set(snapshot.cells.map((cell) => cell.visualStyle))).toEqual(new Set(['void']));
    expect(new Set(snapshot.cells.map((cell) => cell.id)).size).toBe(snapshot.cells.length);
    expect(snapshot.cells.every((cell) => cell.expiresAt === Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('does not preview hazards whose authored trigger is after the round start', () => {
    const layout: ArenaLayout = {
      seed: 1,
      rocks: [],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
      groundHazardZones: [{
        eventId: 'void-random-patches',
        id: 'void-random-patches',
        cells: [{ gridX: 20, gridY: 10 }],
      }],
    };

    const snapshot = buildCountdownGroundFirePreview(layout, getCoopDefenseMapConfig('15'));

    expect(snapshot.cells).toEqual([]);
  });
});
