import { describe, expect, it } from 'vitest';
import {
  compass8,
  mergePerimeterIntervals,
  pointAtPerimeter,
  projectZoneOntoBorder,
  splitPerimeterSegment,
  type BorderRect,
} from '../src/utils/spawnDirection';
import {
  resolveEncounterDirections,
  resolveEncounterSpawnZoneRects,
  resolveEncounterTelegraphIncoming,
} from '../src/activity/coopMissionEncounterDirections';
import type { CoopDefenseEncounterPresentationState } from '../src/types';

/** 1000 × 600, Umfang 3200: Nord [0, 1000), Ost [1000, 1600), Süd [1600, 2600), West [2600, 3200). */
const BORDER: BorderRect = { left: 0, top: 0, right: 1000, bottom: 600 };
const CENTRE = { x: 500, y: 300 };
const OPEN = { minSpan: 0, maxSpan: 10_000 };

function encounter(
  overrides: Partial<CoopDefenseEncounterPresentationState> = {},
): CoopDefenseEncounterPresentationState {
  return {
    encounterId: 'wave-1', sequenceIndex: 1, sequenceCount: 3, phase: 'incoming',
    phaseStartedAtMs: 0, phaseEndsAtMs: 1000, encounterFronts: [], fronts: [],
    ...overrides,
  };
}

describe('compass8', () => {
  it('names the eight screen sectors with north pointing up', () => {
    expect(compass8(1, 0)).toBe('east');
    expect(compass8(1, -1)).toBe('northEast');
    expect(compass8(0, -1)).toBe('north');
    expect(compass8(-1, -1)).toBe('northWest');
    expect(compass8(-1, 0)).toBe('west');
    expect(compass8(-1, 1)).toBe('southWest');
    expect(compass8(0, 1)).toBe('south');
    expect(compass8(1, 1)).toBe('southEast');
  });

  it('keeps each sector 45 degrees wide around its axis', () => {
    expect(compass8(10, -4)).toBe('east');
    expect(compass8(10, -5)).toBe('northEast');
    expect(compass8(-4, -10)).toBe('north');
    expect(compass8(-10, 4)).toBe('west');
  });

  it('has no direction without a vector', () => {
    expect(compass8(0, 0)).toBeNull();
    expect(compass8(Number.NaN, 1)).toBeNull();
  });
});

describe('projectZoneOntoBorder', () => {
  // Eckstrahlen (1, −2) und (8, −1) treffen den Rand bei x = 650 oben und y = 237,5 rechts.
  const topRightZone = { x: 700, y: -100, width: 600, height: 300 };

  it('wraps a zone beyond the top-right corner around that corner', () => {
    const interval = projectZoneOntoBorder(BORDER, CENTRE, topRightZone, OPEN);
    expect(interval?.start).toBeCloseTo(650);
    expect(interval?.length).toBeCloseTo(587.5);

    const pieces = splitPerimeterSegment(BORDER, interval!);
    expect(pieces.map(piece => piece.side)).toEqual(['north', 'east']);
    expect(pieces[0]).toMatchObject({ at: 0, openLow: false, openHigh: true });
    expect(pieces[0].low).toBeCloseTo(650);
    expect(pieces[0].high).toBeCloseTo(1000);
    expect(pieces[1]).toMatchObject({ at: 1000, openLow: true, openHigh: false });
    expect(pieces[1].low).toBeCloseTo(0);
    expect(pieces[1].high).toBeCloseTo(237.5);
  });

  it('wraps through the perimeter origin at the top-left corner', () => {
    const interval = projectZoneOntoBorder(BORDER, CENTRE, { x: -400, y: -200, width: 600, height: 300 }, OPEN)!;
    expect(interval.start).toBeGreaterThan(2600);
    expect(interval.start + interval.length).toBeGreaterThan(3200);

    const pieces = splitPerimeterSegment(BORDER, interval);
    expect(pieces.map(piece => piece.side)).toEqual(['west', 'north']);
    expect(pieces[0]).toMatchObject({ at: 0, low: 0, openLow: true, openHigh: false });
    expect(pieces[1]).toMatchObject({ at: 0, low: 0, openLow: true, openHigh: false });
  });

  it('widens a distant small zone symmetrically to the minimum span', () => {
    const interval = projectZoneOntoBorder(
      BORDER, CENTRE, { x: 495, y: -1000, width: 10, height: 10 }, { minSpan: 200, maxSpan: 600 },
    )!;
    expect(interval.start).toBeCloseTo(400);
    expect(interval.length).toBeCloseTo(200);
  });

  it('shortens a wide projection around the ray to the zone centre', () => {
    // Die Zonenmitte (1000, 50) liegt auf dem Strahl zur Umfangsposition 1050.
    const interval = projectZoneOntoBorder(BORDER, CENTRE, topRightZone, { minSpan: 0, maxSpan: 300 })!;
    expect(interval.start).toBeCloseTo(900);
    expect(interval.length).toBeCloseTo(300);
  });

  it('keeps a shortened span inside the projected zone interval', () => {
    const interval = projectZoneOntoBorder(BORDER, CENTRE, topRightZone, { minSpan: 0, maxSpan: 580 })!;
    expect(interval.start).toBeGreaterThanOrEqual(650 - 1e-6);
    expect(interval.start + interval.length).toBeLessThanOrEqual(1237.5 + 1e-6);
  });

  it('has no direction while the zone contains the view centre', () => {
    expect(projectZoneOntoBorder(BORDER, CENTRE, { x: 400, y: 200, width: 200, height: 200 }, OPEN)).toBeNull();
    // Ein Blickpunkt außerhalb des Rands wird erst hineingeklemmt.
    expect(projectZoneOntoBorder(BORDER, { x: 1400, y: 300 }, { x: 900, y: 250, width: 200, height: 100 }, OPEN))
      .toBeNull();
  });
});

describe('perimeter segments', () => {
  it('splits a segment over three sides in clockwise order', () => {
    const pieces = splitPerimeterSegment(BORDER, { start: 900, length: 1300 });
    expect(pieces).toEqual([
      { side: 'north', at: 0, low: 900, high: 1000, openLow: false, openHigh: true },
      { side: 'east', at: 1000, low: 0, high: 600, openLow: true, openHigh: true },
      { side: 'south', at: 600, low: 400, high: 1000, openLow: false, openHigh: true },
    ]);
  });

  it('places perimeter points clockwise from the top-left corner', () => {
    expect(pointAtPerimeter(BORDER, 250)).toEqual({ x: 250, y: 0, side: 'north' });
    expect(pointAtPerimeter(BORDER, 1100)).toEqual({ x: 1000, y: 100, side: 'east' });
    expect(pointAtPerimeter(BORDER, 1700)).toEqual({ x: 900, y: 600, side: 'south' });
    expect(pointAtPerimeter(BORDER, 2700)).toEqual({ x: 0, y: 500, side: 'west' });
    expect(pointAtPerimeter(BORDER, 3250)).toEqual({ x: 50, y: 0, side: 'north' });
  });

  it('merges overlapping intervals across the perimeter origin', () => {
    const wrapping = { start: 3100, length: 200, id: 'a' };
    const leading = { start: 50, length: 100, id: 'b' };
    const apart = { start: 1200, length: 100, id: 'c' };
    const groups = mergePerimeterIntervals(3200, [wrapping, apart, leading]);
    expect(groups).toHaveLength(2);
    expect(groups[0].interval).toEqual({ start: 3100, length: 250 });
    expect(groups[0].members).toEqual([wrapping, leading]);
    expect(groups[1].members).toEqual([apart]);
  });
});

describe('encounter directions', () => {
  it('names fronts by their side and falls back to the west front', () => {
    expect(resolveEncounterDirections(encounter({ encounterFronts: ['north', 'west', 'north'] }), null, null))
      .toEqual(['north', 'west']);
    expect(resolveEncounterDirections(encounter(), null, null)).toEqual(['west']);
    expect(resolveEncounterTelegraphIncoming(encounter(), null)).toEqual({ fronts: ['west'], zones: [] });
  });

  it('names zones from the centre of the visible area', () => {
    const corner = { id: 'nest-1', x: 1800, y: -200, width: 200, height: 200 };
    const zones = { encounter: [corner], live: [corner] };
    expect(resolveEncounterDirections(encounter(), zones, { x: 1000, y: 500 })).toEqual(['northEast']);
    expect(resolveEncounterDirections(encounter(), zones, { x: 1900, y: 800 })).toEqual(['north']);
    expect(resolveEncounterTelegraphIncoming(encounter({ fronts: [] }), zones)).toEqual({ fronts: [], zones: [corner] });
  });

  it('reports a zone around the viewpoint as nearby instead of a direction', () => {
    const around = { id: 'ambush', x: 900, y: 400, width: 300, height: 300 };
    expect(resolveEncounterDirections(encounter(), { encounter: [around], live: [around] }, { x: 1000, y: 500 }))
      .toEqual([]);
  });
});

describe('replicated spawn zones as world rectangles (Void-Gefahrenzonen V1)', () => {
  const world = { offsetX: 100, offsetY: 50, cellSize: 32, zones: [
    { id: 'west-upper', gridX: 0, gridY: 2, widthCells: 8, heightCells: 10 },
    { id: 'east-mid', gridX: 60, gridY: 10, widthCells: 8, heightCells: 10 },
  ] };
  const state = { encounterId: 'wave', sequenceIndex: 1, sequenceCount: 1, phase: 'incoming' as const, phaseStartedAtMs: 0,
    phaseEndsAtMs: 1000, encounterFronts: [], fronts: [], encounterZones: ['west-upper', 'east-mid', 'gone'], zones: ['east-mid'] };

  it('maps encounter and live zones through the World and drops unknown ids', () => {
    const rects = resolveEncounterSpawnZoneRects(state, world)!;
    expect(rects.encounter.map(({ id }) => id)).toEqual(['west-upper', 'east-mid']);
    expect(rects.live).toEqual([{ id: 'east-mid', x: 100 + 60 * 32, y: 50 + 10 * 32, width: 256, height: 320 }]);
  });

  it('leaves front encounters and worlds without zones to the fronts', () => {
    expect(resolveEncounterSpawnZoneRects({ ...state, encounterZones: undefined, zones: undefined }, world)).toBeNull();
    expect(resolveEncounterSpawnZoneRects(state, null)).toBeNull();
  });
});
