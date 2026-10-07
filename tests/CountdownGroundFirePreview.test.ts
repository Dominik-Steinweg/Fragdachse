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
        eventId: 'route-void-pocket-0',
        id: 'route-void-pocket-0',
        cells: [{ gridX: 29, gridY: 10 }],
      }],
    };

    const snapshot = buildCountdownGroundFirePreview(layout, getCoopDefenseMapConfig('16'));

    expect(snapshot.cells).toHaveLength(4);
    expect(new Set(snapshot.cells.map((cell) => cell.visualStyle))).toEqual(new Set(['void']));
    expect(new Set(snapshot.cells.map((cell) => cell.id)).size).toBe(snapshot.cells.length);
    expect(snapshot.cells.every((cell) => cell.expiresAt === Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('previews initial patches but excludes the boss-phase expansion', () => {
    const map = getCoopDefenseMapConfig('15');
    const source = map.mapEvents.find(event => event.type === 'ground-hazard' && event.area.type === 'random-patches')!;
    const expansion = map.mapEvents.find(event => event.type === 'ground-hazard' && event.area.type === 'expanded-patches')!;
    const layout: ArenaLayout = {
      seed: 1,
      rocks: [],
      trees: [],
      tracks: [],
      dirt: [],
      powerUpPedestals: [],
      groundHazardZones: [{
        eventId: source.id,
        id: source.id,
        cells: [{ gridX: 20, gridY: 10 }],
      }, {
        eventId: expansion.id,
        id: expansion.id,
        cells: [{ gridX: 21, gridY: 10, expansionProgress: .5 }],
      }],
    };

    const snapshot = buildCountdownGroundFirePreview(layout, map);

    expect(snapshot.cells).toHaveLength(4);
    const withoutExpansion = buildCountdownGroundFirePreview({ ...layout, groundHazardZones: layout.groundHazardZones!.slice(0, 1) }, map);
    expect(snapshot).toEqual(withoutExpansion);
  });
});
