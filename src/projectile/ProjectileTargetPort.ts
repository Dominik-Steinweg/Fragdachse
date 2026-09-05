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
 * Physical identity used while composing one immutable target view.
 *
 * Runtime constructions are backed by the shared rock/obstacle representation. If an adapter
 * accidentally exposes the same numeric object once as `rock` and once as `construction`, the
 * collision owner keeps the canonical rock representation instead of creating two hit chances.
 */
export function projectileTargetPhysicalKey(target: ProjectileTargetRef): string {
  if (target.kind === 'rock' || target.kind === 'construction') {
    return `obstacle:${target.id}`;
  }
  return projectileTargetKey(target);
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

/** Alle Zieltypen, die in der kanonischen Collision-Sicht materialisiert werden dürfen. */
export type ProjectileCollisionTargetKind = ProjectileTargetRef['kind'];

/**
 * Nimmt ein kollidierbares Ziel in die Frame-Sicht auf.
 *
 * Die Grenze überträgt bewusst nur Primitiven: weder Runtime noch Provider halten dabei fremde
 * Entity-Objekte oder erzeugen pro Frame neue Zielobjekte.
 *
 * `ownerId` ist die Entität, deren Beziehung über Selbsttreffer entscheidet (bei Ködern ihr
 * Besitzer); `radius` ist der Trefferkreis der Sweep-Auflösung ohne Projektilradius. `obstacleKind`
 * bleibt an der kanonischen `rock`-Ref und verhindert eine parallele Construction-Identität.
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
  obstacleKind?: PlaceableKind,
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

/** Gemeinsamer Contract-Typ für Tests und World-Adapter, ohne Entity-Objekte zu leaken. */
export interface ProjectileCollisionTarget {
  readonly ref: ProjectileTargetRef;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly active: boolean;
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
  readonly normal?: { readonly x: number; readonly y: number };
  readonly source: 'sweep' | 'overlap' | 'physics-collider' | 'world-boundary';
}

/** Exported with the target contract so collision modes cannot be reintroduced via style names. */
export type { ProjectileCollisionMode } from '../types';
