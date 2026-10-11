import type { ProjectileGrenadePayloadRequest } from './ProjectileExplosionPort';
import type { KrakenBroodPort } from '../systems/KrakenState';

/** Terminal dispatch only. Brood owns validation, incubation and stale/duplicate rejection. */
export function routeKrakenEggLanding(request: ProjectileGrenadePayloadRequest, landedAt: number, brood: KrakenBroodPort | null): boolean {
  if (request.effect.type !== 'kraken_egg_land') return false;
  brood?.landEgg({ ...request, effect: request.effect, landedAt });
  return true;
}
