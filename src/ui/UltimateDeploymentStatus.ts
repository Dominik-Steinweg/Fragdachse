import { ULTIMATE_CONFIGS } from '../loadout/LoadoutConfig';
import type { FireControlSnapshot } from '../systems/fireControl/FireControlSnapshot';
import type { BomberSquadronSnapshot } from '../systems/bomberSquadron/BomberSquadronSnapshot';

/** Ultimate-Arten, deren laufender Einsatz eine replizierte Restzeit besitzt. */
export type UltimateDeploymentKind = 'holo_offensive' | 'bomber_squadron';

export function getUltimateDeploymentKind(activeUltimateId: string | null | undefined): UltimateDeploymentKind | null {
  const type = activeUltimateId ? ULTIMATE_CONFIGS[activeUltimateId as keyof typeof ULTIMATE_CONFIGS]?.type : undefined;
  return type === 'holo_offensive' || type === 'bomber_squadron' ? type : null;
}

/** Restzeit ist nur Projektion; auch ohne Snapshot bleibt ein gemeldeter Einsatz aktiv. */
export function getUltimateDeploymentRemainingMs(
  isActive: boolean,
  kind: UltimateDeploymentKind | null,
  ownerId: string,
  now: number,
  fireControl?: FireControlSnapshot,
  bomberSquadron?: BomberSquadronSnapshot,
): number | null {
  if (!isActive || !kind) return null;
  let endsAt = now;
  if (kind === 'holo_offensive') {
    for (const deployment of fireControl?.deployments ?? []) {
      if (deployment.kind === 'holo' && deployment.ownerId === ownerId) {
        endsAt = Math.max(endsAt, deployment.expiresAt);
      }
    }
  } else {
    for (const squadron of bomberSquadron?.squadrons ?? []) {
      if (squadron.ownerId === ownerId) endsAt = Math.max(endsAt, squadron.endsAt);
    }
  }
  return endsAt - now;
}
