import type { InteractionCandidate } from './WorldInteractionSelection';
import type { AutomatedTurret } from './TurretSystem';
import type { ShootingRangeRequest } from '../shootingRange/ShootingRangeContracts';

export type WorldInteractionCandidate = InteractionCandidate & { readonly label: string; readonly worldRevision: number } & (
  | { readonly kind: 'turret'; readonly turret: AutomatedTurret }
  | { readonly kind: 'shooting-range'; readonly request: ShootingRangeRequest }
);
