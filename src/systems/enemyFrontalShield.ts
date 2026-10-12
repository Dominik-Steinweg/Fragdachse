/**
 * Directional frontal shield carried by an enemy (e.g. the shield charger).
 *
 * The owning activity system decides when a shield is raised and which way it faces; combat only
 * asks this port. The arc rule is shared with the player's energy shield so both block the same
 * way: an attack is blocked when its source lies within `arcDegrees` around the facing.
 */
export interface EnemyFrontalShieldState {
  /** Authoritative world facing of the shield (radians), identical to the body facing. */
  readonly facing: number;
  /** Full opening angle of the blocking arc in degrees. */
  readonly arcDegrees: number;
  /**
   * Optional look of the replicated arc. Physical shields (a modelled prop) only want a thin rim
   * that flashes on blocks; without it the arc uses the energy-shield faction colours.
   */
  readonly presentation?: { readonly color: number; readonly alpha: number; readonly thickness: number };
}

export interface EnemyFrontalShieldPort {
  /** Raised shield of this enemy, or null while lowered, absent or the enemy is not a shield owner. */
  getFrontalShield(enemyId: string): EnemyFrontalShieldState | null;
  /** Presentation hook after a block (flash); never changes gameplay state. */
  onFrontalShieldBlocked?(enemyId: string, nowMs: number): void;
  /** Every raised shield, for presentation/replication. */
  forEachFrontalShield?(visit: (enemyId: string, shield: EnemyFrontalShieldState) => void): void;
}

/** True when a source at (sourceX, sourceY) is inside the arc centred on `facing` at the owner. */
export function isWithinShieldArc(
  ownerX: number, ownerY: number, facing: number, arcDegrees: number, sourceX: number, sourceY: number,
): boolean {
  const dx = sourceX - ownerX, dy = sourceY - ownerY;
  if (dx === 0 && dy === 0) return false;
  let delta = Math.atan2(dy, dx) - facing;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  return Math.abs(delta) <= arcDegrees * Math.PI / 360;
}
