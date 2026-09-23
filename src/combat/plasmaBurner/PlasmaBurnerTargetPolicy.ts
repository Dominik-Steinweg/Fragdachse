export type PlasmaBurnerTargetKind = 'player' | 'enemy' | 'decoy' | 'construction' | 'base' | 'rock';
export interface PlasmaBurnerTarget {
  readonly kind: PlasmaBurnerTargetKind;
  readonly id: string;
  readonly key: string;
  readonly category: 'combatant' | 'structure' | 'environment';
  readonly x: number;
  readonly y: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly damageable: boolean;
  readonly supportable: boolean;
  readonly self: boolean;
  readonly automatic: boolean;
}

/** One eligibility matrix for direct contact, chain, lock and support projectiles. */
export function plasmaBurnerTargetEffect(target: PlasmaBurnerTarget, mode: 'direct' | 'automatic'): 'damage' | 'heal' | null {
  if (!target.alive || (mode === 'direct' && target.self)) return null;
  if (mode === 'automatic' && (!target.automatic || target.category === 'environment')) return null;
  if (target.supportable && target.kind !== 'enemy' && target.kind !== 'decoy')
    return mode === 'direct' || target.hp < target.maxHp ? 'heal' : null;
  return target.damageable ? 'damage' : null;
}

export interface PlasmaBurnerTargetCatalogPort {
  read(key: string, ownerId: string, fromX: number, fromY: number): PlasmaBurnerTarget | null;
  query(ownerId: string, x: number, y: number, radius: number): readonly PlasmaBurnerTarget[];
}
