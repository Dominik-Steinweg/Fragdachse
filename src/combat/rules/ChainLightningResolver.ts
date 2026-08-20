import type { ChainLightningConfig } from '../../types';

/**
 * Phaser-freier Zieltyp fuer Kettenblitz-Traversal.
 * Die konkrete Runtime entscheidet, welche Entitaeten als Kandidaten geliefert werden.
 */
export type ChainLightningTargetKind = 'player' | 'enemy' | 'decoy' | 'detonable';

export interface ChainLightningTarget {
  readonly id: string;
  readonly kind: ChainLightningTargetKind;
  readonly x: number;
  readonly y: number;
}

export interface ChainLightningJump {
  readonly jump: number;
  readonly target: ChainLightningTarget;
  readonly damage: number;
  readonly originX: number;
  readonly originY: number;
}

export interface ResolveChainLightningOptions {
  readonly originX: number;
  readonly originY: number;
  /** Bereits mit den Runtime-Multiplikatoren skalierter Primärschaden. */
  readonly baseDamage: number;
  readonly config: ChainLightningConfig;
  /** Typisierte IDs verhindern Kollisionen zwischen Player-/Enemy-/Decoy-IDs. */
  readonly visitedTargetIds?: ReadonlySet<string>;
  /** Kandidatenreihenfolge bleibt bewusst Teil der aktuellen Runtime-Tie-Semantik. */
  readonly getCandidates: (
    originX: number,
    originY: number,
    visitedTargetIds: ReadonlySet<string>,
  ) => readonly ChainLightningTarget[];
  readonly hasLineOfSight: (
    originX: number,
    originY: number,
    targetX: number,
    targetY: number,
  ) => boolean;
  readonly onJump: (jump: ChainLightningJump) => void;
}

export interface ChainLightningResolution {
  readonly jumps: number;
  readonly visitedTargetIds: ReadonlySet<string>;
}

/**
 * Allgemeine Kettenblitz-Traversal- und Schadensentscheidung.
 *
 * Die erste Auswahl beginnt am echten Aufschlagspunkt. Pro Sprung wird das erste
 * sichtbare Ziel mit der kleinsten Distanz gewählt; bei Distanzgleichheit gewinnt die
 * zuerst gelieferte Runtime-Reihenfolge (`<`, nicht `<=`). Dadurch bleibt die bisherige
 * CombatSystem-Tie-Semantik bei der Extraktion unverändert. VFX, Damage-Pipeline,
 * Ressourcen und Zielerfassung bleiben vollständig beim Aufrufer.
 */
export function resolveChainLightning(
  options: ResolveChainLightningOptions,
): ChainLightningResolution {
  const maxJumps = Math.floor(options.config.maxJumps);
  const searchRadius = options.config.searchRadius;
  const radiusSq = searchRadius * searchRadius;
  const falloffPerJump = Math.max(0, options.config.damageFalloffPerJump);
  const visitedTargetIds = new Set(options.visitedTargetIds ?? []);

  if (maxJumps <= 0 || options.baseDamage <= 0) {
    return { jumps: 0, visitedTargetIds };
  }

  let originX = options.originX;
  let originY = options.originY;
  let jumps = 0;

  for (let jump = 1; jump <= maxJumps; jump += 1) {
    let best: ChainLightningTarget | undefined;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

    for (const candidate of options.getCandidates(originX, originY, visitedTargetIds)) {
      if (visitedTargetIds.has(candidate.id)) continue;
      const dx = candidate.x - originX;
      const dy = candidate.y - originY;
      const distanceSq = dx * dx + dy * dy;
      // Strict comparisons preserve the old first-encountered tie behavior.
      if (distanceSq > radiusSq || distanceSq >= bestDistanceSq) continue;
      if (!options.hasLineOfSight(originX, originY, candidate.x, candidate.y)) continue;
      best = candidate;
      bestDistanceSq = distanceSq;
    }

    if (!best) break;

    visitedTargetIds.add(best.id);
    const damage = options.baseDamage * Math.max(0, 1 - falloffPerJump * jump);
    options.onJump({
      jump,
      target: best,
      damage,
      originX,
      originY,
    });
    originX = best.x;
    originY = best.y;
    jumps += 1;
  }

  return { jumps, visitedTargetIds };
}

