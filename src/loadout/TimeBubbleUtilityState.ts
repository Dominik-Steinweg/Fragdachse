/** Host-owned lifetime of a player's thrown TimeBubble, independent of inventory changes. */
export type TimeBubbleUtilityState = {
  readonly utilityId: string;
  readonly cooldownDurationMs: number;
  readonly focusEnabled: boolean;
  readonly temporaryUtilityInstanceId?: string;
} & (
  | { readonly phase: 'flying'; readonly projectileId: number }
  | { readonly phase: 'active'; readonly bubbleId: number }
  | { readonly phase: 'cooldown'; readonly cooldownUntil: number }
);

export function parseTimeBubbleUtilityState(raw: unknown): TimeBubbleUtilityState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.utilityId !== 'TIME_BUBBLE' || typeof s.focusEnabled !== 'boolean'
    || typeof s.cooldownDurationMs !== 'number' || !Number.isFinite(s.cooldownDurationMs) || s.cooldownDurationMs < 0
    || (s.temporaryUtilityInstanceId !== undefined && (typeof s.temporaryUtilityInstanceId !== 'string'
      || !s.temporaryUtilityInstanceId.length || s.temporaryUtilityInstanceId.length > 80))) return null;
  const value = s.phase === 'flying' ? s.projectileId : s.phase === 'active' ? s.bubbleId : s.phase === 'cooldown' ? s.cooldownUntil : undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || (s.phase !== 'cooldown' && !Number.isSafeInteger(value))) return null;
  return { ...s } as TimeBubbleUtilityState;
}
