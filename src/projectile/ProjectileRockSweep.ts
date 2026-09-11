import type { ProjectileCollisionMode } from '../types';

/** One rectangular-cell response owner across collider registration, targeting and flight.
 * Includes BaseEntity cells unless sourceCarrierBaseId excludes them at the query boundary. */
export function usesRockSweep(flight: {
  readonly collisionMode?: ProjectileCollisionMode;
  readonly isGrenade?: boolean;
  readonly isFlame?: boolean;
  readonly isBfg?: boolean;
  readonly penetration?: { readonly penetratesRocks?: boolean };
}): boolean {
  return flight.collisionMode === 'sweep' && !flight.isFlame
    && !flight.isBfg && !flight.penetration?.penetratesRocks;
}
