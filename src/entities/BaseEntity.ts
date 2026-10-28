import { turretAimConfig, type TurretAimConfig } from '../config/turretAim';
import type { TurretAnimationController } from '../effects/TurretAnimationController';
import type { WorldHealthBarRenderer, HealthBarHandle } from '../effects/health/WorldHealthBarRenderer';
import { baseHealthBarStyle } from '../effects/health/healthBarStyles';
import type { WorldMetrics } from '../world/WorldMetrics';
import * as Phaser from 'phaser';
import {
  CELL_SIZE,
  COLORS,
  COOP_DEFENSE_BASE_HP_BAR_FILL,
  COOP_DEFENSE_BASE_HP_BAR_GAP,
  COOP_DEFENSE_HOSTILE_BASE_HP_BAR_FILL,
  DEPTH,
} from '../config';
import type { CoopBaseFaction, CoopBaseTurretWeaponId } from '../config/coopDefenseMaps';
import { UTILITY_CONFIGS, type PlaceableTurretUtilityConfig } from '../loadout/LoadoutConfig';
import { getTurretVisualSpec, getTurretVisualTransform } from '../config/turretVisuals';
import {
  getBaseWorldBounds,
  type BaseActivityOverlay,
  type BaseSpec,
} from '../arena/BaseRegistry';
import { makeAdditive, registerGraphicsObject } from '../effects/EffectUtils';
import type { SyncedBaseTurretState } from '../types';
import { createBaseSurfaceImages, getBaseLightSpots } from './BaseVisuals';
import { BaseGroundingRenderer } from '../arena/BaseGroundingRenderer';
import { nearestStructurePoint } from '../arena/StructureOutline';
import type { PersistentBaseGravelCoverage } from '../arena/PersistentBaseGravelField';
import { BaseAccentGlowRenderer } from '../arena/BaseAccentGlowRenderer';
import type { BaseFortRenderer } from '../arena/baseStructures/BaseFortRenderer';
import type { FortCell } from '../arena/baseStructures/BaseFortKitComposer';
import {
  integrityState,
  type WorldIntegrityMutationResult,
} from '../world/WorldIntegrityMutation';

const EMPTY_LIGHT_SPOTS: readonly { x: number; y: number; radius: number }[] = [];
const VULNERABLE_MARKER_COLOR = 0xc86bff;
/** A fallen base fades out of a planning view over this long, and back in (Bauhof what-if). */
const FALLEN_FADE_MS = 600;
// Base turrets use the shared automated-turret acquisition range, independently of projectile range.
const BASE_TURRET_TARGET_RANGE = (UTILITY_CONFIGS.SPORE_TURRET as PlaceableTurretUtilityConfig).placeable.targetRange;

export interface BaseTurretRuntimeState extends TurretAimConfig {
  readonly id: string;
  readonly baseId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly weaponId: CoopBaseTurretWeaponId;
  readonly targetRange: number;
  readonly faction: CoopBaseFaction;
}

/**
 * Logische und optionale visuelle Repräsentation einer einzelnen Coop-Defense-Basis.
 *
 * Owns:
 *   - Pro Basis-Zelle optional ein 47-Blob-Autotile-Sprite (statt früher: ein Tint-Rect).
 *   - Pro Basis-Zelle immer einen 32×32-StaticBody (alle in derselben StaticGroup),
 *     damit auch konkave Formen physikalisch korrekt abgedeckt werden. Ein Bauwerk mit
 *     Kontur (`collisionRects`) bekommt stattdessen einen StaticBody pro Konturrechteck.
 *   - Eine HP-Bar unter der Bounding-Box der gesamten Basis.
 *
 * Zerstörung:
 *   - Bei HP-Übergang auf ≤ 0 verschwinden Bodies, Türme und HP-Bar sofort.
 *     Die Zell-Sprites werden vom BaseDestructionRenderer gestaffelt entsorgt.
 *   - Ein optionaler `onDestroyed`-Callback wird genau einmal aufgerufen,
 *     so dass der `BaseManager` Folgereaktionen anstoßen kann
 *     (insb. Flow-Field-Rebuild der Wegfindung).
 */
export class BaseEntity {
  readonly id: string;
  readonly spec: BaseSpec;
  readonly faction: CoopBaseFaction;
  readonly role: NonNullable<BaseSpec['role']>;

  private readonly scene: Phaser.Scene;
  private readonly metrics: WorldMetrics;
  private readonly presentation: boolean;
  /**
   * Ob diese Struktur ueberhaupt Schaden kennt.
   *
   * HP sind eine Aussage einer laufenden Activity: Eine Basis kann fallen, weil eine Mission
   * darum gespielt wird. Ohne Activity gibt es kein Missionsziel, also auch keinen HP-Balken und
   * keinen Schaden - das Bauwerk bleibt trotzdem solide und blockiert wie jedes andere.
   */
  private damageable: boolean;
  private voidBurning = false;
  private readonly cellImages: Phaser.GameObjects.Image[] = [];
  private presentationCreated = false;
  /** The fort renderer presents this base (persistent core or kit outpost) instead of cell tiles. */
  private fortPresented = false;
  /** Planning only: a fallen base fades out of view (see `setFallen`); 1 stands. */
  private presence = 1;
  private fallen = false;
  private fallenFade: Phaser.Tweens.Tween | null = null;
  /** The fort's cells as raised shadow receivers while they stand; the fort casts its own shadow. */
  private readonly fortShadowCells: { x: number; y: number; active: boolean; visible: boolean; footprint: false }[] = [];
  private grounding: BaseGroundingRenderer | null = null;
  /** Gravel of a base site below this base, if any; the grounding matches it. */
  private groundGravel: PersistentBaseGravelCoverage | null = null;
  private accentGlow: BaseAccentGlowRenderer | null = null;
  private readonly cellBodies: Phaser.GameObjects.Rectangle[] = [];
  private readonly turretImages = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly turretAngles = new Map<string, number>();
  private healthBar: HealthBarHandle | null = null;
  private readonly hpBarWidth: number;
  /**
   * Fraktionsfarbe fuer das konstante Base-Profil, auch nach einem Activity-Overlay-Reset.
   */
  private readonly hpBarFill: number;
  /**
   * Wenige große Lichtpunkte, die die gesamte Basisfläche plus einen Überhang gleichmäßig
   * ausleuchten. Einmal aus den Bounds abgeleitet.
   */
  private readonly lightSpots: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  private currentHp: number;
  private hpBaselineRevision = 0;
  private maxHp: number;
  private dormant: boolean;
  private activityOverlay: BaseActivityOverlay | null;
  private destroyedBroadcasted = false;
  private onDestroyed: (() => void) | null = null;
  private vulnerableMarker: Phaser.GameObjects.Graphics | null = null;

  constructor(
    scene: Phaser.Scene,
    spec: BaseSpec,
    metrics: WorldMetrics,
    presentation = true,
    damageable = false,
    private readonly healthBars: WorldHealthBarRenderer | null = null,
    private readonly turretAnimations: TurretAnimationController | null = null,
    /** Presents the persistent core as the hand-built fort instead of base tiles (GDD Rustikale Basis). */
    private readonly fort: BaseFortRenderer | null = null,
  ) {
    this.scene = scene;
    this.metrics = metrics;
    this.presentation = presentation;
    this.id = spec.id;
    this.spec = spec;
    this.faction = spec.faction;
    this.role = spec.role ?? 'main';
    this.activityOverlay = damageable ? toActivityOverlay(spec) : null;
    this.damageable = damageable;
    this.maxHp = this.activityOverlay?.hpMax ?? spec.hpMax;
    // Ein authored beschaedigter Startzustand ist Teil der Map und damit auf beiden Peers identisch;
    // repliziert wird erst die spaetere HP-Aenderung.
    this.currentHp = this.activityOverlay?.startHp ?? spec.hpMax;
    this.dormant = this.activityOverlay?.dormant ?? false;
    const hostile = spec.faction === 'hostile';
    this.hpBarFill = hostile ? COOP_DEFENSE_HOSTILE_BASE_HP_BAR_FILL : COOP_DEFENSE_BASE_HP_BAR_FILL;
    const bounds = getBaseWorldBounds(spec.region, metrics);
    this.hpBarWidth = bounds.width;
    this.lightSpots = getBaseLightSpots(bounds);
    for (const turret of this.spec.turrets) this.turretAngles.set(turret.id, turret.initialAngle);
    if (!this.dormant) {
      this.createRuntimeRepresentation();
      if (this.presentation) this.createPresentationRepresentation();
    }
  }

  /** Creates the collision/runtime representation exactly once. */
  private createRuntimeRepresentation(): void {
    if (this.cellBodies.length > 0) return;
    if (this.spec.collisionRects) {
      // One body per outline rect; light occlusion reads the authored exposed edges.
      for (const rect of this.spec.collisionRects) {
        const body = this.scene.add.rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2,
          rect.width, rect.height, 0x000000, 0);
        body.setData('baseId', this.spec.id);
        body.setData('occluderEdges', rect.edges);
        this.scene.physics.add.existing(body, true);
        const staticBody = body.body as Phaser.Physics.Arcade.StaticBody;
        staticBody.setSize(rect.width, rect.height);
        staticBody.updateFromGameObject();
        this.cellBodies.push(body);
      }
      return;
    }
    for (const cell of this.spec.cells) {
      const worldX = this.metrics.offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = this.metrics.offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      const body = this.scene.add.rectangle(worldX, worldY, CELL_SIZE, CELL_SIZE, 0x000000, 0);
      body.setData('baseId', this.spec.id);
      this.scene.physics.add.existing(body, true);
      const staticBody = body.body as Phaser.Physics.Arcade.StaticBody;
      staticBody.setSize(CELL_SIZE, CELL_SIZE);
      staticBody.updateFromGameObject();
      this.cellBodies.push(body);
    }
  }

  /** Creates the optional visual representation exactly once. */
  private createPresentationRepresentation(): void {
    if (this.presentationCreated) return;
    this.presentationCreated = true;
    const hostile = this.spec.faction === 'hostile';
    // Eigenes Void-Tileset mit dunkler Panzerung und violetten Energiefugen.
    const cellTexture = hostile ? 'base_hostile' : 'base';

    // ── 1) 47-Blob-Sprites pro Zelle ────────────────────────────────────
    // Spawnbauwerke zeichnet der SpawnStructureRenderer des BaseManagers (GDD Spawnbauwerk V1), den
    // persistenten Basiskern und die freundlichen Vorposten der BaseFortRenderer: Er bringt Boden, Licht
    // und Schatten selbst mit.
    if (this.isFortCore()) {
      const region = this.spec.region;
      this.fort!.add(this.id, this.metrics.offsetX + (region.minGridX + region.maxGridX + 1) / 2 * CELL_SIZE,
        this.metrics.offsetY + (region.minGridY + region.maxGridY + 1) / 2 * CELL_SIZE, this.fortCells());
      this.presentFort();
    } else if (this.isFortOutpost() && this.fort!.addOutpost(this.id, this.fortCells())) {
      this.presentFort();
      // The kit has no ground of its own: the compacted apron settles the outpost into the map.
      this.grounding = new BaseGroundingRenderer(this.scene, { cells: this.spec.cells }, this.metrics,
        { hostile, gravel: this.groundGravel });
    } else if (this.spec.surface !== 'none' && this.role !== 'spawn-point') {
      this.cellImages.push(...createBaseSurfaceImages(this.scene, this.spec.cells, this.metrics, cellTexture));
      this.grounding = new BaseGroundingRenderer(this.scene, { cells: this.spec.cells }, this.metrics,
        { hostile, gravel: this.groundGravel });
      this.accentGlow = new BaseAccentGlowRenderer(this.scene, this.cellImages, cellTexture);
    } else if (this.spec.collisionRects) {
      // Outlined structures bring their own art, but sit in the same compacted ground.
      this.grounding = new BaseGroundingRenderer(this.scene,
        { cells: this.spec.cells, rects: this.spec.collisionRects }, this.metrics, { hostile, gravel: this.groundGravel });
    }

    // Basistürme sind reine Anbauten: keine eigenen Bodies und keine eigenen HP.
    for (const turret of this.spec.turrets) {
      const visual = getTurretVisualSpec(turret.weaponId);
      const transform = getTurretVisualTransform(visual, turret.x, turret.y, turret.initialAngle);
      // Same band as every turret: above base decks and their own mesh shadow, below figures.
      const image = this.scene.add.sprite(transform.x, transform.y, visual.textureKey)
        .setDisplaySize(visual.displaySize, visual.displaySize)
        .setRotation(transform.rotation)
        .setDepth(DEPTH.ROCKS + 0.2);
      this.turretAnimations?.bind(turret.id, image, turret.weaponId);
      image.setDisplaySize(visual.displaySize, visual.displaySize);
      this.turretImages.set(turret.id, image);
    }

    // ── 2) HP-Bar (eine pro Basis, unter der Bounding-Box) ─────────────
    // Eine unverwundbare Struktur bekommt keine: Ein Balken, der sich nie bewegt, behauptet ein
    // Missionsziel, das es hier nicht gibt.
    if (!this.damageable) return;
    const bounds = getBaseWorldBounds(this.spec.region, this.metrics);
    const centerX = bounds.x + bounds.width / 2;
    // An opening to the south would put the bar into the path of the rising enemies; it moves above.
    const hpBarY = this.spec.spawnArea?.outlet === 'south'
      ? bounds.y - COOP_DEFENSE_BASE_HP_BAR_GAP
      : bounds.y + bounds.height + COOP_DEFENSE_BASE_HP_BAR_GAP;
    if (!this.healthBars?.isValid(this.healthBar)) {
      this.healthBar = this.healthBars?.bind(baseHealthBarStyle(this.hpBarWidth, this.hpBarFill),
        this.currentHp, this.maxHp, centerX, hpBarY) ?? null;
    }
    this.healthBars?.position(this.healthBar, centerX, hpBarY);
  }

  /** True for the friendly persistent core while its fort art is loaded. */
  private isFortCore(): boolean {
    return this.fort !== null && this.spec.faction === 'friendly' && this.spec.persistentReservationRadiusCells !== undefined;
  }

  /** Friendly outposts and middle bases on cells take the fort kit; spawn points and enemy bases keep their art. */
  private isFortOutpost(): boolean {
    return this.fort !== null && this.spec.faction === 'friendly' && this.spec.persistentReservationRadiusCells === undefined
      && this.spec.surface !== 'none' && this.role !== 'spawn-point';
  }

  private fortCells(): FortCell[] {
    return this.spec.cells.map(cell => ({ gridX: cell.gridX, gridY: cell.gridY,
      x: this.metrics.offsetX + (cell.gridX + .5) * CELL_SIZE, y: this.metrics.offsetY + (cell.gridY + .5) * CELL_SIZE }));
  }

  private presentFort(): void {
    this.fortPresented = true;
    this.fortShadowCells.length = 0;
    for (const { x, y } of this.fortCells()) this.fortShadowCells.push({ x, y, active: true, visible: true, footprint: false });
  }

  private unpresentFort(): void {
    if (!this.fortPresented) return;
    this.fort!.remove(this.id);
    this.fortPresented = false;
    this.fortShadowCells.length = 0;
  }

  /** Mounted turret sprites, for their mesh shadows in the shadow system. */
  forEachTurretSprite(visit: (sprite: Phaser.GameObjects.Sprite) => void): void {
    // A fading turret drops its mesh shadow once it is half gone.
    if (this.presence < .5) return;
    for (const image of this.turretImages.values()) visit(image);
  }

  /**
   * Planning view only (the Bauhof's what-if): a fallen base fades out with its turrets, and back in.
   * Presentation only: HP, bodies and navigation are untouched. `immediate` skips the fade.
   */
  setFallen(fallen: boolean, immediate = false): void {
    if (this.fallen === fallen && !immediate) return;
    this.fallen = fallen;
    this.fallenFade?.remove();
    this.fallenFade = null;
    const target = fallen ? 0 : 1;
    if (immediate || this.presence === target) { this.applyPresence(target); return; }
    this.fallenFade = this.scene.tweens.addCounter({ from: this.presence, to: target, ease: 'Sine.easeInOut',
      duration: FALLEN_FADE_MS * Math.abs(target - this.presence),
      onUpdate: (tween) => this.applyPresence(tween.getValue() ?? target),
      onComplete: () => { this.fallenFade = null; this.applyPresence(target); } });
  }

  private applyPresence(presence: number): void {
    this.presence = presence;
    if (this.fortPresented) this.fort!.setPresence(this.id, presence);
    this.grounding?.setPresence(presence);
    for (const image of this.cellImages) image.setAlpha(presence).setVisible(presence > 0);
    for (const image of this.turretImages.values()) image.setAlpha(presence).setVisible(presence > 0);
  }

  /** Lichtpunkte des Basisleuchtens, oder leer wenn die Basis inert ist; das Fort bringt eigene Lichter. */
  getLightSpots(): readonly { x: number; y: number; radius: number }[] {
    return !this.presentation || this.spec.surface === 'none' || this.role === 'spawn-point' || this.isInert() || this.fortPresented
      ? EMPTY_LIGHT_SPOTS : this.lightSpots;
  }

  /** Liefert alle Zell-Kollisions-Rectangles (für StaticGroup-Aufnahme & LoS). */
  getCellBodies(): readonly Phaser.GameObjects.Rectangle[] {
    return this.cellBodies;
  }

  /** Sichtbarer, rein visueller Statusmarker fuer die allgemeine Verwundbarkeit. */
  setVulnerable(active: boolean): void {
    if (!active) {
      this.vulnerableMarker?.destroy();
      this.vulnerableMarker = null;
      return;
    }
    if (!this.presentation || this.vulnerableMarker || this.isInert()) return;
    const bounds = getBaseWorldBounds(this.spec.region, this.metrics);
    const marker = this.scene.add.graphics().setDepth(DEPTH.BASES + 5);
    registerGraphicsObject(this.scene, 'baseMarkers', marker);
    marker.lineStyle(3, VULNERABLE_MARKER_COLOR, 0.88);
    marker.strokeRect(bounds.x - 4, bounds.y - 4, bounds.width + 8, bounds.height + 8);
    makeAdditive(marker);
    this.scene.tweens.add({
      targets: marker,
      alpha: { from: 0.45, to: 1 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.vulnerableMarker = marker;
  }

  /** The ground below changed (base-site gravel appeared, grew or vanished). */
  setGroundGravel(gravel: PersistentBaseGravelCoverage | null): void {
    this.groundGravel = gravel;
    this.grounding?.setGravel(gravel);
  }

  /** Entfernt genau das Zellbild, dessen Explosion gerade abgespielt wird. */
  destroyCellVisual(cellIndex: number): void {
    if (this.fortPresented) this.fort!.destroyCell(this.id);
    const fortCell = this.fortShadowCells[cellIndex];
    if (fortCell) fortCell.active = false;
    this.accentGlow?.destroyCell(cellIndex);
    this.grounding?.destroyCell(cellIndex);
    const image = this.cellImages[cellIndex];
    if (image?.active) image.destroy();
  }

  /** Presentation cells remain available during the staggered destruction. */
  getSurfaceImages(): readonly Phaser.GameObjects.Image[] {
    return this.cellImages;
  }

  /**
   * Raised cells for the shadow system: tile images also cast their baked contact footprint, fort
   * cells only receive (turrets on the decks, no figure shadows on the walls).
   */
  getShadowSurfaceCells(): readonly { readonly x: number; readonly y: number; readonly active: boolean;
    readonly visible: boolean; readonly footprint?: boolean }[] {
    return this.fortPresented ? this.fortShadowCells : this.cellImages;
  }

  /**
   * Liefert den nächstgelegenen Punkt auf der Basis-Oberfläche (per-Zell-genau,
   * konkavitätsbewusst). Wird für Reichweiten-/Treffer-Berechnungen verwendet,
   * damit bei konkaven Formen die "Lücken" nicht fälschlich als Trefferfläche
   * zählen. Gibt `null` zurück, wenn die Basis zerstört ist.
   */
  getNearestSurfacePoint(x: number, y: number): { x: number; y: number; distance: number } | null {
    if (this.isInert() || this.spec.cells.length === 0) return null;
    if (this.spec.collisionRects) return nearestStructurePoint(this.spec.collisionRects, x, y);
    let bestX = 0;
    let bestY = 0;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const cell of this.spec.cells) {
      const left = this.metrics.offsetX + cell.gridX * CELL_SIZE;
      const top = this.metrics.offsetY + cell.gridY * CELL_SIZE;
      const right = left + CELL_SIZE;
      const bottom = top + CELL_SIZE;
      const cx = Math.min(Math.max(x, left), right);
      const cy = Math.min(Math.max(y, top), bottom);
      const dx = cx - x;
      const dy = cy - y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestX = cx;
        bestY = cy;
      }
    }
    return { x: bestX, y: bestY, distance: Math.sqrt(bestDistSq) };
  }

  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  getSpec(): BaseSpec {
    const overlay = this.activityOverlay;
    if (!overlay) return this.spec;
    // Die View bleibt abgeleitet. `spec` selbst ist die unveraenderliche World-Grundlage und
    // wird niemals mit Activity-State ueberschrieben.
    const {
      startHp: _worldStartHp,
      dormant: _worldDormant,
      dormantObjectiveId: _worldDormantObjectiveId,
      powerUpPedestals: _worldPowerUpPedestals,
      ...worldSpec
    } = this.spec;
    return {
      ...worldSpec,
      hpMax: overlay.hpMax,
      startHp: overlay.startHp,
      dormant: this.dormant,
      ...(overlay.dormantObjectiveId === undefined ? {} : { dormantObjectiveId: overlay.dormantObjectiveId }),
      powerUpPedestals: overlay.powerUpPedestals,
    };
  }

  /** Activity-Binding fuer den BaseManager; nicht als World-State gespeichert. */
  applyActivityOverlay(overlay: BaseActivityOverlay): void {
    this.hpBaselineRevision++;
    this.voidBurning = false;
    this.resetRepresentation();
    this.resetTurretAngles();
    this.activityOverlay = overlay;
    this.damageable = true;
    this.maxHp = overlay.hpMax;
    this.currentHp = Math.max(1, Math.min(this.maxHp, overlay.startHp));
    this.dormant = overlay.dormant;
    this.destroyedBroadcasted = false;
    if (!this.dormant) {
      this.createRuntimeRepresentation();
      if (this.presentation) this.createPresentationRepresentation();
    }
  }

  /** Entfernt den Activity-Zustand und stellt die World-Grundlage wieder her. */
  clearActivityOverlay(): void {
    this.voidBurning = false;
    if (this.activityOverlay === null) return;
    this.hpBaselineRevision++;
    this.resetRepresentation();
    this.resetTurretAngles();
    this.activityOverlay = null;
    this.damageable = false;
    this.maxHp = this.spec.hpMax;
    this.currentHp = this.spec.hpMax;
    this.dormant = false;
    this.destroyedBroadcasted = false;
    this.createRuntimeRepresentation();
    if (this.presentation) this.createPresentationRepresentation();
  }

  getTurrets(): readonly BaseTurretRuntimeState[] {
    if (this.isInert()) return [];
    return this.spec.turrets.map((turret) => ({
      id: turret.id,
      baseId: turret.baseId,
      x: turret.x,
      y: turret.y,
      angle: this.turretAngles.get(turret.id) ?? turret.initialAngle,
      weaponId: turret.weaponId,
      targetRange: BASE_TURRET_TARGET_RANGE,
      ...turretAimConfig(turret),
      faction: this.faction,
    }));
  }

  getSyncedTurretStates(): SyncedBaseTurretState[] {
    return this.getTurrets().map((turret) => ({ id: turret.id, angle: turret.angle }));
  }

  setTurretAngle(turretId: string, angle: number, interpolate = false): void {
    if (this.isInert() || !Number.isFinite(angle) || !this.turretAngles.has(turretId)) return;
    this.turretAngles.set(turretId, angle);
    const turret = this.spec.turrets.find((candidate) => candidate.id === turretId);
    const image = this.turretImages.get(turretId);
    if (!turret || !image) return;
    if (this.turretAnimations) {
      this.turretAnimations.syncPose(turretId, turret.x, turret.y, angle,
        interpolate && turret.rotationSpeedDegPerSec !== undefined);
      return;
    }
    const visual = getTurretVisualSpec(turret.weaponId);
    const transform = getTurretVisualTransform(visual, turret.x, turret.y, angle);
    image.setPosition(transform.x, transform.y).setRotation(transform.rotation);
  }

  applyTurretSnapshot(turrets: readonly SyncedBaseTurretState[]): void {
    for (const turret of turrets) this.setTurretAngle(turret.id, turret.angle, true);
  }

  isDestroyed(): boolean {
    return this.currentHp <= 0;
  }

  isDormant(): boolean {
    return this.dormant;
  }

  /** Shared gameplay/render gate for structures that do not exist yet or are destroyed. */
  isInert(): boolean {
    return this.isDestroyed() || this.isDormant();
  }

  isDamageable(): boolean { return this.damageable && !this.isInert(); }
  isVoidBurning(): boolean { return this.voidBurning && this.isDamageable(); }
  setVoidBurning(burning: boolean): void { this.voidBurning = burning && this.isDamageable(); }

  /** Monotonic activation derived from the replicated secondary-objective state. */
  activate(): boolean {
    if (!this.dormant || this.isDestroyed()) return false;
    this.dormant = false;
    if (this.activityOverlay) {
      this.activityOverlay = { ...this.activityOverlay, dormant: false };
    }
    this.createRuntimeRepresentation();
    if (this.presentation) this.createPresentationRepresentation();
    return true;
  }

  /** Wird vom `BaseManager` gesetzt; einmaliger Trigger bei HP → 0. */
  setOnDestroyed(callback: (() => void) | null): void {
    this.onDestroyed = callback;
  }

  /**
   * Host-only: Schaden anwenden und HP-Bar-Visual aktualisieren.
   */
  applyDamage(damage: number): void {
    this.commitDamage(damage);
  }

  commitDamage(damage: number): WorldIntegrityMutationResult {
    const before = integrityState(this.currentHp, this.maxHp);
    if (this.isInert()) return { kind: 'inert', state: before };
    if (!this.damageable) return { kind: 'immune', state: before };
    if (!Number.isFinite(damage) || damage <= 0) return { kind: 'applied', actualAmount: 0, state: before, transition: 'none' };
    const previousHp = this.currentHp;
    this.setHp(Math.max(0, this.currentHp - damage));
    return {
      kind: 'applied',
      actualAmount: previousHp - this.currentHp,
      state: integrityState(this.currentHp, this.maxHp),
      transition: previousHp > 0 && this.currentHp <= 0 ? 'destroyed' : 'none',
    };
  }

  commitRepair(amount: number): WorldIntegrityMutationResult {
    const before = integrityState(this.currentHp, this.maxHp);
    if (this.isInert()) return { kind: 'inert', state: before };
    if (!this.damageable) return { kind: 'immune', state: before };
    if (!Number.isFinite(amount) || amount <= 0) return { kind: 'applied', actualAmount: 0, state: before, transition: 'none' };
    const previousHp = this.currentHp;
    this.setHp(this.currentHp + amount);
    return {
      kind: 'applied',
      actualAmount: this.currentHp - previousHp,
      state: integrityState(this.currentHp, this.maxHp),
      transition: 'none',
    };
  }

  /** Setzt die HP (Host nach Schaden, Client beim State-Apply). */
  setHp(hp: number, baseline = false): void {
    // Auch ein fremder Snapshot darf eine unverwundbare Struktur nicht fallen lassen.
    if (!this.damageable) return;
    if (baseline) this.hpBaselineRevision++;
    const clamped = Math.max(0, Math.min(this.maxHp, hp));
    if (clamped === this.currentHp) {
      if (baseline) this.healthBars?.baseline(this.healthBar, clamped, this.maxHp);
      return;
    }
    this.currentHp = clamped;
    try {
      if (baseline) this.healthBars?.baseline(this.healthBar, clamped, this.maxHp);
      else this.healthBars?.observe(this.healthBar, clamped, this.maxHp);
    } catch (error) {
      console.error('[BaseEntity] Health-bar presentation failed', error);
    }
    if (this.currentHp <= 0) this.handleDestruction();
  }

  /** Local presentation reset signal; the first replicated snapshot is not a damage event. */
  getHpBaselineRevision(): number { return this.hpBaselineRevision; }

  /** Entfernt Gameplay-Bodies sofort; Zellbilder übernimmt die gestaffelte Zerstörung. */
  private handleDestruction(): void {
    if (this.destroyedBroadcasted) return;
    this.destroyedBroadcasted = true;

    for (const body of this.cellBodies) {
      if (body.active) body.destroy();
    }
    this.cellBodies.length = 0;

    try {
      this.accentGlow?.destroy();
      this.accentGlow = null;
      this.vulnerableMarker?.destroy();
      this.vulnerableMarker = null;
      for (const image of this.turretImages.values()) {
        if (image.active) image.destroy();
      }
      this.turretImages.clear();
      this.healthBars?.suppress(this.healthBar, true);
    } catch (error) {
      console.error('[BaseEntity] Destruction presentation failed', error);
    }

    if (this.onDestroyed) {
      this.onDestroyed();
    } else {
      // Defensive Direktnutzung außerhalb des BaseManager.
      this.grounding?.destroy();
      for (const image of this.cellImages) {
        if (image.active) image.destroy();
      }
    }
  }

  destroy(): void {
    this.fallenFade?.remove();
    this.fallenFade = null;
    this.vulnerableMarker?.destroy();
    this.vulnerableMarker = null;
    this.unpresentFort();
    this.accentGlow?.destroy();
    this.accentGlow = null;
    this.grounding?.destroy();
    this.grounding = null;
    for (const image of this.cellImages) {
      if (image.active) image.destroy();
    }
    this.cellImages.length = 0;
    for (const body of this.cellBodies) {
      if (body.active) body.destroy();
    }
    this.cellBodies.length = 0;
    for (const image of this.turretImages.values()) {
      if (image.active) image.destroy();
    }
    this.turretImages.clear();
    this.turretAngles.clear();
    this.healthBars?.release(this.healthBar);
    this.healthBar = null;
  }

  private resetRepresentation(): void {
    this.presentationCreated = false;
    this.unpresentFort();
    this.accentGlow?.destroy();
    this.accentGlow = null;
    this.grounding?.destroy();
    this.grounding = null;
    for (const image of this.cellImages) {
      if (image.active) image.destroy();
    }
    this.cellImages.length = 0;
    for (const body of this.cellBodies) {
      if (body.active) body.destroy();
    }
    this.cellBodies.length = 0;
    for (const image of this.turretImages.values()) {
      if (image.active) image.destroy();
    }
    this.turretImages.clear();
    this.vulnerableMarker?.destroy();
    this.vulnerableMarker = null;
    this.healthBars?.release(this.healthBar);
    this.healthBar = null;
  }

  private resetTurretAngles(): void {
    this.turretAngles.clear();
    for (const turret of this.spec.turrets) this.turretAngles.set(turret.id, turret.initialAngle);
  }
}

function toActivityOverlay(spec: BaseSpec): BaseActivityOverlay {
  return {
    baseId: spec.id,
    hpMax: spec.hpMax,
    startHp: Math.max(1, Math.min(spec.hpMax, spec.startHp ?? spec.hpMax)),
    dormant: spec.dormant === true,
    ...(spec.dormantObjectiveId === undefined ? {} : { dormantObjectiveId: spec.dormantObjectiveId }),
    powerUpPedestals: spec.powerUpPedestals,
  };
}
