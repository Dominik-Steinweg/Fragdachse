import * as Phaser from 'phaser';
import { TEAM_BLUE_COLOR, TEAM_RED_COLOR } from '../config';
import type { SyncedBaseState } from '../types';
import type { CoopBaseFaction } from '../config/coopDefenseMaps';
import { getCoopDefenseBases, type BaseSpec } from '../arena/BaseRegistry';
import { BaseEntity, type BaseTurretRuntimeState } from './BaseEntity';
import { mixColors } from '../effects/EffectUtils';
import type { LightingSystem } from '../effects/LightingSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../types';
import {
  BaseDestructionRenderer,
  type BaseDestructionHooks,
} from '../effects/BaseDestructionRenderer';

/** Aufgehellte Teamfarbe der Basis: als Licht braucht es alle drei Kanäle. */
const BASE_LIGHT_COLOR = mixColors(TEAM_BLUE_COLOR, 0xffffff, 0.5);
/** Basistürme lesen sich mit einem helleren, konzentrierteren Kern klar vom Sockel ab. */
const BASE_TURRET_LIGHT_COLOR = mixColors(TEAM_BLUE_COLOR, 0xffffff, 0.72);
/** Gegnerbasen leuchten in derselben Helligkeit, aber in der Farbe des roten Teams. */
const HOSTILE_BASE_LIGHT_COLOR = mixColors(TEAM_RED_COLOR, 0xffffff, 0.5);
const HOSTILE_BASE_TURRET_LIGHT_COLOR = mixColors(TEAM_RED_COLOR, 0xffffff, 0.72);

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
 *   - Anzahl/Form/HP der Basen entsteht aus `getCoopDefenseBases()` (BaseRegistry,
 *     gespeist aus der datengetriebenen Coop-Defense-Map-Konfiguration). Keine Annahme über eine
 *     bestimmte Anzahl. Lookup by id O(1) via Map.
 *
 * Zerstörung:
 *   - Beim ersten HP→0-Übergang einer Basis ruft die `BaseEntity` ihren Callback,
 *     den der Manager an `onBaseDestroyed` weiterleitet (Verdrahtung im
 *     ArenaLifecycleCoordinator: rebuild des Flow-Fields → Gegner steuern die
 *     nächstgelegene verbleibende Basis an).
 */
export class BaseManager {
  private readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly entities: BaseEntity[] = [];
  private readonly byId = new Map<string, BaseEntity>();
  private readonly turretOwners = new Map<string, BaseEntity>();
  private onBaseDestroyed: ((spec: BaseSpec) => void) | null = null;
  private onBaseActivated: ((spec: BaseSpec) => void) | null = null;
  private getSecondaryObjectiveState: ((objectiveId: string) => CoopDefenseSecondaryObjectiveState | null) | null = null;
  private obstacleGeneration = 0;
  private lighting: LightingSystem | null = null;
  private readonly litBaseKeys = new Set<string>();
  private readonly destructionRenderer: BaseDestructionRenderer;

  constructor(
    scene: Phaser.Scene,
    baseSpecs: readonly BaseSpec[] = getCoopDefenseBases(),
    destructionHooks: BaseDestructionHooks = {},
  ) {
    this.group = scene.physics.add.staticGroup();
    this.destructionRenderer = new BaseDestructionRenderer(scene, destructionHooks);
    for (const spec of baseSpecs) {
      const entity = new BaseEntity(scene, spec);
      entity.setOnDestroyed(() => this.handleBaseDestroyed(entity));
      this.entities.push(entity);
      this.byId.set(entity.id, entity);
      for (const turret of entity.getTurrets()) this.turretOwners.set(turret.id, entity);
      for (const body of entity.getCellBodies()) {
        this.group.add(body);
      }
    }
  }

  /** Registriert den Zerstörungs-Callback (vom ArenaLifecycleCoordinator). */
  setOnBaseDestroyed(callback: ((spec: BaseSpec) => void) | null): void {
    this.onBaseDestroyed = callback;
  }

  /** Registriert den gemeinsamen Folgereaktionspfad fuer die monotone Dormanz-Aktivierung. */
  setOnBaseActivated(callback: ((spec: BaseSpec) => void) | null): void {
    this.onBaseActivated = callback;
  }

  /**
   * B2 liest den bereits replizierten B1-Objective-Zustand. Die Map-/Base-Identitaet bleibt lokal;
   * ein zusaetzlicher Basis-Netzwerkpfad ist damit nicht noetig.
   */
  setSecondaryObjectiveStateProvider(
    provider: ((objectiveId: string) => CoopDefenseSecondaryObjectiveState | null) | null,
  ): void {
    this.getSecondaryObjectiveState = provider;
    this.syncDormantStates();
  }

  /** Activates each dormant base once the linked objective has left `dormant`. */
  syncDormantStates(): void {
    for (const entity of this.entities) {
      const objectiveId = entity.spec.dormantObjectiveId;
      if (!entity.isDormant() || !objectiveId) continue;
      const objectiveState = this.getSecondaryObjectiveState?.(objectiveId) ?? null;
      if (!objectiveState || objectiveState === 'dormant') continue;
      if (!entity.activate()) continue;
      for (const body of entity.getCellBodies()) this.group.add(body);
      for (const turret of entity.getTurrets()) this.turretOwners.set(turret.id, entity);
      this.obstacleGeneration += 1;
      this.onBaseActivated?.(entity.spec);
    }
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  /**
   * Pro Frame wenige große Standlichter je lebender Basis sowie ein kräftigeres Licht pro
   * Basisturm. Wird aus der Beleuchtungsphase von `ArenaScene` aufgerufen. Zerstörte
   * Basen geben ihre Lichter frei; ein `setLight` je Frame hält die keyed-Lichter am Leben.
   */
  syncLights(): void {
    const lighting = this.lighting;
    if (!lighting) return;

    const seen = new Set<string>();
    for (const entity of this.entities) {
      const spots = entity.getLightSpots();
      const hostile = entity.faction === 'hostile';
      for (let index = 0; index < spots.length; index += 1) {
        const spot = spots[index];
        const key = baseLightKey(entity.id, index);
        lighting.setLight(key, 'baseGlow', spot.x, spot.y, {
          radiusPx: spot.radius,
          color: hostile ? HOSTILE_BASE_LIGHT_COLOR : BASE_LIGHT_COLOR,
        });
        seen.add(key);
      }
      for (const turret of entity.getTurrets()) {
        const key = baseTurretLightKey(turret.id);
        lighting.setLight(key, 'spore_turret', turret.x, turret.y, {
          color: hostile ? HOSTILE_BASE_TURRET_LIGHT_COLOR : BASE_TURRET_LIGHT_COLOR,
        });
        seen.add(key);
      }
    }

    for (const key of this.litBaseKeys) {
      if (!seen.has(key)) lighting.releaseLight(key);
    }
    this.litBaseKeys.clear();
    for (const key of seen) this.litBaseKeys.add(key);
  }

  /** Gibt alle Basislichter frei (Teardown). */
  releaseLights(): void {
    if (!this.lighting) return;
    for (const key of this.litBaseKeys) this.lighting.releaseLight(key);
    this.litBaseKeys.clear();
  }

  /** StaticGroup für Player/Projektil-Collider-Injection. */
  getBaseGroup(): Phaser.Physics.Arcade.StaticGroup {
    return this.group;
  }

  /**
   * Liefert die Per-Zell-Rectangles aller noch lebenden Basen als
   * Hitscan-/LoS-Hindernisse (CombatSystem). Flach gemerged über alle Basen.
   */
  getObstacleRectangles(): readonly Phaser.GameObjects.Rectangle[] {
    const result: Phaser.GameObjects.Rectangle[] = [];
    for (const entity of this.entities) {
      if (entity.isInert()) continue;
      for (const body of entity.getCellBodies()) result.push(body);
    }
    return result;
  }

  /**
   * Zählt hoch, sobald eine Basis zerstört wird – auf Host und Client, da der Übergang
   * in `BaseEntity.setHp()` beidseitig läuft. Verbraucher, die aus
   * `getObstacleRectangles()` einen Cache aufbauen (dynamische Lichtverdeckung), können
   * daran erkennen, dass er ungültig geworden ist, ohne eine eigene Basisliste zu führen.
   */
  getObstacleGeneration(): number {
    return this.obstacleGeneration;
  }

  getBases(): readonly BaseEntity[] {
    return this.entities;
  }

  /**
   * Basen einer Fraktion. Der Standardaufruf `getBases()` bleibt fraktionsblind, weil raeumliche
   * Verbraucher (Kollision, Sichtlinien, Lichtverdeckung) alle Basen brauchen.
   */
  getBasesByFaction(faction: CoopBaseFaction): readonly BaseEntity[] {
    return this.entities.filter((entity) => entity.faction === faction);
  }

  getMainBasesByFaction(faction: CoopBaseFaction): readonly BaseEntity[] {
    return this.entities.filter((entity) => entity.role === 'main' && entity.faction === faction);
  }

  getActiveBaseIds(faction?: CoopBaseFaction): ReadonlySet<string> {
    const result = new Set<string>();
    for (const entity of this.entities) {
      if (entity.isInert()) continue;
      if (faction && entity.faction !== faction) continue;
      result.add(entity.id);
    }
    return result;
  }

  getActiveMainBaseIds(faction?: CoopBaseFaction): ReadonlySet<string> {
    const result = new Set<string>();
    for (const entity of this.entities) {
      if (entity.role !== 'main' || entity.isInert()) continue;
      if (faction && entity.faction !== faction) continue;
      result.add(entity.id);
    }
    return result;
  }

  /** Summierte HP einer Fraktion – die Basis der Sieg- und Niederlagebedingung. */
  getTotalHp(faction: CoopBaseFaction): number {
    return this.getBasesByFaction(faction).reduce((sum, entity) => sum + entity.getHp(), 0);
  }

  getTotalMainBaseHp(faction: CoopBaseFaction): number {
    return this.getMainBasesByFaction(faction).reduce((sum, entity) => sum + entity.getHp(), 0);
  }

  getActiveMainBase(faction: CoopBaseFaction): BaseEntity | undefined {
    return this.getMainBasesByFaction(faction).find((entity) => !entity.isDestroyed());
  }

  hasFaction(faction: CoopBaseFaction): boolean {
    return this.entities.some((entity) => entity.faction === faction);
  }

  /**
   * Basis an einem Weltpunkt. Fuer den Hitscan-Pfad, der nur ein Treffer-Rechteck kennt und
   * keinen Zugriff auf das getroffene GameObject hat.
   */
  getBaseIdAtWorldPoint(x: number, y: number): string | undefined {
    for (const entity of this.entities) {
      if (entity.isInert()) continue;
      for (const body of entity.getCellBodies()) {
        const bounds = body.getBounds();
        if (bounds.contains(x, y)) return entity.id;
      }
    }
    return undefined;
  }

  getBase(id: string): BaseEntity | undefined {
    return this.byId.get(id);
  }

  getTurrets(): readonly BaseTurretRuntimeState[] {
    return this.entities.flatMap((entity) => entity.getTurrets());
  }

  setTurretAngle(turretId: string, angle: number): void {
    this.turretOwners.get(turretId)?.setTurretAngle(turretId, angle);
  }

  /**
   * Host-only: Schaden auf eine Basis anwenden. Bei Übergang auf HP ≤ 0
   * triggert die Entity ihren Destroy-Callback, der via `setOnBaseDestroyed`
   * an den Konsumenten weitergereicht wird.
   */
  applyDamage(baseId: string, damage: number): void {
    this.byId.get(baseId)?.applyDamage(damage);
  }

  /** Host-only: Heilt eine Basis bis zum Maximum (z.B. Energie-Kuppel). */
  heal(baseId: string, amount: number): void {
    if (amount <= 0) return;
    const base = this.byId.get(baseId);
    if (!base || base.isInert()) return;
    base.setHp(base.getHp() + amount);
  }

  private handleBaseDestroyed(entity: BaseEntity): void {
    this.obstacleGeneration += 1;
    this.destructionRenderer.play(
      entity.spec,
      (cellIndex) => entity.destroyCellVisual(cellIndex),
    );
    this.onBaseDestroyed?.(entity.spec);
  }

  /**
   * Delta-Snapshot für GameState. Sendet nicht-dormante Basen mit reduzierter HP
   * (einschließlich explizit zerstörter Basen mit HP 0) sowie aktive Basistürme,
   * deren Zielwinkel für die Clients synchronisiert werden muss.
   */
  getNetSnapshot(): SyncedBaseState[] {
    const snapshot: SyncedBaseState[] = [];
    for (const entity of this.entities) {
      // Dormante Strukturen existieren für den Peer noch nicht. Zerstörte aktive
      // Strukturen müssen dagegen einmalig bzw. weiter als HP=0 sichtbar bleiben.
      if (entity.isDormant()) continue;
      const turrets = entity.getSyncedTurretStates();
      if (entity.getHp() < entity.getMaxHp() || turrets.length > 0) {
        snapshot.push({
          id: entity.id,
          hp: entity.getHp(),
          maxHp: entity.getMaxHp(),
          turrets: turrets.length > 0 ? turrets : undefined,
        });
      }
    }
    return snapshot;
  }

  /** Client-only: Übernahme des Server-State aus GameState.bases. */
  applySnapshot(snapshot: readonly SyncedBaseState[]): void {
    // Fehlende Einträge = volle HP und keine synchronisierten Turret-Winkel
    // (Delta-Convention). Erst auf Max setzen, dann gesendete Werte überschreiben.
    // Dormante und bereits zerstörte Basen bleiben vom Reset ausgespart. Dadurch bleibt der
    // authored Startzustand dormanter B2-Strukturen erhalten und ein zerstörter Client-State
    // kann durch ein später fehlendes Delta nicht wiederbelebt werden.
    for (const entity of this.entities) {
      if (entity.isInert()) continue;
      entity.setHp(entity.getMaxHp());
    }
    for (const remote of snapshot) {
      const entity = this.byId.get(remote.id);
      entity?.setHp(remote.hp);
      if (remote.turrets) entity?.applyTurretSnapshot(remote.turrets);
    }
  }

  destroy(): void {
    this.releaseLights();
    this.destructionRenderer.destroy();
    for (const entity of this.entities) entity.destroy();
    this.entities.length = 0;
    this.byId.clear();
    this.turretOwners.clear();
    this.group.destroy(true);
  }
}

function baseLightKey(baseId: string, index: number): string {
  return `base:${baseId}:${index}`;
}

function baseTurretLightKey(turretId: string): string {
  return `baseturret:${turretId}`;
}
