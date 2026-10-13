import type { ResolvedFireControlPortalConfig } from '../world/FireControlUtilityPort';

export const FIRE_CONTROL_UTILITY_IDS = ['FIRE_CONTROL_RELAY', 'FIRE_CONTROL_PORTAL'] as const;
export type FireControlUtilityId = typeof FIRE_CONTROL_UTILITY_IDS[number];

/**
 * Single-charge lifetime per player and utility, independent of death, respawn and equipment
 * changes. Copies: active → cooldown. Portals: flying → active → cooldown.
 */
export type FireControlUtilityState = {
  readonly utilityId: FireControlUtilityId;
  readonly cooldownDurationMs: number;
} & (
  | { readonly phase: 'active'; readonly deploymentId: number }
  | { readonly phase: 'cooldown'; readonly cooldownUntil: number }
  | {
    readonly phase: 'flying'; readonly projectileId: number;
    /** Release point; the landing rule walks back towards it along the straight flight. */
    readonly originX: number; readonly originY: number;
    /** Utility values frozen at release (D31); landing never rereads the loadout. */
    readonly config: ResolvedFireControlPortalConfig;
  }
);

export function isFireControlUtilityId(id: unknown): id is FireControlUtilityId {
  return FIRE_CONTROL_UTILITY_IDS.some(known => known === id);
}

const finite = (n: unknown, min = 0): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min;

export function parseFireControlUtilityState(raw: unknown): FireControlUtilityState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (!isFireControlUtilityId(s.utilityId) || !finite(s.cooldownDurationMs)) return null;
  const head = { utilityId: s.utilityId, cooldownDurationMs: s.cooldownDurationMs };
  if (s.phase === 'active' && typeof s.deploymentId === 'number'
    && Number.isSafeInteger(s.deploymentId) && s.deploymentId >= 0) {
    return { ...head, phase: 'active', deploymentId: s.deploymentId };
  }
  if (s.phase === 'cooldown' && finite(s.cooldownUntil)) {
    return { ...head, phase: 'cooldown', cooldownUntil: s.cooldownUntil };
  }
  const c = s.config as Record<string, unknown> | undefined;
  if (s.phase === 'flying' && s.utilityId === 'FIRE_CONTROL_PORTAL' && typeof s.projectileId === 'number'
    && Number.isSafeInteger(s.projectileId) && finite(s.originX, -Infinity) && finite(s.originY, -Infinity)
    && c && typeof c === 'object' && finite(c.durationMs, 1) && finite(c.cooldownMs) && finite(c.damageBonus)
    && typeof c.localFireRelease === 'boolean' && finite(c.exitClearanceRadiusPx)) {
    return { ...head, phase: 'flying', projectileId: s.projectileId, originX: s.originX, originY: s.originY,
      config: { durationMs: c.durationMs, cooldownMs: c.cooldownMs, damageBonus: c.damageBonus,
        localFireRelease: c.localFireRelease, exitClearanceRadiusPx: c.exitClearanceRadiusPx } };
  }
  return null;
}

export function isFireControlUtilityType(type: string): boolean {
  return type === 'fire_control_relay' || type === 'fire_control_portal';
}
