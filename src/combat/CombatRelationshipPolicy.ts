import type { CombatRelationshipResult } from './CombatCapabilities';

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
