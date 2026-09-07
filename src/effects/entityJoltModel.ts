/** Visual offsets only; EntityJoltRegistry applies them exclusively inside the render window. */
import { HIT_FEEDBACK_VFX } from '../config';

export interface JoltState {
  dirX: number;
  dirY: number;
  peakPx: number;
  elapsedMs: number;
  durationMs: number;
}
export interface JoltOffset {
  x: number;
  y: number;
  finished: boolean;
}

/** Immediate attack, short readable hold, then a single fast return. No oscillation. */
export function joltEnvelope(t: number): number {
  if (t <= 0.22) return 1;
  if (t >= 1) return 0;
  const u = (t - 0.22) / 0.78;
  return 1 - u * u * (3 - 2 * u);
}

export function resolveJoltPx(basePx: number, knockbackFactor: number, scale = 1, silhouetteSize = Infinity): number {
  if (!Number.isFinite(basePx) || basePx <= 0 || !Number.isFinite(scale) || scale <= 0
    || !Number.isFinite(knockbackFactor) || knockbackFactor <= 0 || !(silhouetteSize > 0)) return 0;
  const weight = Math.max(0.6, Math.min(1.3, Math.sqrt(knockbackFactor)));
  const cap = Math.min(HIT_FEEDBACK_VFX.maxJoltPx, silhouetteSize * 0.18);
  // Smooth saturation keeps AWP/crit distinguishable even on small silhouettes.
  return cap * Math.tanh(basePx * weight * scale / cap);
}

/** Replace rather than sum impulses. Retriggers never extend a running impulse's lifetime. */
export function superposeJolt(current: JoltState | null, dirX: number, dirY: number, px: number, durationMs: number): JoltState | null {
  const length = Math.hypot(dirX, dirY);
  if (!Number.isFinite(length) || length <= 1e-6 || !Number.isFinite(px) || px <= 0
    || !Number.isFinite(durationMs) || durationMs <= 0) return current;
  const peak = Math.min(px, HIT_FEEDBACK_VFX.maxJoltPx);
  if (current && current.elapsedMs < current.durationMs) {
    // Equal/weaker rapid hits cannot hold the body away from its actual position.
    if (peak <= current.peakPx) return current;
    current.dirX = dirX / length;
    current.dirY = dirY / length;
    current.peakPx = peak;
    return current;
  }
  const state = current ?? { dirX: 0, dirY: 0, peakPx: 0, elapsedMs: 0, durationMs: 0 };
  state.dirX = dirX / length;
  state.dirY = dirY / length;
  state.peakPx = peak;
  state.elapsedMs = 0;
  state.durationMs = durationMs;
  return state;
}

/** Reusable output keeps the registry's frame loop allocation-free. */
export function stepJolt(state: JoltState, deltaMs: number, out: JoltOffset = { x: 0, y: 0, finished: false }): JoltOffset {
  state.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
  const t = state.durationMs > 0 ? state.elapsedMs / state.durationMs : 1;
  const magnitude = joltEnvelope(t) * state.peakPx;
  out.x = state.dirX * magnitude;
  out.y = state.dirY * magnitude;
  out.finished = t >= 1;
  return out;
}
