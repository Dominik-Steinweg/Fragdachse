import type { LoadoutSlot } from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileAllegianceRef, ProjectileProvenance } from './ProjectileSpawnRequest';

/**
 * Wie ein Projectile ein einzelnes Ziel berührt.
 *
 * Der Modus ergibt sich aus den Fähigkeiten des Projectiles und dem Zieltyp, nicht aus seinem
 * Darstellungsstil. Er entscheidet Dedupe-Gedächtnis und Verbrauch, nicht die Wirkung selbst.
 */
export type ProjectileContactMode =
  /** Support-Payload: die Wirkung verbraucht das Projectile unabhängig vom Ziel. */
  | 'support'
  /** Durchschlag mit Restbudget und Schadensabbau. */
  | 'penetration'
  /** Durchdringt jedes Ziel genau einmal und fliegt weiter. */
  | 'pierce'
  /** Flammen-Hitbox: trifft jedes Ziel einmal, verbraucht sich nie am Ziel. */
  | 'flame'
  /** Verbraucht sich am ersten getroffenen Ziel. */
  | 'single';

/**
 * Auflösung einer target-lokalen Defense (z. B. Energieschild).
 *
 * Die Entscheidung gehört dem Target-Owner; die Projectile-Mutation bleibt beim Projectile-Owner.
 */
export type ProjectileDefenseResolution =
  | { readonly kind: 'absorbed' }
  | {
    readonly kind: 'reflected';
    readonly damageFactor: number;
    readonly attributionId: string;
    readonly allegiance: ProjectileAllegianceRef;
    readonly originX: number;
    readonly originY: number;
    readonly sourceId: string;
    readonly sourceSlot?: LoadoutSlot;
  };

/** Anfrage an eine world-space Barriere entlang der Projectile-Position. */
export interface ProjectileBarrierRequest {
  readonly projectileId: ProjectileId;
  readonly provenance: ProjectileProvenance;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly isGrenade: boolean;
  /** Wurfgeschoss, das die Barriere übernehmen darf (heute: Brut-Granate). */
  readonly capturable: boolean;
  readonly allowTeamDamage: boolean;
  /** Aufgelöster Basisschaden für Shield-/Dome-Feedback; keine Runtime-Records. */
  readonly damage?: number;
  /** Hostautoritative Frame-Zeit dieser Stage. */
  readonly nowMs: number;
}

/** Ergebnis der world-space Barriere; die Projectile-Mutation macht der Projectile-Owner. */
export type ProjectileBarrierResolution =
  | { readonly kind: 'passed' }
  | { readonly kind: 'absorbed' }
  | {
    readonly kind: 'reflected';
    readonly attributionId: string;
    readonly allegiance: ProjectileAllegianceRef;
    readonly angle: number;
    readonly sourceId: string;
    readonly sourceSlot?: LoadoutSlot;
    readonly ownerColor: number;
    /** Übernommene Granate: Granatensemantik und Restzündzeit bleiben erhalten. */
    readonly keepGrenade: boolean;
  };

/**
 * World-space Barriere vor der normalen Target-Interaction (z. B. Energiekuppel).
 *
 * Der konkrete Barrier-Owner bleibt hinter dem Port; die Runtime kennt weder sein System noch
 * seinen Zustand.
 */
export interface ProjectileBarrierPort {
  resolveBarrier(request: ProjectileBarrierRequest): ProjectileBarrierResolution;
}
