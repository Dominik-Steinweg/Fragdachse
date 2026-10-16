import type { PipelineClip } from '../config/pipelineAssets';

/** Segment of a leap clip split at its `launch` and `land` markers. */
export type LeapClipSegment = 'crouch' | 'air' | 'land';

/**
 * Texture frame of a one-clip leap: crouch plays up to `launch`, the airborne span up to `land`,
 * the landing tail to the last frame. Each segment is stretched over its host-fixed time window,
 * so every leap-style body (charger leap, toad hop) maps replicated timestamps the same way.
 */
export function leapClipFrame(leap: Pick<PipelineClip, 'frames' | 'markers'>, segment: LeapClipSegment,
  startAt: number, endAt: number, now: number): number {
  const last = leap.frames.length - 1;
  const launch = Math.min(last, Math.max(0, leap.markers?.launch ?? Math.round(last / 3)));
  const land = Math.min(last, Math.max(launch, leap.markers?.land ?? Math.round(last * 2 / 3)));
  const [from, to] = segment === 'crouch' ? [0, launch] : segment === 'air' ? [launch, land] : [land, last];
  const progress = clamp01((now - startAt) / Math.max(1, endAt - startAt));
  return leap.frames[Math.round(from + (to - from) * progress)]!;
}

/** Height share of an airborne body over its flight progress (0 at take-off and landing, 1 at the apex). */
export function airborneLift(progress: number): number {
  return Math.sin(Math.PI * clamp01(progress));
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
