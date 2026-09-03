/** Domain relationship read; transport adapters may provide the current authoritative policy. */
export interface PlayerRelationshipPort {
  isEnemyPair(firstPlayerId: string, secondPlayerId: string): boolean;
}
