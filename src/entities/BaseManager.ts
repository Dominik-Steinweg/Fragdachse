import * as Phaser from 'phaser';
import type { SyncedBaseState } from '../types';
import { getCoopDefenseBases } from '../arena/BaseRegistry';
import { BaseEntity } from './BaseEntity';

/**
 * Verwaltet alle aktiven Coop-Defense-Basen einer Runde.
 *
 * Lebenszyklus:
 *   - Erstellt in ArenaLifecycleCoordinator.buildArena() nur, wenn der Coop-
 *     Defense-Modus aktiv ist.
 *   - Zerstört in tearDownArena().
 *
 * Authorität:
 *   - Host: applyDamage() mutiert HP und broadcasted via HostUpdateCoordinator
 *     (GameState.bases).
 *   - Clients: applySnapshot() konsumiert per-Tick die HP-Werte vom Host.
 *
 * Skalierung:
 *   - Anzahl der Basen entsteht aus getCoopDefenseBases() (BaseRegistry). Keine
 *     Annahme über eine bestimmte Anzahl. Lookup by id O(1) via Map.
 */
export class BaseManager {
  private readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly entities: BaseEntity[] = [];
  private readonly byId = new Map<string, BaseEntity>();

  constructor(scene: Phaser.Scene) {
    this.group = scene.physics.add.staticGroup();
    for (const spec of getCoopDefenseBases()) {
      const entity = new BaseEntity(scene, spec);
      this.entities.push(entity);
      this.byId.set(entity.id, entity);
      this.group.add(entity.getPhysicsBody());
    }
  }

  /** StaticGroup für Player/Projektil-Collider-Injection (HostPhysicsSystem, ProjectileManager). */
  getBaseGroup(): Phaser.Physics.Arcade.StaticGroup {
    return this.group;
  }

  /**
   * Liefert die Tint-Rechtecke als Hitscan-/LoS-Hindernisse (CombatSystem).
   * `null`-Filterung wird vom Consumer übernommen (analog zu rockObjects).
   */
  getObstacleRectangles(): readonly Phaser.GameObjects.Rectangle[] {
    return this.entities.map((e) => e.getPhysicsBody());
  }

  getBases(): readonly BaseEntity[] {
    return this.entities;
  }

  getBase(id: string): BaseEntity | undefined {
    return this.byId.get(id);
  }

  /**
   * Host-only: Schaden auf eine Basis anwenden. In 1.3 ohne Aufrufer
   * (Spieler dürfen die Basis nicht beschädigen); für 1.5 (Gegner) vorbereitet.
   */
  applyDamage(baseId: string, damage: number): void {
    this.byId.get(baseId)?.applyDamage(damage);
  }

  /**
   * Delta-Snapshot für GameState. Sendet nur Basen mit reduzierter HP.
   * Leeres Array (= alle voll) wird vom Bridge-Publish weggelassen → Bandbreite.
   */
  getNetSnapshot(): SyncedBaseState[] {
    const snapshot: SyncedBaseState[] = [];
    for (const entity of this.entities) {
      if (entity.getHp() < entity.getMaxHp()) {
        snapshot.push({ id: entity.id, hp: entity.getHp(), maxHp: entity.getMaxHp() });
      }
    }
    return snapshot;
  }

  /** Client-only: Übernahme des Server-State aus GameState.bases. */
  applySnapshot(snapshot: readonly SyncedBaseState[]): void {
    // Fehlende Einträge = volle HP (Delta-Convention). Erst auf Max setzen,
    // dann gesendete Werte überschreiben.
    for (const entity of this.entities) {
      entity.setHp(entity.getMaxHp());
    }
    for (const remote of snapshot) {
      this.byId.get(remote.id)?.setHp(remote.hp);
    }
  }

  destroy(): void {
    for (const entity of this.entities) entity.destroy();
    this.entities.length = 0;
    this.byId.clear();
    this.group.destroy(true);
  }
}
