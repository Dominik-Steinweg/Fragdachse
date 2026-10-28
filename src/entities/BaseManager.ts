import type { StructureRect } from '../arena/StructureOutline';
import type { TurretAnimationController } from '../effects/TurretAnimationController';
import type { WorldHealthBarRenderer } from '../effects/health/WorldHealthBarRenderer';
import * as Phaser from 'phaser';
import { BaseBurnRenderer } from '../effects/BaseBurnRenderer';
import type { EntityBurnGpuController } from '../effects/EntityBurnGpuController';
import type { SyncedBaseState } from '../types';
import type { CoopBaseFaction } from '../config/coopDefenseMaps';
import type { BaseActivityOverlay, BaseSpec } from '../arena/BaseRegistry';
import { BaseEntity, type BaseTurretRuntimeState } from './BaseEntity';
import {
  BASE_LIGHT_COLOR,
  BASE_TURRET_LIGHT_COLOR,
  HOSTILE_BASE_LIGHT_COLOR,
  HOSTILE_BASE_TURRET_LIGHT_COLOR,
} from './BaseVisuals';
import type { LightingSystem } from '../effects/LightingSystem';
import type { CoopDefenseSecondaryObjectiveState } from '../types';
import {
  BaseDestructionRenderer,
  type BaseDestructionHooks,
} from '../effects/BaseDestructionRenderer';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { GroundSurfacePersistentBaseGravelZone } from '../arena/chunks/GroundSurfaceStreamer';
import {
  createPersistentBaseGravelCoverage,
  getPersistentBaseGravelStateKey,
} from '../arena/PersistentBaseGravelField';
import type { WorldIntegrityMutationResult } from '../world/WorldIntegrityMutation';
import { SpawnStructureRenderer, type SpawnStructureShadowCell } from '../effects/spawnStructure/SpawnStructureRenderer';
import type { SpawnStructureView } from '../effects/spawnStructure/SpawnStructureModel';
import { worldCellCenter } from '../world/WorldMetrics';
import { CELL_SIZE } from '../config';
import { BaseFortRenderer, type BaseFortParticleFactory } from '../arena/baseStructures/BaseFortRenderer';
import { isBaseFortLoaded } from '../arena/baseStructures/BaseFortAssets';
import type { ShadowSystem } from '../effects/ShadowSystem';
import type { LobbyStructureSunlight } from '../arena/lobbyStructures/LobbyStructureRenderer';
import type { FogSurfaceStamp } from '../effects/groundFog/FogSurfaceMask';

/**
 * Verwaltet die world-owned Base-Geometrie und bindet bei Bedarf genau einen Activity-Overlay.
 *
 * Lebenszyklus:
 *   - Erstellt in ArenaLifecycleCoordinator.buildWorld() mit World-Grundwerten.
 *   - Ein Coop-Activity-Overlay wird separat angelegt und bei Activity-Ende verworfen.
 *
 * Authorität:
 *   - Host: applyDamage() mutiert HP und broadcasted via HostUpdateCoordinator
 *     (GameState.bases).
 *   - Clients: applySnapshot() konsumiert per-Tick die HP-Werte vom Host.
 *
 * Skalierung:
 *   - Anzahl/Form/World-Identitaet der Basen kommt aus `WorldRuntimeContext.bases`. Activity-
 *     Werte wie HP, Dormanz und Podeste leben nur im gebundenen Overlay. Keine Annahme über eine
 *     bestimmte Anzahl und kein Rueckgriff auf die aktive Lobby-Map. Lookup by id O(1) via Map.
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
  /** Objective-bound bases whose objective has started; only these count as navigation goals. */
  private readonly goalReleasedBaseIds = new Set<string>();
  private getSecondaryObjectiveState: ((objectiveId: string) => CoopDefenseSecondaryObjectiveState | null) | null = null;
  private obstacleGeneration = 0;
  private readonly presentation: boolean;
  private readonly scene: Phaser.Scene;
  private lighting: LightingSystem | null = null;
  private readonly litBaseKeys = new Set<string>();
  private readonly destructionRenderer: BaseDestructionRenderer | null;
  private readonly burnRenderer: BaseBurnRenderer | null;
  private readonly worldMetrics: WorldMetrics;
  private activeActivityBinding: BaseActivityBinding | null = null;
  private persistentBaseGravelKey = 'none';
  private destroyed = false;
  private readonly snapshotSeen = new Set<string>();
  private readonly snapshotById = new Map<string, SyncedBaseState>();
  /** Projection of the live base entities, rebuilt only when obstacleGeneration changes. */
  private movementBlockedCells: Set<number> | null = null;
  private movementBlockedCellsGeneration = -1;
  /** One presentation owner for every spawn structure, in every mode (GDD Spawnbauwerk V1). */
  private readonly structureRenderer: SpawnStructureRenderer | null;
  private readonly spawnStructures: { readonly entity: BaseEntity; readonly wallCells: readonly { x: number; y: number }[] }[] = [];
  private readonly structureViews: SpawnStructureView[] = [];
  /** The persistent core's fort art (GDD Rustikale Basis); null without a core or before its art loads. */
  private readonly fortRenderer: BaseFortRenderer | null;
  private releaseTurretCasters: (() => void) | null = null;
  /** Outline rects of the live outlined structures, rebuilt only when obstacleGeneration changes. */
  private structureRects: readonly StructureRect[] = [];
  private structureRectsGeneration = -1;

  constructor(
    scene: Phaser.Scene,
    baseSpecs: readonly BaseSpec[],
    metrics: WorldMetrics,
    destructionHooks: BaseDestructionHooks = {},
    presentation = true,
    damageable = false,
    healthBars: WorldHealthBarRenderer | null = null,
    turretAnimations: TurretAnimationController | null = null,
    burnGpu: EntityBurnGpuController | null = null,
  ) {
    this.presentation = presentation;
    this.scene = scene;
    this.burnRenderer = presentation && burnGpu ? new BaseBurnRenderer(scene, burnGpu) : null;
    this.worldMetrics = metrics;
    this.group = scene.physics.add.staticGroup();
    this.destructionRenderer = presentation ? new BaseDestructionRenderer(scene, destructionHooks) : null;
    // The persistent core and every friendly cell base (outposts, middle bases) present as forts.
    this.fortRenderer = presentation && isBaseFortLoaded(scene) && baseSpecs.some((spec) => (
      spec.faction === 'friendly' && spec.surface !== 'none' && spec.role !== 'spawn-point')) ? new BaseFortRenderer(scene) : null;
    for (const spec of baseSpecs) {
      const entity = new BaseEntity(scene, spec, metrics, presentation, damageable, healthBars, turretAnimations, this.fortRenderer);
      entity.setOnDestroyed(() => this.handleBaseDestroyed(entity));
      this.entities.push(entity);
      this.byId.set(entity.id, entity);
      for (const turret of entity.getTurrets()) this.turretOwners.set(turret.id, entity);
      for (const body of entity.getCellBodies()) {
        this.group.add(body);
      }
      if (spec.spawnArea) {
        this.spawnStructures.push({ entity, wallCells: spec.cells.map((cell) => worldCellCenter(metrics, cell.gridX, cell.gridY)) });
      }
    }
    this.structureRenderer = presentation && this.spawnStructures.length > 0 ? new SpawnStructureRenderer(scene) : null;
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

  /** Liefert die aktuelle, aus World-Grundlage und Activity-Overlay abgeleitete Base-Sicht. */
  getBaseSpecs(): readonly BaseSpec[] {
    return this.entities.map((entity) => entity.getSpec());
  }

  /**
   * Erzeugt eine Activity-Bindung, ohne Activity-State im World-Manager festzuschreiben.
   *
   * Das Handle ist tokenisiert: Ein verspätetes Detach einer alten Activity kann niemals den
   * Overlay-State einer inzwischen gebundenen neuen Activity entfernen.
   */
  createActivityBinding(
    overlays: readonly BaseActivityOverlay[],
    onChanged: () => void = () => { /* noop */ },
  ): BaseActivityBinding {
    const overlayById = new Map(overlays.map((overlay) => [overlay.baseId, overlay]));
    if (overlayById.size !== this.entities.length
      || this.entities.some((entity) => !overlayById.has(entity.id))) {
      throw new Error('[BaseManager] Activity base overlay does not match the World bases');
    }

    let attached = false;
    const binding: BaseActivityBinding = {
      attach: () => {
        if (this.destroyed || (attached && this.activeActivityBinding === binding)) return;
        this.activeActivityBinding?.detach();
        attached = true;
        this.activeActivityBinding = binding;
        this.snapshotSeen.clear();
        this.goalReleasedBaseIds.clear();
        for (const entity of this.entities) entity.applyActivityOverlay(overlayById.get(entity.id)!);
        this.rebuildActivityIndexes();
        onChanged();
      },
      detach: () => {
        if (!attached) return;
        attached = false;
        if (this.activeActivityBinding !== binding) return;
        this.activeActivityBinding = null;
        this.burnRenderer?.clear();
        this.structureRenderer?.clearEmergences();
        this.snapshotSeen.clear();
        this.goalReleasedBaseIds.clear();
        for (const entity of this.entities) entity.clearActivityOverlay();
        this.rebuildActivityIndexes();
        onChanged();
      },
    };
    return binding;
  }

  /** Activates each dormant base once the linked objective has left `dormant`. */
  syncDormantStates(): void {
    for (const entity of this.entities) {
      const objectiveId = entity.getSpec().dormantObjectiveId;
      if (!entity.isDormant() || !objectiveId) continue;
      const objectiveState = this.getSecondaryObjectiveState?.(objectiveId) ?? null;
      if (!objectiveState || objectiveState === 'dormant') continue;
      if (!entity.activate()) continue;
      this.goalReleasedBaseIds.add(entity.id);
      for (const body of entity.getCellBodies()) this.group.add(body);
      for (const turret of entity.getTurrets()) this.turretOwners.set(turret.id, entity);
      this.obstacleGeneration += 1;
      this.onBaseActivated?.(entity.getSpec());
    }
    this.releaseObjectiveGoals();
  }

  /**
   * A structure that stands from the start (`activeFromStart`) never goes through `activate()`. Its objective
   * starting is the moment it becomes a navigation goal, announced through the same activation path.
   */
  private releaseObjectiveGoals(): void {
    for (const entity of this.entities) {
      const objectiveId = entity.getSpec().dormantObjectiveId;
      if (!objectiveId || entity.isInert() || this.goalReleasedBaseIds.has(entity.id)) continue;
      const objectiveState = this.getSecondaryObjectiveState?.(objectiveId) ?? null;
      if (!objectiveState || objectiveState === 'dormant') continue;
      this.goalReleasedBaseIds.add(entity.id);
      this.onBaseActivated?.(entity.getSpec());
    }
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    this.structureRenderer?.setLighting(lighting);
    this.fortRenderer?.setLighting(lighting);
  }

  /**
   * Shadow system and particle backend lent by the World presentation: the fort's bearing and
   * particles, and the mesh shadows of every mounted base turret.
   */
  setFortPresentation(shadows: Pick<ShadowSystem, 'getLongCasterFrame' | 'turretCasters'> | null,
    particles: BaseFortParticleFactory | null = null): void {
    this.fortRenderer?.setShadows(shadows);
    this.fortRenderer?.setParticles(particles);
    this.releaseTurretCasters?.();
    // Mounted base turrets stand on their base cells.
    this.releaseTurretCasters = shadows?.turretCasters.addSource(visit => {
      for (const entity of this.entities) entity.forEachTurretSprite(sprite => visit(sprite, true));
    }) ?? null;
  }

  setFortSunlight(sunlight: LobbyStructureSunlight | null): void {
    this.fortRenderer?.setSunlight(sunlight);
  }

  /** Solid stamps of the persistent fort for the ground fog. */
  getFortFogSurfaces(): Iterable<FogSurfaceStamp> {
    return this.fortRenderer?.getFogSurfaces() ?? [];
  }

  /** Activity input: announced release of a spawn structure (0..1); cleared when the Activity detaches. */
  setSpawnStructureChargeProvider(charge: ((baseId: string, nowMs: number) => number) | null): void {
    this.structureRenderer?.setChargeProvider(charge);
  }

  /**
   * Presentation port for bodies created underground (EnemyManager): a body inside a living spawn
   * structure's pit rises through its brood pool instead of the generic burrow dust.
   */
  readonly spawnEmergence = {
    claim: (enemyId: string, x: number, y: number): boolean => {
      const renderer = this.structureRenderer;
      if (!renderer) return false;
      for (const { entity } of this.spawnStructures) {
        const area = entity.getSpec().spawnArea!;
        const half = area.widthCells * CELL_SIZE / 2;
        if (entity.isDestroyed() || Math.abs(x - area.x) > half || Math.abs(y - area.y) > half) continue;
        renderer.addEmergence(entity.id, enemyId, x - area.x, y - area.y, this.scene.time.now);
        return true;
      }
      return false;
    },
    surfaced: (enemyId: string): void => this.structureRenderer?.surfaceEmergence(enemyId, this.scene.time.now),
    release: (enemyId: string): void => this.structureRenderer?.releaseEmergence(enemyId),
  };

  /** Wall cells of the spawn structures as shadow casters (their sprites are not cell images). */
  getSpawnStructureShadowCells(): Iterable<SpawnStructureShadowCell> {
    return this.structureRenderer?.getShadowCells() ?? [];
  }

  /** Spawn structure buildings for the ground fog's surface mask. */
  getSpawnStructureFogSurfaces(): Iterable<Phaser.GameObjects.Image> {
    return this.structureRenderer?.getFogSurfaces() ?? [];
  }

  /**
   * Mirrors the ground streamer's base-site gravel (same zone, same contract), so the bases'
   * grounding turns into compacted gravel where they stand on it. Unchanged zones cost nothing.
   */
  setPersistentBaseGravel(zone: GroundSurfacePersistentBaseGravelZone | null): void {
    const key = zone ? getPersistentBaseGravelStateKey(zone.seed, zone.anchor, zone.buildArea) : 'none';
    if (key === this.persistentBaseGravelKey || !this.presentation) return;
    this.persistentBaseGravelKey = key;
    const metrics = this.worldMetrics;
    const gravel = zone ? createPersistentBaseGravelCoverage(zone, {
      offsetX: metrics.offsetX, offsetY: metrics.offsetY, width: metrics.widthPx, height: metrics.heightPx,
    }) : null;
    for (const entity of this.entities) entity.setGroundGravel(gravel);
  }

  /**
   * Pro Frame wenige große Standlichter je lebender Basis sowie ein kräftigeres Licht pro
   * Basisturm. Wird aus der Beleuchtungsphase von `ArenaScene` aufgerufen. Zerstörte
   * Basen geben ihre Lichter frei; ein `setLight` je Frame hält die keyed-Lichter am Leben.
   */
  syncLights(): void {
    this.burnRenderer?.sync(this.entities, this.worldMetrics, this.lighting);
    this.fortRenderer?.update();
    this.syncSpawnStructures();
    const lighting = this.lighting;
    if (!this.presentation || !lighting) return;

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

  private syncSpawnStructures(): void {
    if (!this.structureRenderer) return;
    const views = this.structureViews;
    views.length = 0;
    const live = this.activeActivityBinding !== null;
    for (const { entity, wallCells } of this.spawnStructures) {
      const area = entity.getSpec().spawnArea!;
      views.push({
        id: entity.id, x: area.x, y: area.y, outlet: area.outlet, hp: entity.getHp(), maxHp: entity.getMaxHp(),
        dormant: entity.isDormant(), destroyed: entity.isDestroyed(), live, hpRevision: entity.getHpBaselineRevision(), wallCells,
      });
    }
    this.structureRenderer.sync(views, this.scene.time.now);
  }

  /** Gibt alle Basislichter frei (Teardown). */
  releaseLights(): void {
    this.burnRenderer?.clear();
    this.structureRenderer?.releaseLights();
    this.fortRenderer?.releaseLights();
    if (!this.lighting) return;
    for (const key of this.litBaseKeys) this.lighting.releaseLight(key);
    this.litBaseKeys.clear();
  }

  /** StaticGroup für Player/Projektil-Collider-Injection. */
  getBaseGroup(): Phaser.Physics.Arcade.StaticGroup {
    return this.group;
  }

  /** Live movement lookup; dormant and destroyed bases are not blockers. */
  isMovementBlockedCell(gridX: number, gridY: number): boolean {
    if (
      !Number.isInteger(gridX)
      || !Number.isInteger(gridY)
      || gridX < 0
      || gridY < 0
      || gridX >= this.worldMetrics.gridCols
      || gridY >= this.worldMetrics.gridRows
    ) {
      return false;
    }

    if (
      this.movementBlockedCells === null
      || this.movementBlockedCellsGeneration !== this.obstacleGeneration
    ) {
      const cells = new Set<number>();
      for (const entity of this.entities) {
        if (entity.isInert()) continue;
        for (const cell of entity.spec.movementCells ?? entity.spec.cells) {
          cells.add(cell.gridY * this.worldMetrics.gridCols + cell.gridX);
        }
      }
      this.movementBlockedCells = cells;
      this.movementBlockedCellsGeneration = this.obstacleGeneration;
    }

    return this.movementBlockedCells.has(gridY * this.worldMetrics.gridCols + gridX);
  }

  /**
   * Liefert die Per-Zell-Rectangles aller noch lebenden Basen als
   * Hitscan-/LoS-Hindernisse (WorldCombatCore). Flach gemerged über alle Basen.
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

  /**
   * World-pixel outline rects of all live outlined structures. The same array is returned until
   * a base changes, so per-frame consumers can compare by identity.
   */
  getStructureRects(): readonly StructureRect[] {
    if (this.structureRectsGeneration !== this.obstacleGeneration) {
      this.structureRects = this.entities.flatMap(entity => entity.isInert() ? [] : entity.spec.collisionRects ?? []);
      this.structureRectsGeneration = this.obstacleGeneration;
    }
    return this.structureRects;
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

  /**
   * Bases enemies may navigate to. Like `getActiveBaseIds`, but an objective-bound structure only counts once its
   * objective has started: before that it can lie behind barriers, and a goal no spawn can reach leaves every
   * ground enemy without a path.
   */
  getNavigationBaseIds(): ReadonlySet<string> {
    const result = new Set<string>();
    for (const entity of this.entities) {
      if (entity.isInert()) continue;
      if (entity.getSpec().dormantObjectiveId !== undefined && !this.goalReleasedBaseIds.has(entity.id)) continue;
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

  /** Same HP source for host mutations and applied client snapshots. */
  /** Planning view only: fades a fallen base out or back in (see `BaseEntity.setFallen`). */
  setFallen(baseId: string, fallen: boolean, immediate = false): void {
    this.byId.get(baseId)?.setFallen(fallen, immediate);
  }

  getStructureHp(baseId: string): number | null {
    return this.byId.get(baseId)?.getHp() ?? null;
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
    this.commitDamage(baseId, damage);
  }

  commitDamage(baseId: string, damage: number): WorldIntegrityMutationResult {
    return this.byId.get(baseId)?.commitDamage(damage) ?? { kind: 'missing' };
  }

  /** Host-only: Heilt eine Basis bis zum Maximum (z.B. Energie-Kuppel). */
  heal(baseId: string, amount: number): void {
    this.commitRepair(baseId, amount);
  }

  commitRepair(baseId: string, amount: number): WorldIntegrityMutationResult {
    return this.byId.get(baseId)?.commitRepair(amount) ?? { kind: 'missing' };
  }

  private handleBaseDestroyed(entity: BaseEntity): void {
    this.obstacleGeneration += 1;
    this.movementBlockedCells = null;
    this.onBaseDestroyed?.(entity.getSpec());
    try {
      this.destructionRenderer?.play(
        entity.getSpec(),
        (cellIndex) => entity.destroyCellVisual(cellIndex),
      );
    } catch (error) {
      console.error('[BaseManager] Destruction presentation failed', error);
    }
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
      if (entity.getHp() < entity.getMaxHp() || turrets.length > 0 || entity.isVoidBurning()) {
        snapshot.push({
          id: entity.id,
          hp: entity.getHp(),
          maxHp: entity.getMaxHp(),
          ...(entity.isVoidBurning() ? { voidBurning: true } : {}),
          turrets: turrets.length > 0 ? turrets : undefined,
        });
      }
    }
    return snapshot;
  }

  /** Client-only: Übernahme des Server-State aus GameState.bases. */
  applySnapshot(snapshot: readonly SyncedBaseState[]): void {
    // Resolve the net value once: a refresh must not manufacture full-heal/damage pairs.
    this.snapshotById.clear();
    for (const remote of snapshot) this.snapshotById.set(remote.id, remote);
    for (const entity of this.entities) {
      const remote = this.snapshotById.get(entity.id);
      const baseline = !this.snapshotSeen.has(entity.id);
      if (remote) {
        entity.setHp(remote.hp, baseline);
        if (remote.turrets) entity.applyTurretSnapshot(remote.turrets);
      } else if (!entity.isInert()) {
        entity.setHp(entity.getMaxHp(), baseline);
      }
      entity.setVoidBurning(remote?.voidBurning === true);
      if (remote || !entity.isInert()) this.snapshotSeen.add(entity.id);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.activeActivityBinding?.detach();
    this.destroyed = true;
    this.releaseLights();
    this.structureRenderer?.destroy();
    this.destructionRenderer?.destroy();
    this.fortRenderer?.destroy();
    this.releaseTurretCasters?.(); this.releaseTurretCasters = null;
    for (const entity of this.entities) entity.destroy();
    this.entities.length = 0;
    this.byId.clear();
    this.snapshotSeen.clear();
    this.snapshotById.clear();
    this.turretOwners.clear();
    this.movementBlockedCells = null;
    this.movementBlockedCellsGeneration = -1;
    this.group.destroy(true);
  }

  private rebuildActivityIndexes(): void {
    this.destructionRenderer?.reset();
    this.turretOwners.clear();
    for (const entity of this.entities) {
      for (const body of entity.getCellBodies()) this.group.add(body);
      for (const turret of entity.getTurrets()) this.turretOwners.set(turret.id, entity);
    }
    this.obstacleGeneration += 1;
    this.movementBlockedCells = null;
    this.movementBlockedCellsGeneration = -1;
  }
}

export interface BaseActivityBinding {
  readonly attach: () => void;
  readonly detach: () => void;
}

function baseLightKey(baseId: string, index: number): string {
  return `base:${baseId}:${index}`;
}

function baseTurretLightKey(turretId: string): string {
  return `baseturret:${turretId}`;
}
