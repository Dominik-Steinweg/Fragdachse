/** Single-charge lifetime, independent of death, respawn and equipment changes. */
export type FireControlUtilityState = {
  readonly utilityId: string;
  readonly cooldownDurationMs: number;
} & (
  | { readonly phase: 'active'; readonly deploymentId: number }
  | { readonly phase: 'cooldown'; readonly cooldownUntil: number }
);

export function parseFireControlUtilityState(raw: unknown): FireControlUtilityState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.utilityId !== 'FIRE_CONTROL_RELAY' || typeof s.cooldownDurationMs !== 'number'
    || !Number.isFinite(s.cooldownDurationMs) || s.cooldownDurationMs < 0) return null;
  if (s.phase === 'active' && typeof s.deploymentId === 'number'
    && Number.isSafeInteger(s.deploymentId) && s.deploymentId >= 0) {
    return { utilityId: s.utilityId, cooldownDurationMs: s.cooldownDurationMs, phase: 'active', deploymentId: s.deploymentId };
  }
  if (s.phase === 'cooldown' && typeof s.cooldownUntil === 'number'
    && Number.isFinite(s.cooldownUntil) && s.cooldownUntil >= 0) {
    return { utilityId: s.utilityId, cooldownDurationMs: s.cooldownDurationMs, phase: 'cooldown', cooldownUntil: s.cooldownUntil };
  }
  return null;
}
