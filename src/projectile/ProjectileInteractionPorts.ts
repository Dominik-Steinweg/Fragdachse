import type { LoadoutSlot } from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';
import type { ProjectileAllegianceRef, ProjectileProvenance } from './ProjectileSpawnRequest';
import type { ProjectileImpactCandidate } from './ProjectileTargetPort';

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

/** Auftrag an die noch nicht migrierte Direct-Impact-Auflösung. */
export interface ProjectileImpactRequest {
  readonly candidate: ProjectileImpactCandidate;
  readonly contact: ProjectileContactMode;
  readonly nowMs: number;
}

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

/** Ergebnis eines aufgelösten Direct-Impact-Kandidaten. */
export type ProjectileImpactResolution =
  /** Kein Treffer angewendet; der nächste Kandidat darf geprüft werden. */
  | { readonly kind: 'ignored' }
  /** Wirkung angewendet; Dedupe und Verbrauch folgen dem Kontaktmodus. */
  | { readonly kind: 'applied' }
  /** Wirkung angewendet und das Projectile ist dadurch verbraucht. */
  | { readonly kind: 'consumed' }
  /** Target-lokale Defense hat den Treffer aufgelöst. */
  | { readonly kind: 'defended'; readonly defense: ProjectileDefenseResolution };

/**
 * Direct-Impact-Grenze der Collision-Verarbeitung.
 *
 * Sie erhält ausschließlich Kandidat, Kontaktmodus und Host-Zeit und liefert ein typisiertes
 * Ergebnis zurück. Zielcontract ist der `ProjectileCombatPort` aus Phase 7; bis dahin adaptiert sie
 * die bestehende Combat-Auflösung.
 */
export interface ProjectileDirectImpactPort {
  resolveDirectImpact(request: ProjectileImpactRequest): ProjectileImpactResolution;
}

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
