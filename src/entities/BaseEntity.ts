import * as Phaser from 'phaser';
import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  COLORS,
  COOP_DEFENSE_BASE_HP_BAR_FILL,
  COOP_DEFENSE_BASE_HP_BAR_GAP,
  COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
  DEPTH,
} from '../config';
import { getBaseWorldBounds, type BaseSpec } from '../arena/BaseRegistry';
import { AutoTiler, BASE_AUTOTILE } from '../arena/AutoTiler';

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
 *   - Bei HP-Übergang auf ≤ 0 werden Sprites, Bodies und HP-Bar entsorgt.
 *   - Ein optionaler `onDestroyed`-Callback wird genau einmal aufgerufen,
 *     so dass der `BaseManager` Folgereaktionen anstoßen kann
 *     (insb. Flow-Field-Rebuild der Wegfindung).
 */
export class BaseEntity {
  readonly id: string;
  readonly spec: BaseSpec;

  private readonly scene: Phaser.Scene;
  private readonly cellImages: Phaser.GameObjects.Image[] = [];
  private readonly cellBodies: Phaser.GameObjects.Rectangle[] = [];
  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFg: Phaser.GameObjects.Rectangle;
  private readonly hpBarWidth: number;
  private currentHp: number;
  private maxHp: number;
  private destroyedBroadcasted = false;
  private onDestroyed: (() => void) | null = null;

  constructor(scene: Phaser.Scene, spec: BaseSpec) {
    this.scene = scene;
    this.id = spec.id;
    this.spec = spec;
    this.currentHp = spec.hpMax;
    this.maxHp = spec.hpMax;

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

      const image = scene.add.image(worldX, worldY, 'base', frame);
      image.setDisplaySize(CELL_SIZE, CELL_SIZE);
      image.setDepth(DEPTH.BASES);
      this.cellImages.push(image);

      // Unsichtbares Kollisions-Rechteck mit StaticBody (eines pro Zelle).
      const body = scene.add.rectangle(worldX, worldY, CELL_SIZE, CELL_SIZE, 0x000000, 0);
      scene.physics.add.existing(body, true);
      const staticBody = body.body as Phaser.Physics.Arcade.StaticBody;
      staticBody.setSize(CELL_SIZE, CELL_SIZE);
      staticBody.updateFromGameObject();
      this.cellBodies.push(body);
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
      COOP_DEFENSE_BASE_HP_BAR_FILL,
    );
    this.hpBarFg.setOrigin(0, 0.5);
    this.hpBarFg.setDepth(DEPTH.BASES + 2);
  }

  /** Liefert alle Zell-Kollisions-Rectangles (für StaticGroup-Aufnahme & LoS). */
  getCellBodies(): readonly Phaser.GameObjects.Rectangle[] {
    return this.cellBodies;
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
    this.hpBarFg.setFillStyle(COOP_DEFENSE_BASE_HP_BAR_FILL);
  }

  /** Entfernt alle Visuals & Bodies, feuert `onDestroyed` einmalig. */
  private handleDestruction(): void {
    if (this.destroyedBroadcasted) return;
    this.destroyedBroadcasted = true;

    for (const image of this.cellImages) {
      if (image.active) image.destroy();
    }
    this.cellImages.length = 0;

    for (const body of this.cellBodies) {
      if (body.active) body.destroy();
    }
    this.cellBodies.length = 0;

    if (this.hpBarBg.active) this.hpBarBg.setVisible(false);
    if (this.hpBarFg.active) this.hpBarFg.setVisible(false);

    this.onDestroyed?.();
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
    if (this.hpBarBg.active) this.hpBarBg.destroy();
    if (this.hpBarFg.active) this.hpBarFg.destroy();
  }
}
