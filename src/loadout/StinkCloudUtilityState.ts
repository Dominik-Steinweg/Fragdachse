/** Player-wide use lock, shared by equipped, temporary and inspector utilities. */
export type StinkCloudUtilityState = {
  readonly utilityId: 'STINK_CLOUD';
  readonly cooldownDurationMs: number;
  readonly temporaryUtilityInstanceId?: string;
} & (
  | { readonly phase: 'active'; readonly cloudId: number; readonly activeUntil: number;
      readonly moveSpeedBonus: number; readonly damageReduction: number }
  | { readonly phase: 'cooldown'; readonly cooldownUntil: number }
);

export function parseStinkCloudUtilityState(raw: unknown): StinkCloudUtilityState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (s.utilityId !== 'STINK_CLOUD' || !finite(s.cooldownDurationMs)
    || (s.temporaryUtilityInstanceId !== undefined && (typeof s.temporaryUtilityInstanceId !== 'string'
      || !s.temporaryUtilityInstanceId.length || s.temporaryUtilityInstanceId.length > 80))) return null;
  if (s.phase === 'active' && Number.isSafeInteger(s.cloudId) && Number(s.cloudId) >= 0
    && finite(s.activeUntil) && finite(s.moveSpeedBonus) && finite(s.damageReduction) && Number(s.damageReduction) <= 1) {
    return { utilityId: 'STINK_CLOUD', cooldownDurationMs: Number(s.cooldownDurationMs), phase: 'active',
      cloudId: Number(s.cloudId), activeUntil: Number(s.activeUntil), moveSpeedBonus: Number(s.moveSpeedBonus),
      damageReduction: Number(s.damageReduction),
      ...(typeof s.temporaryUtilityInstanceId === 'string' ? { temporaryUtilityInstanceId: s.temporaryUtilityInstanceId } : {}) };
  }
  if (s.phase === 'cooldown' && finite(s.cooldownUntil)) return {
    utilityId: 'STINK_CLOUD', cooldownDurationMs: Number(s.cooldownDurationMs), phase: 'cooldown', cooldownUntil: Number(s.cooldownUntil),
    ...(typeof s.temporaryUtilityInstanceId === 'string' ? { temporaryUtilityInstanceId: s.temporaryUtilityInstanceId } : {}),
  };
  return null;
}
