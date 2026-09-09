import type { PortalPair } from '../systems/PortalTraversal';

/** Replicated projection of TranslocatorSystem's single authoritative use. Null means ready. */
export type TranslocatorUseState = {
  readonly useId: string;
  readonly utilityId: 'TRANSLOCATOR';
  readonly temporaryUtilityInstanceId?: string;
  readonly cooldownDurationMs: number;
} & (
  | { readonly phase: 'puck'; readonly projectileId: number }
  | { readonly phase: 'portals'; readonly pair: PortalPair }
  | { readonly phase: 'cooldown'; readonly cooldownUntil: number }
);

export function parseTranslocatorUseState(raw: unknown): TranslocatorUseState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (s.utilityId !== 'TRANSLOCATOR' || typeof s.useId !== 'string' || !s.useId.length || s.useId.length > 160
    || !nonnegative(s.cooldownDurationMs)
    || (s.temporaryUtilityInstanceId !== undefined && (typeof s.temporaryUtilityInstanceId !== 'string'
      || !s.temporaryUtilityInstanceId.length || s.temporaryUtilityInstanceId.length > 80))) return null;
  if (s.phase === 'puck') {
    if (!nonnegative(s.projectileId) || !Number.isSafeInteger(s.projectileId)) return null;
  } else if (s.phase === 'cooldown') {
    if (!nonnegative(s.cooldownUntil)) return null;
  } else if (s.phase === 'portals') {
    const p = s.pair as PortalPair | undefined;
    if (!p || typeof p.id !== 'string' || p.id !== s.useId || typeof p.ownerId !== 'string'
      || !p.a || !p.b || ![p.a.x, p.a.y, p.b.x, p.b.y].every(Number.isFinite)
      || !nonnegative(p.radius) || p.radius === 0 || !nonnegative(p.reentryDistance)
      || p.reentryDistance <= p.radius || !nonnegative(p.damageBonus)
      || !nonnegative(p.createdAt) || !nonnegative(p.expiresAt) || p.expiresAt < p.createdAt) return null;
  } else return null;
  return structuredClone(s) as TranslocatorUseState;
}
