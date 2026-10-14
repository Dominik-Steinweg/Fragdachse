import type { LobbyMenu } from '../config/authoring/lobbyBuildings';
import type { InteractionCandidate } from './WorldInteractionSelection';
import type { AutomatedTurret } from './TurretSystem';
import type { ShootingRangeRequest } from '../shootingRange/ShootingRangeContracts';

export type WorldInteractionCandidate = InteractionCandidate & { readonly label: string; readonly worldRevision: number } & (
  | { readonly kind: 'watchtower'; readonly structureId: number; readonly exitRevision?: number }
  | { readonly kind: 'turret'; readonly turret: AutomatedTurret }
  | { readonly kind: 'lobby-menu'; readonly menu: LobbyMenu }
  | { readonly kind: 'shooting-range'; readonly request: ShootingRangeRequest }
);
