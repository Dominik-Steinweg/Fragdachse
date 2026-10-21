import type { CombatRelationshipResult } from './CombatCapabilities';
import type { CombatSource } from './CombatScope';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID } from '../config';

/** Domain descriptors supplied by the existing World/player relationship view. */
export interface CombatRelationshipFacts {
  readonly sameActor: boolean;
  readonly sourceFaction: 'players' | 'hostile' | 'neutral';
  readonly targetFaction: 'players' | 'hostile' | 'neutral';
  readonly playerPairAreTeammates: boolean;
  readonly bothPlayers: boolean;
  readonly allowTeamDamage: boolean;
}

export function resolveCombatRelationship(facts: CombatRelationshipFacts): CombatRelationshipResult {
  const relationship = facts.sameActor ? 'self'
    : facts.sourceFaction === 'neutral' || facts.targetFaction === 'neutral' ? 'neutral'
      : facts.bothPlayers ? (facts.playerPairAreTeammates ? 'ally' : 'enemy')
        : facts.sourceFaction === facts.targetFaction ? 'ally' : 'enemy';
  return {
    relationship,
    canDamage: relationship === 'self' || relationship === 'enemy' || facts.allowTeamDamage,
    canSupport: relationship === 'self' || relationship === 'ally',
  };
}

/**
 * Seite einer erfassten Quelle: Spieler, Verbündete und eigene Basistürme stehen auf der
 * Spielerseite. Strukturimmunität und die Seitenfarbe von Folgewirkungen lesen dieselbe Regel.
 */
export function isPlayerSideCombatSource(source: Pick<CombatSource, 'allegiance' | 'actor' | 'gameplaySource'>): boolean {
  const allegiance = source.allegiance;
  return (allegiance.kind ?? source.actor?.kind ?? source.gameplaySource.kind) === 'player' || allegiance.factionId === 'allied'
    || allegiance.ownerId === COOP_DEFENSE_BASE_TURRET_OWNER_ID;
}
