import Phaser from 'phaser';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { DetonableConfig, DetonatorConfig } from '../types';

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
  weaponName:         string;
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

  // Scratch-Objekte für Intersection-Checks (Garbage-Vermeidung)
  private readonly scratchLine = new Phaser.Geom.Line();

  constructor(private projectileManager: ProjectileManager) {}

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
  ): void {
    this.scratchLine.setTo(startX, startY, endX, endY);

    for (const proj of this.projectileManager.getActiveProjectiles()) {
      if (!proj.detonable) continue;
      if (!detonatorCfg.triggerTags.includes(proj.detonable.tag)) continue;
      if (!proj.detonable.allowCrossTeam && proj.ownerId !== shooterId) continue;

      const bounds = proj.sprite.getBounds();
      if (Phaser.Geom.Intersects.LineToRectangle(this.scratchLine, bounds)) {
        this.pendingDetonations.push({
          x:                 proj.sprite.x,
          y:                 proj.sprite.y,
          projectileOwnerId: proj.ownerId,
          detonatorOwnerId:  shooterId,
          effect:            proj.detonable,
          weaponName:        proj.weaponName,
        });
        this.projectileManager.destroyProjectile(proj.id);
      }
    }
  }

  /**
   * Prüft jeden Frame ob Detonator-Projektile auf detonierbare Projektile treffen.
   * Ermöglicht z.B. Raketenwerfer-Raketen, die durch Schüsse detoniert werden können.
   * Aufrufen BEVOR combatSystem.update(), damit zerstörte Objekte nicht doppelt verarbeitet werden.
   */
  checkProjectileDetonations(): void {
    const active       = this.projectileManager.getActiveProjectiles();
    const destroyedIds = new Set<number>();

    for (const det of active) {
      if (!det.detonator || destroyedIds.has(det.id)) continue;

      for (const target of active) {
        if (!target.detonable || destroyedIds.has(target.id)) continue;
        if (det.id === target.id) continue;
        if (!det.detonator.triggerTags.includes(target.detonable.tag)) continue;
        if (!target.detonable.allowCrossTeam && target.ownerId !== det.ownerId) continue;

        if (Phaser.Geom.Intersects.RectangleToRectangle(
          det.sprite.getBounds(),
          target.sprite.getBounds(),
        )) {
          destroyedIds.add(target.id);
          this.pendingDetonations.push({
            x:                 target.sprite.x,
            y:                 target.sprite.y,
            projectileOwnerId: target.ownerId,
            detonatorOwnerId:  det.ownerId,
            effect:            target.detonable,
            weaponName:        target.weaponName,
          });
          this.projectileManager.destroyProjectile(target.id);
        }
      }
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
