import type { WeaponConfig } from '../../loadout/LoadoutConfig';
import type { PlasmaBurnerStats } from '../../loadout/PlasmaBurnerConfig';
import type { WeaponSlot } from '../../types';
import type { PlasmaBurnerTarget } from './PlasmaBurnerTargetPolicy';
import type { ProjectileProvenance } from '../../projectile/ProjectileSpawnRequest';

export interface PlasmaBurnerPulseEvent {
  readonly id: string;
  readonly sid?: number;
  readonly lk: boolean;
  readonly m: number;
  /** Number of primary path segments, including portal legs. */
  readonly p: number;
  readonly s: readonly (readonly [number, number, number, number, 0 | 1 | 2])[];
}
export interface PlasmaBurnerOverloadNetState { readonly q: number; readonly qMax: number; readonly building: boolean }
export function isPlasmaBurnerPulseEvent(value: unknown): value is PlasmaBurnerPulseEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as PlasmaBurnerPulseEvent;
  return typeof e.id === 'string' && typeof e.lk === 'boolean' && Number.isFinite(e.m) && e.m >= 1
    && (e.sid === undefined || Number.isSafeInteger(e.sid)) && Array.isArray(e.s)
    && Number.isSafeInteger(e.p) && e.p >= 1 && e.p <= e.s.length
    && e.s.every(s => Array.isArray(s) && s.length === 5 && s.slice(0, 4).every(Number.isFinite) && [0, 1, 2].includes(s[4]));
}
export interface PlasmaBurnerFireRequest {
  readonly playerId: string; readonly config: WeaponConfig; readonly nowMs: number;
  readonly x: number; readonly y: number; readonly angle: number;
  readonly targetX: number; readonly targetY: number;
  readonly sourceSlot?: WeaponSlot; readonly shotId?: number;
  readonly gameplayMuzzleOrigin?: { readonly x: number; readonly y: number };
}
export interface PlasmaBurnerPulseRequest extends PlasmaBurnerFireRequest {
  readonly stats: PlasmaBurnerStats; readonly multiplier: number;
  readonly chainMemberKeys: readonly string[]; readonly lock: string | null;
}
export interface PlasmaBurnerContact {
  readonly target: PlasmaBurnerTarget; readonly effectiveAmount: number; readonly fx: 0 | 1 | 2;
  readonly portalDamage?: import('../../systems/PortalTraversal').PortalDamageContext;
}
export interface PlasmaBurnerPulseOutcome {
  readonly accepted: boolean; readonly contacts: readonly PlasmaBurnerContact[];
  readonly chainMemberKeys: readonly string[]; readonly lock: string | null;
}
export interface PlasmaBurnerChargeImpactRequest {
  readonly targetKey: string; readonly x: number; readonly y: number;
  readonly damage: number; readonly heal: number;
  readonly provenance: ProjectileProvenance; readonly nowMs: number;
}
export interface PlasmaBurnerStructurePort {
  repair(target: PlasmaBurnerTarget, amount: number, ownerId: string): number;
  damage(target: PlasmaBurnerTarget, amount: number, ownerId: string, sourceSlot?: WeaponSlot): number;
  damageBase(target: PlasmaBurnerTarget, amount: number, ownerId: string, sourceSlot?: WeaponSlot, baseDamageMult?: number): number;
}
