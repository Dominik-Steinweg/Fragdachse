import type { LobbyMenu } from '../config/authoring/lobbyBuildings';
import type { InteractionCandidate } from './WorldInteractionSelection';
import type { AutomatedTurret } from './TurretSystem';
import type { ShootingRangeRequest } from '../shootingRange/ShootingRangeContracts';

/** World-space bounds of the object a Shift interaction acts on; the focus brackets frame exactly this. */
export interface WorldInteractionFootprint {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * `x`/`y`/`radius` drive selection (nearest approach point), `footprint` drives presentation.
 * `label` is the action verb without any key hint; `subject` names the object; `blocked` is a
 * personal denial shown before pressing (Shift still runs the action path, which reports it).
 */
export type WorldInteractionCandidate = InteractionCandidate & {
  readonly label: string;
  readonly subject?: string;
  readonly blocked?: string;
  readonly footprint: WorldInteractionFootprint;
  readonly worldRevision: number;
} & (
  | { readonly kind: 'watchtower'; readonly structureId: number; readonly exitRevision?: number }
  | { readonly kind: 'turret'; readonly turret: AutomatedTurret }
  | { readonly kind: 'lobby-menu'; readonly menu: LobbyMenu }
  | { readonly kind: 'shooting-range'; readonly request: ShootingRangeRequest }
);

/** Presentation-only focus: a selectable candidate or the exit of the object the player occupies. */
export interface WorldInteractionFocus {
  readonly key: string;
  readonly label: string;
  readonly subject?: string;
  readonly blocked?: string;
  readonly footprint: WorldInteractionFootprint;
}

export interface WorldInteractionView {
  readonly focus: WorldInteractionFocus | null;
  /** Other reachable targets, nearest first; aiming switches the focus to one of them. */
  readonly alternatives: readonly WorldInteractionFootprint[];
}

export const EMPTY_WORLD_INTERACTION_VIEW: WorldInteractionView = { focus: null, alternatives: [] };

export function cellFootprint(x: number, y: number, size: number): WorldInteractionFootprint {
  return { left: x - size / 2, top: y - size / 2, right: x + size / 2, bottom: y + size / 2 };
}
