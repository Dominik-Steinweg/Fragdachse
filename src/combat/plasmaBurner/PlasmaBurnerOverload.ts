export interface PlasmaBurnerOverloadState { q: number; coverageEndMs: number; decayedUntilMs: number }
export interface PlasmaBurnerOverloadRules {
  readonly qMax: number; readonly buildPerSecond: number;
  readonly decayPerSecond: number; readonly contactToleranceMs: number;
}
export function advance(state: PlasmaBurnerOverloadState, now: number, rules: PlasmaBurnerOverloadRules, force = false): void {
  if (!force && state.coverageEndMs > state.decayedUntilMs && now <= state.coverageEndMs + rules.contactToleranceMs) return;
  const start = Math.max(state.coverageEndMs, state.decayedUntilMs);
  if (now > start) state.q = Math.max(0, state.q - (now - start) * rules.decayPerSecond / 1000);
  state.decayedUntilMs = Math.max(state.decayedUntilMs, now);
  state.q = Math.min(state.q, rules.qMax);
}
export function creditPulse(state: PlasmaBurnerOverloadState, now: number, intervalMs: number, weight: number, rules: PlasmaBurnerOverloadRules): void {
  if (weight <= 0) {
    state.coverageEndMs = Math.min(state.coverageEndMs, now);
    advance(state, now, rules, true);
    return;
  }
  state.q = Math.min(rules.qMax, state.q + rules.buildPerSecond * weight * intervalMs / 1000);
  state.coverageEndMs = now + intervalMs;
  state.decayedUntilMs = Math.max(state.decayedUntilMs, now);
}
export function multiplier(state: PlasmaBurnerOverloadState): number { return 1 + state.q / 100; }
