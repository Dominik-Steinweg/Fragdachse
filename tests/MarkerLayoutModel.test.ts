import { describe, expect, it } from 'vitest';
import {
  createMarkerCameraTransform, formatMarkerCountLabel, MarkerLayoutModel,
  MARKER_VISIBILITY_HYSTERESIS_PX, MARKER_WORLD_PIXELS_PER_METRE, sampleMarkerPulse,
  type MarkerLayoutInput,
} from '../src/effects/markers/MarkerLayoutModel';
import { getMarkerEdgeBounds } from '../src/effects/markers/MarkerEdgeLayout';
import { MARKER_LIMITS, MARKER_SCALE, MARKER_STYLES, type MarkerDescriptor } from '../src/effects/markers/MarkerTypes';

const descriptor = (key: string, overrides: Partial<MarkerDescriptor> = {}): MarkerDescriptor => ({
  key, kind: 'site', state: 'dormant', glyph: 'site-wreck', x: 400, y: 300,
  targetHalfHeight: 20, visibility: 'world-and-edge', ...overrides,
});
const input = (descriptors: readonly MarkerDescriptor[], overrides: Partial<MarkerLayoutInput> = {}): MarkerLayoutInput => ({
  descriptors, camera: { worldView: { centerX: 400, centerY: 300 }, zoom: 1,
    viewport: { x: 0, y: 0, width: 800, height: 600 } },
  localPlayer: { x: 400, y: 300 }, reservedHudRects: [], nowMs: 0, lowQuality: false, ...overrides,
});
const atAngle = (key: string, degrees: number, overrides: Partial<MarkerDescriptor> = {}) =>
  descriptor(key, { x: 400 + Math.cos(degrees * Math.PI / 180) * 2000,
    y: 300 + Math.sin(degrees * Math.PI / 180) * 2000, ...overrides });
const overlaps = (a: ReturnType<typeof getMarkerEdgeBounds>, b: ReturnType<typeof getMarkerEdgeBounds>) =>
  a.left < b.right - 1e-7 && a.right > b.left + 1e-7 && a.top < b.bottom - 1e-7 && a.bottom > b.top + 1e-7;

describe('MarkerLayoutModel projection', () => {
  it.each([0.2, 1, 4])('anchors using target geometry and design gap at zoom %s', (zoom) => {
    const model = new MarkerLayoutModel();
    const frame = model.layout(input([descriptor('a')], { camera: {
      ...input([]).camera, zoom,
    } }));
    const badge = frame.worldBadges[0];
    expect(badge.space).toBe('world');
    const diameterPx = Math.max(MARKER_LIMITS.screenDiameterMin,
      Math.min(MARKER_LIMITS.screenDiameterMax, MARKER_STYLES.site.diameter * zoom));
    expect(badge.diameter * zoom).toBeCloseTo(diameterPx);
    expect((300 - 20 - badge.y - badge.diameter / 2) * zoom).toBeCloseTo(MARKER_LIMITS.anchorGapPx);
    expect(badge.pointerAngle).toBe(Math.PI / 2);
  });

  it('uses the raised badge bounds, not the target midpoint, at the top edge', () => {
    const frame = new MarkerLayoutModel().layout(input([descriptor('a', { y: 35 })]));
    expect(frame.worldBadges).toHaveLength(0);
    expect(frame.edgeBadges).toHaveLength(1);
  });

  it('requires full entry but retains occupancy in the small hysteresis band', () => {
    const model = new MarkerLayoutModel();
    const radius = MARKER_STYLES.site.diameter / 2;
    const at = (x: number) => model.layout(input([descriptor('a', { x })]));
    expect(at(radius - 1).edgeBadges).toHaveLength(1);
    expect(at(radius + MARKER_VISIBILITY_HYSTERESIS_PX / 2).edgeBadges).toHaveLength(1);
    expect(at(radius + MARKER_VISIBILITY_HYSTERESIS_PX + 1).worldBadges).toHaveLength(1);
    expect(at(radius + MARKER_VISIBILITY_HYSTERESIS_PX / 2).worldBadges).toHaveLength(1);
    expect(at(radius - 1).edgeBadges).toHaveLength(1);
  });

  it.each([0, 90, 180, -90, 45, 135, -135, -45])('places %s degree targets inside the inset viewport and points at the target', (angle) => {
    const d = atAngle('a', angle);
    const badge = new MarkerLayoutModel().layout(input([d])).edgeBadges[0];
    expect(badge.x).toBeGreaterThanOrEqual(MARKER_LIMITS.edgeInsetPx);
    expect(badge.x).toBeLessThanOrEqual(800 - MARKER_LIMITS.edgeInsetPx);
    expect(badge.y).toBeGreaterThanOrEqual(MARKER_LIMITS.edgeInsetPx);
    expect(badge.y).toBeLessThanOrEqual(600 - MARKER_LIMITS.edgeInsetPx);
    expect(badge.pointerAngle).toBeCloseTo(Math.atan2(d.y - badge.y, d.x - badge.x));
    const bounds = getMarkerEdgeBounds(badge, badge.distanceLabel);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(800);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(600);
  });

  it('projects rotation rather than testing the rotated world AABB', () => {
    const frame = new MarkerLayoutModel().layout(input([descriptor('a', { x: 1500 })], {
      camera: { ...input([]).camera, rotation: Math.PI / 2 },
    }));
    const badge = frame.edgeBadges[0];
    expect(badge.x).toBeCloseTo(400);
    expect(badge.y).toBeGreaterThan(500);
    expect(badge.pointerAngle).toBeCloseTo(Math.PI / 2);
  });

  it.each([0, 0.5])('normalizes render scale and viewport offsets at camera origin %s', (origin) => {
    const camera = { x: 120, y: 40, width: 1600, height: 1200, originX: origin, originY: origin,
      zoom: 2, scrollX: 100, scrollY: 50, rotation: Math.PI / 6 };
    const transform = createMarkerCameraTransform(camera, 2);
    expect(transform.viewport).toEqual({ x: 60, y: 20, width: 800, height: 600 });
    expect(transform.zoom).toBe(1);
    const target = descriptor('a', { x: transform.worldView.centerX + 2000, y: transform.worldView.centerY });
    const badge = new MarkerLayoutModel().layout(input([target], { camera: transform })).edgeBadges[0];
    expect(badge.pointerAngle).toBeCloseTo(Math.atan2(320 + 1000 - badge.y, 460 + Math.sqrt(3) * 1000 - badge.x));
  });

  it.each([0, -1, NaN, Infinity])('keeps invalid zoom %s finite', (zoom) => {
    const frame = new MarkerLayoutModel().layout(input([atAngle('a', 0), descriptor('b')], {
      camera: { ...input([]).camera, zoom },
    }));
    for (const badge of [...frame.worldBadges, ...frame.edgeBadges]) {
      expect([badge.x, badge.y, badge.diameter, badge.pointerAngle].every(Number.isFinite)).toBe(true);
    }
  });

  it('reads inherited camera properties instead of losing them in an object spread', () => {
    const values = { x: 100, y: 50, width: 1600, height: 1200, originX: 0.5, originY: 0.5,
      zoom: 2, scrollX: 320, scrollY: 160, rotation: Math.PI / 4 };
    expect(createMarkerCameraTransform(Object.create(values), 2)).toEqual(createMarkerCameraTransform(values, 2));
  });

  it('distinguishes all visibility policies and suppresses onscreen-only boss arrows', () => {
    const model = new MarkerLayoutModel();
    const frame = model.layout(input([
      descriptor('world', { visibility: 'world-only' }),
      descriptor('edge', { visibility: 'edge-only' }),
      descriptor('boss', { visibility: 'edge-when-offscreen', kind: 'boss', y: 5 }),
      atAngle('hidden-world', 0, { visibility: 'world-only' }),
      atAngle('offscreen-boss', 90, { visibility: 'edge-when-offscreen', kind: 'boss' }),
    ]));
    expect(frame.worldBadges.map((b) => b.key)).toEqual(['world']);
    expect(frame.edgeBadges.map((b) => b.key).sort()).toEqual(['edge', 'offscreen-boss']);
  });
});

describe('MarkerLayoutModel compass layout and grouping', () => {
  it('avoids HUD rectangles including labels and recomputes the shifted direction', () => {
    const hud = { left: 700, right: 800, top: 230, bottom: 380 };
    const d = atAngle('a', 0);
    const badge = new MarkerLayoutModel().layout(input([d], { reservedHudRects: [hud] })).edgeBadges[0];
    expect(overlaps(getMarkerEdgeBounds(badge, badge.distanceLabel), hud)).toBe(false);
    expect(badge.y).not.toBe(300);
    expect(badge.pointerAngle).toBeCloseTo(Math.atan2(d.y - badge.y, d.x - badge.x));
    expect(badge.pointerAngle).not.toBe(0);
  });

  it('keeps complete badge/label bounds separated and stabilizes symmetric HUD alternatives', () => {
    const model = new MarkerLayoutModel();
    const descriptors = Array.from({ length: 6 }, (_, index) => atAngle(`a${index}`, 0));
    const first = model.layout(input(descriptors));
    expect(first.edgeBadges).toHaveLength(6);
    for (let i = 0; i < first.edgeBadges.length; i++) {
      const a = getMarkerEdgeBounds(first.edgeBadges[i], first.edgeBadges[i].distanceLabel);
      const expanded = { left: a.left - MARKER_LIMITS.edgeMinSpacingPx, right: a.right + MARKER_LIMITS.edgeMinSpacingPx,
        top: a.top - MARKER_LIMITS.edgeMinSpacingPx, bottom: a.bottom + MARKER_LIMITS.edgeMinSpacingPx };
      for (let j = i + 1; j < first.edgeBadges.length; j++) {
        expect(overlaps(expanded, getMarkerEdgeBounds(first.edgeBadges[j], first.edgeBadges[j].distanceLabel))).toBe(false);
      }
    }
    expect(model.layout(input([...descriptors].reverse())).edgeBadges).toEqual(first.edgeBadges);
    const jittered = descriptors.map((d) => ({ ...d, y: d.y + 0.01 }));
    expect(model.layout(input(jittered)).edgeBadges.map((b) => [b.key, b.x, b.y]))
      .toEqual(first.edgeBadges.map((b) => [b.key, b.x, b.y]));
  });

  it('drops distance text before dropping a marker in a narrow gap', () => {
    const frame = new MarkerLayoutModel().layout(input([atAngle('a', 0, { x: 32000000 })], {
      camera: { ...input([]).camera, viewport: { x: 0, y: 0, width: Math.round(60 * MARKER_SCALE), height: Math.round(60 * MARKER_SCALE) } },
    }));
    expect(frame.edgeBadges).toHaveLength(1);
    expect(frame.edgeBadges[0].distanceLabel).toBeUndefined();
  });

  it('returns no illegal badge if the entire viewport is reserved or too small', () => {
    const model = new MarkerLayoutModel();
    expect(model.layout(input([atAngle('a', 0)], { reservedHudRects: [
      { left: 0, top: 0, right: 800, bottom: 600 },
    ] })).edgeBadges).toHaveLength(0);
    expect(model.layout(input([atAngle('a', 0)], { camera: {
      ...input([]).camera, viewport: { x: 0, y: 0, width: 10, height: 10 },
    } })).edgeBadges).toHaveLength(0);
  });

  it('bundles exactly through the angular threshold, only for matching semantic bundle keys', () => {
    const frame = new MarkerLayoutModel().layout(input([
      atAngle('a', 0, { bundleKey: 'wreck' }),
      atAngle('b', MARKER_LIMITS.edgeBundleDegrees, { bundleKey: 'wreck' }),
      atAngle('c', MARKER_LIMITS.edgeBundleDegrees + 0.1, { bundleKey: 'wreck' }),
      atAngle('d', 0, { bundleKey: 'other' }),
      atAngle('e', 0), atAngle('f', 0),
    ]));
    expect(frame.edgeBadges).toHaveLength(5);
    expect(frame.edgeBadges.find((b) => b.key === 'a')?.count).toBe(2);
    expect(frame.edgeBadges.filter((b) => b.count !== undefined)).toHaveLength(1);
  });

  it('wraps angles at ±180 and prevents transitive chains wider than the bundle angle', () => {
    const model = new MarkerLayoutModel();
    expect(model.layout(input([atAngle('a', 179, { bundleKey: 'x' }), atAngle('b', -179, { bundleKey: 'x' })]))
      .edgeBadges[0].count).toBe(2);
    const frame = model.layout(input([0, 15, 30].map((angle, i) => atAngle(String(i), angle, { bundleKey: 'x' }))));
    expect(frame.edgeBadges).toHaveLength(2);
    expect(frame.edgeBadges.some((b) => b.count === 3)).toBe(false);
  });

  it('retains group identity when the nearest representative changes; measures from the player', () => {
    const model = new MarkerLayoutModel();
    const descriptors = [descriptor('a', { x: 1200, bundleKey: 'x' }), descriptor('b', { x: 1300, bundleKey: 'x' })];
    const first = model.layout(input(descriptors)).edgeBadges[0];
    const second = model.layout(input(descriptors, { localPlayer: { x: 1400, y: 300 } })).edgeBadges[0];
    expect(second.key).toBe(first.key);
    expect(second.distanceLabel).toBe(`${Math.round(100 / MARKER_WORLD_PIXELS_PER_METRE)} m`);
    expect(second.count).toBe(2);
    expect(formatMarkerCountLabel(second.count!)).toBe('2×');
  });

  it('does not merge hazards or conflicting states through a reused bundle key', () => {
    const frame = new MarkerLayoutModel().layout(input([
      atAngle('a', 0, { bundleKey: 'x' }), atAngle('b', 0, { bundleKey: 'x', state: 'active' }),
      atAngle('c', 0, { bundleKey: 'x', kind: 'hazard', glyph: 'hazard' }),
    ]));
    expect(frame.edgeBadges).toHaveLength(3);
  });

  it('keeps an occupied bundle slot when a lower-key member arrives and preserves its urgency', () => {
    const model = new MarkerLayoutModel();
    const first = atAngle('z', 0, { bundleKey: 'x', state: 'active' });
    const second = { ...first, key: 'zz', x: first.x + 10 };
    const previous = model.layout(input([first, second])).edgeBadges[0];
    const frame = model.layout(input([first, second, atAngle('a', 0, {
      bundleKey: 'x', state: 'active', urgent: true, x: 2500,
    })]));
    expect(frame.edgeBadges[0]).toMatchObject({ key: previous.key, x: previous.x, y: previous.y, count: 3, pulse: 'urgent' });
  });

  it('formats player distances and localized thousands using the shared cell convention', () => {
    const d = descriptor('a', { x: 42 * MARKER_WORLD_PIXELS_PER_METRE, y: 0 });
    expect(new MarkerLayoutModel().layout(input([d], { localPlayer: { x: 0, y: 0 } })).edgeBadges[0].distanceLabel).toBe('42 m');
    const far = { ...d, x: 1234 * MARKER_WORLD_PIXELS_PER_METRE };
    expect(new MarkerLayoutModel({ locale: 'de-DE' }).layout(input([far], { localPlayer: { x: 0, y: 0 } }))
      .edgeBadges[0].distanceLabel).toBe('1.234 m');
    expect(new MarkerLayoutModel({ locale: 'en-US' }).layout(input([far], { localPlayer: { x: 0, y: 0 } }))
      .edgeBadges[0].distanceLabel).toBe('1,234 m');
  });
});

describe('MarkerLayoutModel priorities and time', () => {
  it.each(['world', 'edge'])('collects all %s candidates before budgeting and retains previous equal-priority occupants', (space) => {
    const model = new MarkerLayoutModel();
    const make = (key: string, overrides: Partial<MarkerDescriptor> = {}) => descriptor(key,
      { x: space === 'edge' ? 2000 : 400, ...overrides });
    const limit = space === 'edge' ? MARKER_LIMITS.edgeArrows : MARKER_LIMITS.worldBadges;
    const get = (descriptors: MarkerDescriptor[]) => {
      const frame = model.layout(input(descriptors));
      return space === 'edge' ? frame.edgeBadges : frame.worldBadges;
    };
    const low = Array.from({ length: 20 }, (_, i) => make(`z${i.toString().padStart(2, '0')}`, { kind: 'utility' }));
    const high = [make('main', { kind: 'main-objective' }), make('boss', { kind: 'boss' }), make('danger', { kind: 'hazard' }),
      make('site-active', { state: 'active' }), make('site-dormant')];
    const first = get([...low, ...high]);
    expect(first).toHaveLength(limit);
    expect(first.slice(0, 5).map((b) => b.key)).toEqual(['main', 'boss', 'danger', 'site-active', 'site-dormant']);
    expect(get([make('aaa', { kind: 'utility' }), ...high, ...low].reverse()).map((b) => b.key))
      .toEqual(first.map((b) => b.key));
  });

  it('bundles before applying the edge budget and counts all contributors', () => {
    const frame = new MarkerLayoutModel().layout(input([
      ...Array.from({ length: 30 }, (_, i) => atAngle(`site-${i}`, 0, { bundleKey: 'x' })),
      atAngle('main', 90, { kind: 'main-objective' }),
    ]));
    expect(frame.edgeBadges).toHaveLength(2);
    expect(frame.edgeBadges[1].count).toBe(30);
  });

  it('uses a stable key tie-breaker independent of source enumeration on the first frame', () => {
    const descriptors = Array.from({ length: 20 }, (_, i) => descriptor(`site-${i}`));
    expect(new MarkerLayoutModel().layout(input(descriptors))).toEqual(new MarkerLayoutModel().layout(input([...descriptors].reverse())));
  });

  it('makes baseline/late join silent and animates only a timestamped state change', () => {
    const model = new MarkerLayoutModel();
    const layout = (d: MarkerDescriptor, nowMs: number, lowQuality = false) => model.layout(input([d], { nowMs, lowQuality })).worldBadges[0];
    const dormant = descriptor('a');
    expect(layout(dormant, 0).alpha).toBe(0.7);
    const active = { ...dormant, state: 'active' as const, stateChangedAtMs: 100 };
    expect(layout(active, 100).scale).toBeCloseTo(0.8);
    expect(layout(active, 100 + MARKER_LIMITS.popMs / 2).scale).toBeCloseTo(1.1);
    expect(layout(active, 100 + MARKER_LIMITS.popMs).scale).toBe(1);
    expect(layout(active, 101).scale).toBe(1); // clock rollback cannot replay
    expect(layout(active, 500).alpha).toBe(1);
    expect(layout(active, 500).pulse).toBe('calm');
    expect(new MarkerLayoutModel().layout(input([active], { nowMs: 100 })).worldBadges[0].scale).toBe(1);
    const noTimestamp = new MarkerLayoutModel();
    noTimestamp.layout(input([dormant]));
    expect(noTimestamp.layout(input([{ ...active, stateChangedAtMs: undefined }], { nowMs: 100 })).worldBadges[0].scale).toBe(1);
  });

  it('does not restart pop on timestamp-only refresh or old event replay', () => {
    const model = new MarkerLayoutModel();
    model.layout(input([descriptor('a')]));
    const active = descriptor('a', { state: 'active', stateChangedAtMs: 100 });
    model.layout(input([active], { nowMs: 100 }));
    expect(model.layout(input([{ ...active, stateChangedAtMs: 500 }], { nowMs: 500 })).worldBadges[0].scale).toBe(1);
    expect(model.layout(input([descriptor('a', { state: 'completed', stateChangedAtMs: 100 })], { nowMs: 500 })).worldBadges[0].scale).toBe(1);
  });

  it.each(['completed', 'failed'] as const)('fades %s with or without a timestamp, preserving persistent bases', (state) => {
    const model = new MarkerLayoutModel();
    const descriptors = [descriptor('a', { state, stateChangedAtMs: 100 }), descriptor('base', {
      state, stateChangedAtMs: 100, kind: 'main-objective', glyph: 'base', groundRing: { radiusPx: 123 },
    })];
    const at = (nowMs: number) => model.layout(input(descriptors, { nowMs }));
    expect(at(100).worldBadges.find((b) => b.key === 'a')?.tone).toBe(state === 'completed' ? 'green' : 'red');
    expect(at(100 + MARKER_LIMITS.fadeAfterResolvedMs - MARKER_LIMITS.popMs / 2).worldBadges.find((b) => b.key === 'a')?.alpha).toBeCloseTo(0.5);
    expect(at(100 + MARKER_LIMITS.fadeAfterResolvedMs).worldBadges.map((b) => b.key)).toEqual(['base']);
    expect(at(100000).groundRings).toHaveLength(1);
    const missingTime = new MarkerLayoutModel();
    const d = descriptor('a', { state });
    missingTime.layout(input([d], { nowMs: 100 }));
    expect(missingTime.layout(input([d], { nowMs: 100 + MARKER_LIMITS.fadeAfterResolvedMs })).worldBadges).toHaveLength(0);
    expect(new MarkerLayoutModel().layout(input([descriptors[0]], { nowMs: 100000 })).worldBadges).toHaveLength(0);
  });

  it('suppresses pop and pulse at low quality without suppressing semantic markers/rings', () => {
    const model = new MarkerLayoutModel();
    model.layout(input([descriptor('a')]));
    const d = descriptor('a', { state: 'active', stateChangedAtMs: 100, groundRing: { radiusPx: 50 } });
    const low = model.layout(input([d], { nowMs: 100, lowQuality: true }));
    expect(low.worldBadges[0]).toMatchObject({ alpha: 1, scale: 1, pulse: 'none' });
    expect(low.groundRings).toHaveLength(1);
    expect(model.layout(input([d], { nowMs: 110 })).worldBadges[0].scale).toBe(1);
  });

  it('uses calm/urgent periods and disables dormant/resolved pulse', () => {
    const frame = new MarkerLayoutModel().layout(input([
      atAngle('return', 0, { kind: 'return', state: 'active' }),
      atAngle('hazard', 90, { kind: 'hazard', state: 'active' }),
      atAngle('urgent', 180, { urgent: true, state: 'active' }),
      atAngle('calm', -90, { state: 'active' }),
      atAngle('dormant', 45), atAngle('resolved', -45, { state: 'completed' }),
    ]));
    const modes = Object.fromEntries(frame.edgeBadges.map((b) => [b.key, b.pulse]));
    expect(modes).toEqual({ return: 'urgent', hazard: 'urgent', urgent: 'urgent', calm: 'calm', dormant: 'none', resolved: 'none' });
    expect(sampleMarkerPulse('calm', MARKER_LIMITS.pulsePeriodMs / 2)).toEqual({ scale: 1.125, alpha: 0.25 });
    expect(sampleMarkerPulse('urgent', MARKER_LIMITS.urgentPulsePeriodMs / 2)).toEqual(sampleMarkerPulse('calm', MARKER_LIMITS.pulsePeriodMs / 2));
    expect(sampleMarkerPulse('none', 100)).toEqual({ scale: 1, alpha: 0 });
    expect(sampleMarkerPulse('calm', MARKER_LIMITS.pulsePeriodMs)).toEqual(sampleMarkerPulse('calm', 0));
  });

  it('uses only explicit ground geometry, independent of badge budget, zoom and HUD avoidance', () => {
    const descriptors = Array.from({ length: 12 }, (_, i) => descriptor(String(i), { groundRing: { radiusPx: 50 + i, tone: 'green' } }));
    const frame = new MarkerLayoutModel().layout(input([...descriptors, descriptor('no-ring')], {
      reservedHudRects: [{ left: 0, top: 0, right: 800, bottom: 600 }],
    }));
    expect(frame.worldBadges).toHaveLength(MARKER_LIMITS.worldBadges);
    expect(frame.groundRings).toHaveLength(descriptors.length);
    expect(frame.groundRings.find((r) => r.key === '0')).toMatchObject({ x: 400, y: 300, radiusPx: 50, tone: 'green' });
  });

  it('resets removed key history and rejects ambiguous duplicate descriptors', () => {
    const model = new MarkerLayoutModel();
    model.layout(input([descriptor('a')]));
    model.layout(input([]));
    expect(model.layout(input([descriptor('a', { state: 'active', stateChangedAtMs: 100 })], { nowMs: 100 })).worldBadges[0].scale).toBe(1);
    expect(() => model.layout(input([descriptor('a'), descriptor('a')]))).toThrow('Duplicate marker key');
  });
});
