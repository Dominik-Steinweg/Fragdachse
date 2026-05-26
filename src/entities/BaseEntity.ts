import * as Phaser from 'phaser';
import {
  COLORS,
  COOP_DEFENSE_BASE_HP_BAR_FILL,
  COOP_DEFENSE_BASE_HP_BAR_GAP,
  COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
  COOP_DEFENSE_BASE_HP_MAX,
  COOP_DEFENSE_BASE_TINT,
  COOP_DEFENSE_BASE_TINT_ALPHA,
  DEPTH,
} from '../config';
import { getBaseWorldBounds, type BaseSpec } from '../arena/BaseRegistry';

/**
 * Visuelle und logische Repräsentation einer einzelnen Coop-Defense-Basis.
 *
 * Owns:
 *   - Tint-Rectangle (das, was in 1.2 bereits sichtbar war)
 *   - Statischer Physik-Body (rechteckig, in BaseManager.baseGroup registriert)
 *   - HP-Bar (Hintergrund + Vordergrund-Rechteck unter der Basis)
 *
 * State:
 *   - currentHp / maxHp – Host-autoritativ. Clients setzen über updateHp().
 *
 * Schaden:
 *   - Die Entity selbst hat KEINEN Schadens-Pfad. Schaden wird ausschließlich
 *     über BaseManager.applyDamage(id, dmg) appliziert (Host-only, in 1.3 ohne
 *     Aufrufer – Infrastruktur für 1.5 vorbereitet).
 */
export class BaseEntity {
  readonly id: string;
  readonly spec: BaseSpec;
  readonly tint: Phaser.GameObjects.Rectangle;

  private readonly hpBarBg: Phaser.GameObjects.Rectangle;
  private readonly hpBarFg: Phaser.GameObjects.Rectangle;
  private readonly hpBarWidth: number;
  private currentHp: number;
  private maxHp: number;

  constructor(scene: Phaser.Scene, spec: BaseSpec) {
    this.id = spec.id;
    this.spec = spec;
    this.currentHp = COOP_DEFENSE_BASE_HP_MAX;
    this.maxHp = COOP_DEFENSE_BASE_HP_MAX;

    const bounds = getBaseWorldBounds(spec.region);
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // 1) Tint-Visual (war zuvor in ArenaBuilder – wandert hierhin als Entity-Owned).
    this.tint = scene.add.rectangle(
      centerX,
      centerY,
      bounds.width,
      bounds.height,
      COOP_DEFENSE_BASE_TINT,
      COOP_DEFENSE_BASE_TINT_ALPHA,
    );
    this.tint.setDepth(DEPTH.BASES);

    // 2) Statischer Physik-Body über dieselbe Rectangle-Instanz. Phaser
    //    aktiviert dadurch einen StaticBody mit derselben Größe.
    scene.physics.add.existing(this.tint, true);
    const body = this.tint.body as Phaser.Physics.Arcade.StaticBody;
    // Sicherheitshalber Größe explizit setzen (StaticBody nimmt sonst Sprite-Display-Size).
    body.setSize(bounds.width, bounds.height);
    body.updateFromGameObject();

    // 3) HP-Bar unterhalb der Basis. Breite = Basis-Breite (skaliert mit Footprint).
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
    this.hpBarFg.setOrigin(0, 0.5); // linke Kante als Anker – schrumpft nach rechts
    this.hpBarFg.setDepth(DEPTH.BASES + 2);
  }

  /** Liefert die Tint-Rectangle als Phaser-Sprite (für StaticGroup-Registrierung). */
  getPhysicsBody(): Phaser.GameObjects.Rectangle {
    return this.tint;
  }

  /** Aktuelle HP (Read-only Snapshot). */
  getHp(): number {
    return this.currentHp;
  }

  getMaxHp(): number {
    return this.maxHp;
  }

  getSpec(): BaseSpec {
    return this.spec;
  }

  /**
   * Host-only: Schaden anwenden und HP-Bar-Visual aktualisieren.
   * In 1.3 unbenutzt (kein Schadens-Routing); ab 1.5 ruft Enemy-AI dies auf.
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
  }

  private refreshHpBar(): void {
    const ratio = this.maxHp > 0 ? this.currentHp / this.maxHp : 0;
    this.hpBarFg.width = this.hpBarWidth * ratio;
    this.hpBarFg.setFillStyle(COOP_DEFENSE_BASE_HP_BAR_FILL);
  }

  destroy(): void {
    if (this.tint.active) this.tint.destroy();
    if (this.hpBarBg.active) this.hpBarBg.destroy();
    if (this.hpBarFg.active) this.hpBarFg.destroy();
  }
}
