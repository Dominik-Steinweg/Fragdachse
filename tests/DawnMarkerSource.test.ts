import { describe, expect, it } from 'vitest';
import { CELL_SIZE } from '../src/config';
import { dawnMarkers, type DawnMarkerInput } from '../src/effects/markers/sources/DawnMarkerSource';
import { secondaryObjectiveMarkers } from '../src/effects/markers/sources/CoopMissionMarkerSource';
import type { CoopDefenseSecondaryObjectivePresentationEntry } from '../src/types';

const site = { objectiveId: 'salvage-a', archetypeId: 'extractor', tier: 2, gridX: 10, gridY: 4, radiusCells: 5, targetHalfHeight: 48 };
const entry = (state: CoopDefenseSecondaryObjectivePresentationEntry['state'], at = 1000): CoopDefenseSecondaryObjectivePresentationEntry => ({
  objectiveId: 'salvage-a', type: 'hold', state, focused: false, progressCurrent: 30, progressTotal: 60, stateChangedAtMs: at,
});
const input = (patch: Partial<DawnMarkerInput>): DawnMarkerInput => ({
  phase: 'day', returnToBase: false, sites: [site], objectives: null, origin: { offsetX: 100, offsetY: 50 },
  base: { gridX: 20, gridY: 20 }, clock: { nowMs: 5000, elapsedMs: 2000 }, ...patch,
});

describe('Dawn marker projection', () => {
  it('keeps one key, glyph and tier from dormant to active and rings only the activation radius', () => {
    const [dormant] = dawnMarkers(input({}));
    const [active] = dawnMarkers(input({ objectives: [entry('active')] }));
    expect(dormant).toMatchObject({ key: 'dawn-site:salvage-a', kind: 'site', state: 'dormant', glyph: 'site-extractor', tier: 2,
      x: 100 + 10.5 * CELL_SIZE, y: 50 + 4.5 * CELL_SIZE, targetHalfHeight: 48 });
    expect(dormant.groundRing).toBeUndefined();
    expect(active).toMatchObject({ key: dormant.key, state: 'active', glyph: 'site-extractor', tier: 2, progress: .5,
      groundRing: { radiusPx: 5 * CELL_SIZE } });
  });

  it('derives the hold arc from the replicated activation time, not the binary target count', () => {
    const hold = { ...site, holdDurationMs: 40_000 };
    const [active] = dawnMarkers(input({ sites: [hold], objectives: [entry('active', 1000)], clock: { nowMs: 5000, elapsedMs: 11_000 } }));
    expect(active.progress).toBeCloseTo(.25, 6);
    const [late] = dawnMarkers(input({ sites: [hold], objectives: [entry('active', 1000)], clock: { nowMs: 5000, elapsedMs: 90_000 } }));
    expect(late.progress).toBe(1);
  });

  it('keeps hidden sites off navigation until a player finds and activates them', () => {
    expect(dawnMarkers(input({ sites: [{ ...site, hidden: true }] }))).toEqual([]);
    expect(dawnMarkers(input({ sites: [{ ...site, hidden: true }], objectives: [entry('active')] }))).toHaveLength(1);
  });

  it('offers dormant sites only by day but follows activated ones into the night', () => {
    expect(dawnMarkers(input({ phase: 'dusk' }))).toEqual([]);
    expect(dawnMarkers(input({ phase: 'night', objectives: [entry('active')] }))).toHaveLength(1);
  });

  it('stamps resolved sites from the replicated round time, so a late join arrives already faded', () => {
    const [done] = dawnMarkers(input({ objectives: [entry('completed', 1500)] }));
    expect(done).toMatchObject({ state: 'completed', stateChangedAtMs: 5000 - 500 });
  });

  it('adds an urgent return marker at the base anchor only while returning', () => {
    expect(dawnMarkers(input({ phase: 'dusk', returnToBase: true }))).toEqual([expect.objectContaining({
      key: 'dawn-return', kind: 'return', glyph: 'base', urgent: true, x: 100 + 20.5 * CELL_SIZE })]);
    expect(dawnMarkers(input({ phase: 'dusk', returnToBase: true, base: null }))).toEqual([]);
  });

  it('leaves site-activated objectives to the site source instead of doubling them as missions', () => {
    const config = { id: 'salvage-a', type: 'hold', start: { type: 'site-activated', siteId: 'a' }, targets: ['site-a'] };
    const markers = secondaryObjectiveMarkers([entry('active')], [config as never], [], { offsetX: 0, offsetY: 0 },
      () => ({ x: 0, y: 0, width: 32, height: 32 }));
    expect(markers).toEqual([]);
    // A supply site's crates and its delivery zone still come from the mission source.
    const supply = { id: 'salvage-a', type: 'carry', start: { type: 'site-activated', siteId: 'a' }, targets: [],
      carry: { spawnZone: { gridX: 1, gridY: 1, widthCells: 3, heightCells: 3 }, deliveryZone: { gridX: 20, gridY: 20, widthCells: 8, heightCells: 8 }, itemCount: 1 } };
    const crates = secondaryObjectiveMarkers([{ ...entry('active'), type: 'carry' }], [supply as never],
      [{ id: 'c1', objectiveId: 'salvage-a', x: 40, y: 40, holderId: null, state: 'spawned' }], { offsetX: 0, offsetY: 0 }, () => null);
    expect(crates.map(marker => marker.kind)).toEqual(['carry']);
  });
});
