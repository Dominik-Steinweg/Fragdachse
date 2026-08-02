import * as Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  COLORS,
  COOP_DEFENSE_BASE_HP_BAR_FILL,
  COOP_DEFENSE_BASE_HP_BAR_GAP,
  COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
  COOP_DEFENSE_HOSTILE_BASE_HP_BAR_FILL,
  DEPTH,
  TEAM_BLUE_COLOR,
  TEAM_RED_COLOR,
} from '../config';
import type { CoopBaseFaction, CoopBaseTurretWeaponId } from '../config/coopDefenseMaps';
import { getBaseWorldBounds, type BaseSpec } from '../arena/BaseRegistry';
import { AutoTiler, BASE_AUTOTILE } from '../arena/AutoTiler';
import { makeAdditive } from '../effects/EffectUtils';
import type { SyncedBaseTurretState } from '../types';

const EMPTY_LIGHT_SPOTS: readonly { x: number; y: number; radius: number }[] = [];
const BASE_LIGHT_SPACING = CELL_SIZE * 4.5;
const BASE_LIGHT_OVERHANG = CELL_SIZE * 1.25;
const BASE_LIGHT_RADIUS = BASE_LIGHT_SPACING * 1.35;
const VULNERABLE_MARKER_COLOR = 0xc86bff;

export interface BaseTurretRuntimeState {
  readonly id: string;
  readonly baseId: string;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly weaponId: CoopBaseTurretWeaponId;
  readonly faction: CoopBaseFaction;
}

/**
 * Visuelle und logische Repräsentation einer einzelnen Coop-Defense-Basis.
 *
 * Owns:
 *   - Pro Basis-Zelle ein 47-Blob-Autotile-Sprite (statt früher: ein Tint-Rect).
 *   - Pro Basis-Zelle einen 32×32-StaticBody (alle in derselben StaticGroup),
 *     damit auch konkave Formen physikalisch korrekt abgedeckt werden.
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
  private readonly cellImages: Phaser.GameObjects.Image[] = [];
  private readonly cellBodies: Phaser.GameObjects.Rectangle[] = [];
  private readonly turretImages = new Map<string, Phaser.GameObjects.Image>();
  private readonly turretAngles = new Map<string, number>();
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFg: Phaser.GameObjects.Rectangle;
  private readonly hpBarWidth: number;
  /**
   * Fraktionsfarbe des HP-Balkens. Als Feld gehalten, weil `refreshHpBar()` die Fuellfarbe bei
   * jeder HP-Aenderung neu setzt – ohne das wuerde der Balken beim ersten Treffer zurueckspringen.
   */
  private readonly hpBarFill: number;
  /**
   * Wenige große Lichtpunkte, die die gesamte Basisfläche plus einen Überhang gleichmäßig
   * ausleuchten. Einmal aus den Bounds abgeleitet.
   */
  private readonly lightSpots: readonly { readonly x: number; readonly y: number; readonly radius: number }[];
  private readonly spawnCenterMarker: Phaser.GameObjects.Graphics | null;
  private readonly spawnCenterTween: Phaser.Tweens.Tween | null;
  private currentHp: number;
  private maxHp: number;
  private destroyedBroadcasted = false;
  private onDestroyed: (() => void) | null = null;
  private vulnerableMarker: Phaser.GameObjects.Graphics | null = null;

  constructor(scene: Phaser.Scene, spec: BaseSpec) {
    this.scene = scene;
    this.id = spec.id;
    this.spec = spec;
    this.faction = spec.faction;
    this.role = spec.role ?? 'main';
    this.currentHp = spec.hpMax;
    this.maxHp = spec.hpMax;
    const hostile = spec.faction === 'hostile';
    this.hpBarFill = hostile ? COOP_DEFENSE_HOSTILE_BASE_HP_BAR_FILL : COOP_DEFENSE_BASE_HP_BAR_FILL;
    // Eigenes rotes Tileset statt Tint: das Basis-Tileset ist gesaettigt blau, ein Multiply-Tint
    // mit Rot ergibt nahezu Schwarz.
    const cellTexture = hostile ? 'base_hostile' : 'base';

    const bounds = getBaseWorldBounds(spec.region);

    // ── 1) 47-Blob-Sprites + StaticBodies pro Zelle ────────────────────
    const cellKeySet = new Set<number>();
    const keyOf = (gx: number, gy: number) => gy * 100000 + gx;
    for (const cell of spec.cells) cellKeySet.add(keyOf(cell.gridX, cell.gridY));
    const isOccupied = (gx: number, gy: number) => cellKeySet.has(keyOf(gx, gy));

    for (const cell of spec.cells) {
      const worldX = ARENA_OFFSET_X + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
      const worldY = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
      const mask = AutoTiler.computeMask(cell.gridX, cell.gridY, isOccupied);
      const frame = AutoTiler.getFrame(mask, BASE_AUTOTILE);

      const image = scene.add.image(worldX, worldY, cellTexture, frame);
      image.setDisplaySize(CELL_SIZE, CELL_SIZE);
      image.setDepth(DEPTH.BASES);
      this.cellImages.push(image);

      // Unsichtbares Kollisions-Rechteck mit StaticBody (eines pro Zelle).
      const body = scene.add.rectangle(worldX, worldY, CELL_SIZE, CELL_SIZE, 0x000000, 0);
      // Collider-Callbacks bekommen nur das GameObject; ueber diesen Schluessel finden sie
      // zurueck zur Basis, ohne dass ein zusaetzlicher raeumlicher Index noetig waere.
      body.setData('baseId', spec.id);
      scene.physics.add.existing(body, true);
      const staticBody = body.body as Phaser.Physics.Arcade.StaticBody;
      staticBody.setSize(CELL_SIZE, CELL_SIZE);
      staticBody.updateFromGameObject();
      this.cellBodies.push(body);
    }

    // Basistürme sind reine Anbauten: keine eigenen Bodies und keine eigenen HP.
    // Ihr kompletter Lebenszyklus wird von dieser BaseEntity besessen.
    for (const turret of spec.turrets) {
      const image = scene.add.image(turret.x, turret.y, getBaseTurretTextureKey(turret.weaponId))
        .setDisplaySize(CELL_SIZE, CELL_SIZE)
        .setRotation(turret.initialAngle)
        .setTint(hostile ? TEAM_RED_COLOR : TEAM_BLUE_COLOR)
        .setDepth(DEPTH.BASES + 3);
      this.turretImages.set(turret.id, image);
      this.turretAngles.set(turret.id, turret.initialAngle);
    }

    if (spec.role === 'spawn-point' && spec.spawnCenter) {
      const marker = scene.add.graphics()
        .setPosition(spec.spawnCenter.x, spec.spawnCenter.y)
        .setDepth(DEPTH.BASES + 2);
      marker.lineStyle(2, hostile ? TEAM_RED_COLOR : TEAM_BLUE_COLOR, 0.78);
      marker.strokeCircle(0, 0, CELL_SIZE * 0.34);
      marker.lineStyle(1, hostile ? 0xffaaa8 : 0xb7e9ff, 0.75);
      marker.strokeCircle(0, 0, CELL_SIZE * 0.18);
      marker.lineBetween(-CELL_SIZE * 0.48, 0, CELL_SIZE * 0.48, 0);
      marker.lineBetween(0, -CELL_SIZE * 0.48, 0, CELL_SIZE * 0.48);
      this.spawnCenterMarker = marker;
      this.spawnCenterTween = scene.tweens.add({
        targets: marker,
        alpha: { from: 0.45, to: 1 },
        scale: { from: 0.92, to: 1.08 },
        duration: 760,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
    } else {
      this.spawnCenterMarker = null;
      this.spawnCenterTween = null;
    }

    // ── 2) HP-Bar (eine pro Basis, unter der Bounding-Box) ─────────────
    const centerX = bounds.x + bounds.width / 2;
    this.hpBarWidth = bounds.width;
    const hpBarY = bounds.y + bounds.height + COOP_DEFENSE_BASE_HP_BAR_GAP;
    this.hpBarBg = scene.add.rectangle(
      centerX,
      hpBarY,
      this.hpBarWidth,
      COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
      0x333333,
    );
    this.hpBarBg.setStrokeStyle(1, COLORS.GREY_6);
    this.hpBarBg.setDepth(DEPTH.BASES + 1);
    this.hpBarFg = scene.add.rectangle(
      centerX - this.hpBarWidth / 2,
      hpBarY,
      this.hpBarWidth,
      COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
      this.hpBarFill,
    );
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.BASES + 2);

    this.lightSpots = BaseEntity.buildLightSpots(bounds);
  }

  /**
   * Verteilt wenige große Lichtpunkte zentriert auf einem gleichmäßigen Raster. Durch die
   * Zentrierung reichen für die üblichen Basen zwei bis vier Lichter statt eines dichten
   * Gitters entlang der Außenkanten.
   */
  private static buildLightSpots(
    bounds: { x: number; y: number; width: number; height: number },
  ): { x: number; y: number; radius: number }[] {
    const minX = bounds.x - BASE_LIGHT_OVERHANG;
    const minY = bounds.y - BASE_LIGHT_OVERHANG;
    const spanX = bounds.width + BASE_LIGHT_OVERHANG * 2;
    const spanY = bounds.height + BASE_LIGHT_OVERHANG * 2;
    const cols = Math.max(1, Math.ceil(spanX / BASE_LIGHT_SPACING));
    const rows = Math.max(1, Math.ceil(spanY / BASE_LIGHT_SPACING));

    const spots: { x: number; y: number; radius: number }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        spots.push({
          x: minX + ((col + 0.5) / cols) * spanX,
          y: minY + ((row + 0.5) / rows) * spanY,
          radius: BASE_LIGHT_RADIUS,
        });
      }
    }
    return spots;
  }

  /** Lichtpunkte des Basisleuchtens, oder leer wenn zerstört. */
  getLightSpots(): readonly { x: number; y: number; radius: number }[] {
    return this.isDestroyed() ? EMPTY_LIGHT_SPOTS : this.lightSpots;
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
    if (this.vulnerableMarker || this.isDestroyed()) return;
    const bounds = getBaseWorldBounds(this.spec.region);
    const marker = this.scene.add.graphics().setDepth(DEPTH.BASES + 5);
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

  /** Entfernt genau das Zellbild, dessen Explosion gerade abgespielt wird. */
  destroyCellVisual(cellIndex: number): void {
    const image = this.cellImages[cellIndex];
    if (image?.active) image.destroy();
  }

  /**
   * Liefert den nächstgelegenen Punkt auf der Basis-Oberfläche (per-Zell-genau,
   * konkavitätsbewusst). Wird für Reichweiten-/Treffer-Berechnungen verwendet,
   * damit bei konkaven Formen die "Lücken" nicht fälschlich als Trefferfläche
   * zählen. Gibt `null` zurück, wenn die Basis zerstört ist.
   */
  getNearestSurfacePoint(x: number, y: number): { x: number; y: number; distance: number } | null {
    if (this.isDestroyed() || this.spec.cells.length === 0) return null;
    let bestX = 0;
    let bestY = 0;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const cell of this.spec.cells) {
      const left = ARENA_OFFSET_X + cell.gridX * CELL_SIZE;
      const top = ARENA_OFFSET_Y + cell.gridY * CELL_SIZE;
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
    return this.spec;
  }

  getSpawnCenterWorldPosition(): { x: number; y: number } | null {
    return this.isDestroyed() || !this.spec.spawnCenter
      ? null
      : { x: this.spec.spawnCenter.x, y: this.spec.spawnCenter.y };
  }

  getTurrets(): readonly BaseTurretRuntimeState[] {
    if (this.isDestroyed()) return [];
    return this.spec.turrets.map((turret) => ({
      id: turret.id,
      baseId: turret.baseId,
      x: turret.x,
      y: turret.y,
      angle: this.turretAngles.get(turret.id) ?? turret.initialAngle,
      weaponId: turret.weaponId,
      faction: this.faction,
    }));
  }

  getSyncedTurretStates(): SyncedBaseTurretState[] {
    return this.getTurrets().map((turret) => ({ id: turret.id, angle: turret.angle }));
  }

  setTurretAngle(turretId: string, angle: number): void {
    if (this.isDestroyed() || !Number.isFinite(angle) || !this.turretAngles.has(turretId)) return;
    this.turretAngles.set(turretId, angle);
    this.turretImages.get(turretId)?.setRotation(angle);
  }

  applyTurretSnapshot(turrets: readonly SyncedBaseTurretState[]): void {
    for (const turret of turrets) this.setTurretAngle(turret.id, turret.angle);
  }

  isDestroyed(): boolean {
    return this.currentHp <= 0;
  }

  /** Wird vom `BaseManager` gesetzt; einmaliger Trigger bei HP → 0. */
  setOnDestroyed(callback: (() => void) | null): void {
    this.onDestroyed = callback;
  }

  /**
   * Host-only: Schaden anwenden und HP-Bar-Visual aktualisieren.
   */
  applyDamage(damage: number): void {
    if (damage <= 0 || this.currentHp <= 0) return;
    this.setHp(Math.max(0, this.currentHp - damage));
  }

  /** Setzt die HP (Host nach Schaden, Client beim State-Apply). */
  setHp(hp: number): void {
    const clamped = Math.max(0, Math.min(this.maxHp, hp));
    if (clamped === this.currentHp) return;
    this.currentHp = clamped;
    this.refreshHpBar();
    if (this.currentHp <= 0) this.handleDestruction();
  }

  private refreshHpBar(): void {
    const ratio = this.maxHp > 0 ? this.currentHp / this.maxHp : 0;
    this.hpBarFg.width = this.hpBarWidth * ratio;
    this.hpBarFg.setFillStyle(this.hpBarFill);
  }

  /** Entfernt Gameplay-Bodies sofort; Zellbilder übernimmt die gestaffelte Zerstörung. */
  private handleDestruction(): void {
    if (this.destroyedBroadcasted) return;
    this.destroyedBroadcasted = true;
    this.vulnerableMarker?.destroy();
    this.vulnerableMarker = null;

    for (const body of this.cellBodies) {
      if (body.active) body.destroy();
    }
    this.cellBodies.length = 0;

    for (const image of this.turretImages.values()) {
      if (image.active) image.destroy();
    }
    this.turretImages.clear();

    if (this.spawnCenterMarker?.active) this.spawnCenterMarker.setVisible(false);

    if (this.hpBarBg.active) this.hpBarBg.setVisible(false);
    if (this.hpBarFg.active) this.hpBarFg.setVisible(false);

    if (this.onDestroyed) {
      this.onDestroyed();
    } else {
      // Defensive Direktnutzung außerhalb des BaseManager.
      for (const image of this.cellImages) {
        if (image.active) image.destroy();
      }
    }
  }

  destroy(): void {
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
    this.spawnCenterTween?.stop();
    if (this.spawnCenterMarker?.active) this.spawnCenterMarker.destroy();
    if (this.hpBarBg.active) this.hpBarBg.destroy();
    if (this.hpBarFg.active) this.hpBarFg.destroy();
  }
}

function getBaseTurretTextureKey(weaponId: CoopBaseTurretWeaponId): string {
  switch (weaponId) {
    case 'FLIEGENPILZ_PLASMA':
      return 'construction_plasma_turret';
    case 'TURRET_ROCKET':
      return 'construction_rocket_turret';
    case 'TURRET_MG':
      return 'construction_machine_gun_turret';
    case 'TURRET_FLAME':
    case 'TURRET_VOID_FLAME':
      return 'construction_flame_turret';
    case 'SPOREN':
    case 'BASE_SPOREN':
    case 'TURRET_SPORE':
      return 'placeable_turret';
  }
}
