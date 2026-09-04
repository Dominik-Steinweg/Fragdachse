import type {
  ProjectileDetonationOutcome,
  ProjectileExternalInteractionPort,
} from '../projectile/ProjectileExternalInteractionPort';
import type { DetonableConfig, DetonatorConfig, LoadoutSlot } from '../types';

/**
 * Detonations-Ereignis: entsteht wenn ein Projektion mit DetonableConfig
 * durch einen passenden Detonator ausgelöst wird.
 */
export interface DetonationEvent {
  x:                  number;
  y:                  number;
  /** Owner des gezündeten Projektils (für Kill-Attribution) */
  projectileOwnerId:  string;
  /** Spieler, der den Detonator abgefeuert hat */
  detonatorOwnerId:   string;
  effect:             DetonableConfig;
  sourceId:         string;
  sourceSlot?:        LoadoutSlot;
}

/**
 * DetonationSystem – Host-only.
 *
 * Verwaltet das Data-driven Detonations-Framework:
 *  - Hitscan-Detonationen (z.B. ASMD Primary zündet ASMD Secondary-Ball)
 *  - Projektil-Projektil-Detonationen (z.B. Raketenwerfer-Rakete zündet andere Rakete)
 *
 * Flexible Tags erlauben spätere Erweiterungen ohne Code-Änderungen:
 *  - Tag 'asmd_ball' → ASMD Secondary-Ball, zündbar durch ASMD Primary
 *  - Tag 'rocket'    → Rakete, zündbar durch beliebige dafür konfigurierte Waffen
 *
 * Design-Prinzipien:
 *  - Authoritative auf dem Host; Clients erhalten das Ergebnis indirekt über
 *    den bereits vorhandenen broadcastExplosionEffect-RPC-Kanal.
 *  - Ereignisse werden in einer Queue gesammelt und einmalig pro Frame via
 *    flushDetonations() abgerufen und dann von der ArenaScene verarbeitet.
 */
export class DetonationSystem {
  private pendingDetonations: DetonationEvent[] = [];

  constructor(private readonly projectileInteraction: ProjectileExternalInteractionPort) {}

  /**
   * Prüft ob eine Hitscan-Linie detonierbare Projektile schneidet.
   * Wird von CombatSystem.resolveHitscanShot aufgerufen, wenn die
   * feuernde Waffe eine DetonatorConfig besitzt.
   *
   * @param startX / startY  Startpunkt des Hitscan-Strahls
   * @param endX   / endY    Endpunkt (bereits auf Hindernisse/Spieler geclampt)
   * @param shooterId        Spieler-ID des Schützen
   * @param detonatorCfg     welche Tags dieser Schütze auslösen kann
   */
  checkHitscanDetonations(
    startX:       number,
    startY:       number,
    endX:         number,
    endY:         number,
    shooterId:    string,
    detonatorCfg: DetonatorConfig,
    sourceSlot?:  LoadoutSlot,
  ): void {
    const targets = this.projectileInteraction.searchDetonableProjectiles({
      startX,
      startY,
      endX,
      endY,
      shooterId,
      detonator: detonatorCfg,
    });
    for (const target of targets) {
      const outcome = this.projectileInteraction.detonateProjectile(target.id, shooterId);
      if (outcome) this.pendingDetonations.push(toDetonationEvent(outcome, sourceSlot));
    }
  }

  /**
   * Detoniert ein konkret ausgewähltes detonierbares Projektil (z.B. wenn ein
   * Kettenblitz-Sprung gezielt auf einen ASMD-Ball überspringt). Liefert true,
   * wenn das Projektil existierte, detonierbar war und detoniert wurde.
   *
   * @param projectileId      ID des zu detonierenden Projektils
   * @param detonatorOwnerId  Spieler, dem die Detonation zugerechnet wird
   */
  detonateProjectile(projectileId: number, detonatorOwnerId: string): boolean {
    const outcome = this.projectileInteraction.detonateProjectile(projectileId, detonatorOwnerId);
    if (!outcome) return false;
    this.pendingDetonations.push(toDetonationEvent(outcome));
    return true;
  }

  /**
   * Prüft jeden Frame ob Detonator-Projektile auf detonierbare Projektile treffen.
   * Ermöglicht z.B. Raketenwerfer-Raketen, die durch Schüsse detoniert werden können.
   * Aufrufen BEVOR combatSystem.update(), damit zerstörte Objekte nicht doppelt verarbeitet werden.
   */
  checkProjectileDetonations(): void {
    for (const outcome of this.projectileInteraction.detonateOverlappingProjectiles()) {
      this.pendingDetonations.push(toDetonationEvent(outcome));
    }
  }

  /**
   * Gibt alle gesammelten Detonations-Ereignisse zurück und leert die interne Queue.
   * Einmalig pro Host-Frame aufzurufen; Ergebnisse in ArenaScene verarbeiten.
   */
  flushDetonations(): DetonationEvent[] {
    if (this.pendingDetonations.length === 0) return [];
    const events = this.pendingDetonations.slice();
    this.pendingDetonations = [];
    return events;
  }

  /** Aufräumen beim Arena-Teardown */
  reset(): void {
    this.pendingDetonations = [];
  }
}

function toDetonationEvent(
  outcome: ProjectileDetonationOutcome,
  sourceSlot?: LoadoutSlot,
): DetonationEvent {
  return {
    x: outcome.x,
    y: outcome.y,
    projectileOwnerId: outcome.projectileOwnerId,
    detonatorOwnerId: outcome.detonatorOwnerId,
    effect: outcome.effect,
    sourceId: outcome.sourceId,
    sourceSlot: sourceSlot ?? outcome.sourceSlot,
  };
}
