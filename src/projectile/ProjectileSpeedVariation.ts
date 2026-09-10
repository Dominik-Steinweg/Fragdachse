/** Charged bolts share a motion profile, never a random sequence or phase. */
export const CHARGED_BOLT_SPEED_VARIATION = {
  maxDeviation: 0.35,
  minIntervalMs: 160,
  maxIntervalMs: 420,
} as const;

export interface ProjectileSpeedVariationState {
  seed: number;
  elapsedMs: number;
  durationMs: number;
  from: number;
  to: number;
  appliedFactor: number;
}

function random(state: ProjectileSpeedVariationState): number {
  // Mix sequential projectile IDs before sampling; unrelated to render randomness.
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let value = Math.imul(state.seed ^ (state.seed >>> 15), 1 | state.seed);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function nextSegment(state: ProjectileSpeedVariationState): void {
  const profile = CHARGED_BOLT_SPEED_VARIATION;
  state.to = 1 + (random(state) * 2 - 1) * profile.maxDeviation;
  state.durationMs = profile.minIntervalMs + random(state) * (profile.maxIntervalMs - profile.minIntervalMs);
}

export function createSpeedVariation(id: number): ProjectileSpeedVariationState {
  const state = { seed: id | 0, elapsedMs: 0, durationMs: 0, from: 1, to: 1, appliedFactor: 1 };
  nextSegment(state);
  return state;
}

/** Simulated time respects time fields. Independent symmetric targets retain mean speed. */
export function advanceSpeedVariation(state: ProjectileSpeedVariationState, deltaMs: number): number {
  state.elapsedMs += Math.max(0, deltaMs);
  while (state.elapsedMs >= state.durationMs) {
    state.elapsedMs -= state.durationMs;
    state.from = state.to;
    nextSegment(state);
  }
  const t = state.elapsedMs / state.durationMs;
  const blend = t * t * (3 - 2 * t);
  return state.from + (state.to - state.from) * blend;
}
