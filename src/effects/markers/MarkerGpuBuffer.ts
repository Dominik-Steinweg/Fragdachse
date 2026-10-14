import { HUD_TONES, type HudToneStyle } from '../../ui/HudFrameAssets';
import { MARKER_LIMITS, type MarkerBadgeInstance, type MarkerGroundRingInstance, type MarkerGlyphId } from './MarkerTypes';
import type { MarkerGlyphUv } from './MarkerGlyphAtlas';

export const MARKER_GPU_WORDS = 28;
export const MARKER_GPU_VERTICES = 6;
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1];
const finite = (n: number, fallback = 0): number => Number.isFinite(n) ? n : fallback;
const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, finite(n)));

const channel = (color: number, shift: number): number => (color >> shift) & 255;
const rgb = (r: number, g: number, b: number): number =>
  (Math.round(clamp(r, 0, 255)) << 16) | (Math.round(clamp(g, 0, 255)) << 8) | Math.round(clamp(b, 0, 255));
/** Mixes `a`→`b` by `t`, then scales chroma around Rec. 601 luma (`saturation` 1 = unchanged) and value. */
function grade(a: number, b: number, t: number, saturation: number, value: number): number {
  const c = [16, 8, 0].map(shift => channel(a, shift) + (channel(b, shift) - channel(a, shift)) * t);
  const luma = c[0] * .299 + c[1] * .587 + c[2] * .114;
  const [r, g, bl] = c.map(v => (luma + (v - luma) * saturation) * value);
  return rgb(r, g, bl);
}
/** Saturated tone rim from the one HUD tone source: the mid fill carries the chroma, the accent the value.
 * Dormant badges keep a desaturated, dimmer echo of the same tone. */
export function markerRimColor(tone: HudToneStyle, dormant: boolean): number {
  return dormant ? grade(tone.fill.mid, tone.accent, .45, .45, .82) : grade(tone.fill.mid, tone.accent, .45, 1.3, 1.05);
}

/** Alpha/pop/fade are already resolved by layout; never apply dormant alpha twice. */
export function markerGpuAppearance(badge: MarkerBadgeInstance, lowQuality: boolean) {
  const resolved = badge.state === 'completed' ? 'green' : badge.state === 'failed' ? 'red' : badge.tone;
  const tone = HUD_TONES[resolved];
  return {
    color: markerRimColor(tone, badge.state === 'dormant'),
    progressColor: badge.baseAttackGlow === undefined ? markerRimColor(tone, badge.state === 'dormant')
      : grade(markerRimColor(HUD_TONES.gold, false), markerRimColor(HUD_TONES.red, false),
        clamp((1 - (badge.progress ?? 1)) / .75, 0, 1), 1, 1),
    status: badge.state === 'completed' ? 1 : badge.state === 'failed' ? 2 : 0,
    vulnerable: badge.vulnerable && badge.state === 'active' ? 1 : 0,
    period: lowQuality || badge.state !== 'active' || badge.pulse === 'none' ? 0
      : badge.pulse === 'urgent' ? MARKER_LIMITS.urgentPulsePeriodMs : MARKER_LIMITS.pulsePeriodMs,
  };
}

/** Bounded CPU staging buffer. Identical frames/time-only changes do not upload vertices. */
export class MarkerGpuBuffer {
  readonly data: Float32Array;
  private readonly scratch = new Float32Array(MARKER_GPU_WORDS);
  count = 0;
  version = 0;
  private nextCount = 0;
  private changed = false;
  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * MARKER_GPU_WORDS * MARKER_GPU_VERTICES);
  }
  begin(): void { this.nextCount = 0; this.changed = false; }
  badge(b: MarkerBadgeInstance, uv: Readonly<Record<MarkerGlyphId, MarkerGlyphUv>>, low: boolean): boolean {
    if (b.alpha <= 0 || b.scale <= 0 || !Number.isFinite(b.x + b.y + b.diameter) || b.diameter <= 0) return false;
    const a = markerGpuAppearance(b, low), f = uv[b.glyph];
    this.scratch.set([b.x, b.y, 0, 0, b.diameter / 2, clamp(b.scale, 0, 4), b.shape === 'triangle' ? 1 : 0, clamp(b.alpha, 0, 1),
      ((a.color >> 16) & 255) / 255, ((a.color >> 8) & 255) / 255, (a.color & 255) / 255,
      b.progress === undefined ? -1 : clamp(b.progress, 0, 1),
      clamp(b.tier ?? 0, 0, 3), a.status, a.vulnerable, a.period,
      finite(b.pointerAngle), b.space === 'screen' ? MARKER_LIMITS.edgePointerPx : MARKER_LIMITS.worldPointerPx,
      MARKER_LIMITS.glyphMaxPx, low ? 0 : 1,
      f.u0, f.v0, f.u1, f.v1,
      ((a.progressColor >> 16) & 255) / 255, ((a.progressColor >> 8) & 255) / 255, (a.progressColor & 255) / 255,
      b.baseAttackGlow === undefined ? -1 : low ? .65 : clamp(b.baseAttackGlow, 0, 1)]);
    return this.append();
  }
  ring(r: MarkerGroundRingInstance): boolean {
    if (r.alpha <= 0 || r.radiusPx <= 0 || !Number.isFinite(r.x + r.y + r.radiusPx)) return false;
    const color = HUD_TONES[r.tone].accent;
    this.scratch.set([r.x, r.y, 0, 0, r.radiusPx, 1, 2, clamp(r.alpha, 0, 1),
      ((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255, -1,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1]);
    return this.append();
  }
  private append(): boolean {
    if (this.nextCount >= this.capacity) return false;
    let offset = this.nextCount++ * MARKER_GPU_VERTICES * MARKER_GPU_WORDS;
    for (let vertex = 0; vertex < MARKER_GPU_VERTICES; vertex++) {
      this.scratch[2] = CORNERS[vertex * 2]; this.scratch[3] = CORNERS[vertex * 2 + 1];
      for (const value of this.scratch) {
        if (this.data[offset] !== value) { this.data[offset] = value; this.changed = true; }
        offset++;
      }
    }
    return true;
  }
  end(): void {
    if (this.changed || this.count !== this.nextCount) this.version++;
    this.count = this.nextCount;
  }
}
