import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
import { MarkerGpuBuffer, MARKER_GPU_VERTICES, MARKER_GPU_WORDS, markerGpuAppearance, markerRimColor } from '../src/effects/markers/MarkerGpuBuffer';
import { MARKER_GLYPH_IDS, MARKER_LIMITS, type MarkerBadgeInstance } from '../src/effects/markers/MarkerTypes';
import { HUD_TONES } from '../src/ui/HudFrameAssets';

const uv = Object.fromEntries(MARKER_GLYPH_IDS.map(id => [id, { u0: .1, v0: .2, u1: .3, v1: .4 }])) as Parameters<MarkerGpuBuffer['badge']>[1];
const badge: MarkerBadgeInstance = { key: 'a', space: 'world', x: 700, y: -50, diameter: 30,
  shape: 'round', tone: 'blue', glyph: 'site-wreck', state: 'active', alpha: .7, scale: 1.1,
  vulnerable: false, pulse: 'calm', pointerAngle: Math.PI / 2, tier: 3, progress: .45 };

describe('marker GPU presentation packing', () => {
  it('preserves position, geometry, glyph UV and alpha across all six vertices', () => {
    const buffer = new MarkerGpuBuffer(2);
    buffer.begin(); buffer.badge(badge, uv, false); buffer.end();
    expect(buffer.count).toBe(1);
    for (let vertex = 0; vertex < MARKER_GPU_VERTICES; vertex++) {
      const row = buffer.data.subarray(vertex * MARKER_GPU_WORDS, (vertex + 1) * MARKER_GPU_WORDS);
      expect([...row.slice(0, 2)]).toEqual([badge.x, badge.y]);
      expect(row[4]).toBe(badge.diameter / 2);
      expect(row[5]).toBeCloseTo(badge.scale); expect(row[7]).toBeCloseTo(badge.alpha);
      expect(row[11]).toBeCloseTo(badge.progress!); expect(row[12]).toBe(badge.tier);
      expect(row[20]).toBeCloseTo(uv[badge.glyph].u0); expect(row[23]).toBeCloseTo(uv[badge.glyph].v1);
    }
    expect(new Set(Array.from({ length: 6 }, (_, i) => `${buffer.data[i * MARKER_GPU_WORDS + 2]},${buffer.data[i * MARKER_GPU_WORDS + 3]}`)).size).toBe(4);
  });
  it('uploads only changed values/counts, including removal and same-count reuse', () => {
    const buffer = new MarkerGpuBuffer(1);
    const sync = (items: MarkerBadgeInstance[]) => { buffer.begin(); items.forEach(b => buffer.badge(b, uv, false)); buffer.end(); };
    sync([badge]); const first = buffer.version;
    sync([{ ...badge }]); expect(buffer.version).toBe(first);
    sync([{ ...badge, x: 99 }]); expect(buffer.version).toBe(first + 1);
    sync([]); expect(buffer.count).toBe(0); expect(buffer.version).toBe(first + 2);
    sync([{ ...badge, x: 99 }]); expect(buffer.count).toBe(1); expect(buffer.version).toBe(first + 3);
  });
  it('bounds writes, rejects invalid geometry and clears without stale draws', () => {
    const buffer = new MarkerGpuBuffer(1);
    buffer.begin();
    expect(buffer.badge({ ...badge, x: NaN }, uv, false)).toBe(false);
    expect(buffer.badge({ ...badge, alpha: 0 }, uv, false)).toBe(false);
    expect(buffer.badge(badge, uv, false)).toBe(true);
    const saved = buffer.data.slice();
    expect(buffer.badge({ ...badge, x: 1 }, uv, false)).toBe(false);
    expect(buffer.data).toEqual(saved);
    buffer.end(); expect(buffer.count).toBe(1);
    buffer.begin(); buffer.end(); expect(buffer.count).toBe(0);
  });
  it('packs ground radii independently of badge sizes and replaces slots between roles', () => {
    const buffer = new MarkerGpuBuffer(1);
    buffer.begin(); buffer.badge(badge, uv, false); buffer.end();
    buffer.begin(); buffer.ring({ key: 'zone', x: 1, y: 2, radiusPx: 129, tone: 'green', alpha: .5 }); buffer.end();
    expect([...buffer.data.slice(4, 8)]).toEqual([129, 1, 2, .5]);
    expect([...buffer.data.slice(12, 24)]).toEqual(Array(12).fill(0));
  });
  it('derives status color from HUD tones and suppresses motion without losing semantics', () => {
    expect(markerGpuAppearance({ ...badge, state: 'dormant' }, false)).toMatchObject({ color: markerRimColor(HUD_TONES.blue, true), period: 0 });
    expect(markerGpuAppearance({ ...badge, state: 'completed', vulnerable: true }, false)).toMatchObject({ color: markerRimColor(HUD_TONES.green, false), status: 1, vulnerable: 0, period: 0 });
    expect(markerGpuAppearance({ ...badge, state: 'failed' }, false)).toMatchObject({ color: markerRimColor(HUD_TONES.red, false), status: 2 });
    expect(markerGpuAppearance({ ...badge, vulnerable: true }, true)).toMatchObject({ color: markerRimColor(HUD_TONES.blue, false), vulnerable: 1, period: 0 });
    expect(markerGpuAppearance(badge, false).period).toBe(MARKER_LIMITS.pulsePeriodMs);
    expect(markerGpuAppearance({ ...badge, pulse: 'urgent' }, false).period).toBe(MARKER_LIMITS.urgentPulsePeriodMs);
  });
  it('keeps the dormant tone rim a desaturated, dimmer echo of the active rim', () => {
    const channels = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const chroma = (c: number) => Math.max(...channels(c)) - Math.min(...channels(c));
    for (const [name, tone] of Object.entries(HUD_TONES)) {
      if (name === 'neutral') continue;
      const active = markerRimColor(tone, false), dormant = markerRimColor(tone, true);
      expect(chroma(dormant), name).toBeLessThan(chroma(active));
      expect(Math.max(...channels(dormant)), name).toBeLessThanOrEqual(Math.max(...channels(active)));
    }
  });
  it('keeps the danger rim red while the core HP arc moves from gold to red', () => {
    const appearance = (hp: number) => markerGpuAppearance({ ...badge, tone: 'red', progress: hp, baseAttackGlow: 1 }, false);
    expect(appearance(1).progressColor).toBe(markerRimColor(HUD_TONES.gold, false));
    expect(appearance(.2).progressColor).toBe(markerRimColor(HUD_TONES.red, false));
    expect(appearance(.5).progressColor).not.toBe(appearance(1).progressColor);
    expect(appearance(1).color).toBe(appearance(.2).color);
    const buffer = new MarkerGpuBuffer(1);
    buffer.begin(); buffer.badge({ ...badge, tone: 'red', baseAttackGlow: 1 }, uv, false); buffer.end();
    expect(buffer.data[27]).toBe(1);
    buffer.begin(); buffer.ring({ key: 'ring', x: 0, y: 0, radiusPx: 10, tone: 'gold', alpha: 1 }); buffer.end();
    expect(buffer.data[27]).toBe(-1);
  });
});
