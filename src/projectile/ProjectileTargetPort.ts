import type { PlaceableKind } from '../types';
import type { HomingTargetValidityChecker } from '../entities/ProjectileHomingController';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/**
 * Kanonische Zielidentität der Projectile-Runtime.
 *
 * Dieselbe physische Entity besitzt innerhalb eines Projectile-Stages genau **eine** Ref. Laufzeit-
 * Placeables (Turm, Podest, Tunnel) laufen über die gemeinsame Fels-/Obstacle-Infrastruktur und
 * werden deshalb als `rock` mit `obstacleKind` normalisiert – nie zusätzlich als `construction`.
 */
export type ProjectileTargetRef =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'enemy'; readonly id: string }
  | { readonly kind: 'decoy'; readonly id: number }
  | { readonly kind: 'rock'; readonly id: number; readonly obstacleKind?: PlaceableKind }
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'train'; readonly id: string }
  | { readonly kind: 'construction'; readonly id: string | number }
  | { readonly kind: 'projectile'; readonly id: ProjectileId };

/** Stabiler lokaler Dedupe-Key eines Ziels; eine Entity ergibt genau einen Key. */
export function projectileTargetKey(target: ProjectileTargetRef): string {
  return `${target.kind}:${target.id}`;
}

/**
 * Key-Raum der Homing-/Explosionsausschlüsse.
 *
 * Homing-Kandidaten kommen mit ihren eigenen Typnamen (`players`, `enemies`, …) herein; der
 * Ausschluss einer laufenden Mehrfachexplosion teilt diesen Raum bewusst mit ihnen.
 */
export function projectileExclusionKey(target: ProjectileTargetRef): string | null {
  if (target.kind === 'player') return `players:${target.id}`;
  if (target.kind === 'enemy') return `enemies:${target.id}`;
  if (target.kind === 'base') return `bases:${target.id}`;
  return null;
}

/** Zieltypen, die über die Collision-Kandidatenerzeugung laufen. */
export type ProjectileCollisionTargetKind = 'player' | 'enemy' | 'decoy';

/**
 * Nimmt ein kollidierbares Ziel in die Frame-Sicht auf.
 *
 * Die Grenze überträgt bewusst nur Primitiven: weder Runtime noch Provider halten dabei fremde
 * Entity-Objekte oder erzeugen pro Frame neue Zielobjekte.
 *
 * `ownerId` ist die Entität, deren Beziehung über Selbsttreffer entscheidet (bei Ködern ihr
 * Besitzer); `radius` ist der Trefferkreis der Sweep-Auflösung ohne Projektilradius.
 */
export type ProjectileCollisionTargetSink = (
  kind: ProjectileCollisionTargetKind,
  id: string | number,
  ownerId: string,
  x: number,
  y: number,
  radius: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => void;

/**
 * Schmale, allokationsarme Zielabfrage der Collision-Verarbeitung.
 *
 * Sie liefert kollidierbare Ziele einmal pro Stage in fachlich stabiler Reihenfolge; die Runtime
 * sieht dabei weder Entity-Objekte noch fremde Systeme.
 */
export interface ProjectileCollisionTargetQueryPort {
  readCollisionTargets(sink: ProjectileCollisionTargetSink): void;
}

/** Weltgeometrie entlang eines Travel-Segments; kein zweiter Spatial-Index. */
export interface ProjectileWorldBlockerPort {
  getNearestBlockerDistance(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    ignoreRocks: boolean,
  ): number | null;
}

/**
 * Targetability: darf dieses Projectile dieses Ziel überhaupt treffen?
 *
 * Die Beziehungsentscheidung bleibt beim kanonischen Owner; die Runtime kennt weder `CombatSystem`
 * noch `NetworkBridge`.
 */
export interface ProjectileTargetabilityPort {
  canDamage(
    provenance: ProjectileProvenance,
    target: ProjectileTargetRef,
    allowTeamDamage: boolean,
  ): boolean;
  /** Beziehung zweier Quellen, z. B. für Projectile↔Projectile- und Barrier-Entscheidungen. */
  canDamageOwner(
    provenance: ProjectileProvenance,
    otherOwnerId: string,
    allowTeamDamage: boolean,
  ): boolean;
  /** Homing-Sicht derselben Familie: ist ein bereits gewähltes Ziel noch gültig? */
  readonly isTargetCurrentlyValid: HomingTargetValidityChecker;
}

/** Geometrischer Trefferkandidat ohne jede Domain-Mutation. */
export interface ProjectileImpactCandidate {
  readonly projectileId: ProjectileId;
  readonly target: ProjectileTargetRef;
  readonly x: number;
  readonly y: number;
  readonly distanceAlongTravel?: number;
  readonly source: 'sweep' | 'overlap';
}
