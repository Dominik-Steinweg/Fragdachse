import Phaser from 'phaser';
import type { PlayerProfile } from '../types';
import {
  PLAYER_SIZE, DEPTH,
  HP_MAX, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_OFFSET_Y,
  BURROW_ALPHA, BURROW_TINT,
} from '../config';

export class PlayerEntity {
  readonly id:     string;
  readonly sprite: Phaser.GameObjects.Rectangle;

  private readonly colorHex: number;
  private hpBarBg:  Phaser.GameObjects.Rectangle;
  private hpBarFg:  Phaser.GameObjects.Rectangle;
  private currentHp = HP_MAX;

  // Zielposition für client-seitige Interpolation (Lerp)
  private targetX = 0;
  private targetY = 0;

  // Visuelle Zustände – kombiniert in resolveVisual()
  private isBurrowedVisual = false;
  private isRagingVisual   = false;

  constructor(scene: Phaser.Scene, profile: PlayerProfile, x: number, y: number) {
    this.id       = profile.id;
    this.colorHex = profile.colorHex;
    this.targetX  = x;
    this.targetY  = y;

    // Spieler-Sprite
    this.sprite = scene.add.rectangle(x, y, PLAYER_SIZE, PLAYER_SIZE, profile.colorHex);
    this.sprite.setDepth(DEPTH.PLAYERS);
    scene.physics.add.existing(this.sprite);
    this.body.setCollideWorldBounds(true);

    // HP-Balken Hintergrund (dunkelgrau, zentriert)
    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);

    // HP-Balken Vordergrund (farbig, links ausgerichtet)
    this.hpBarFg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x00cc44);
    this.hpBarFg.setOrigin(0, 0.5);   // linke Kante als Ankerpunkt → schrumpft von rechts
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.syncBar();
  }

  get body(): Phaser.Physics.Arcade.Body {
    return this.sprite.body as Phaser.Physics.Arcade.Body;
  }

  get color(): number {
    return this.colorHex;
  }

  /** Sprite + Physik-Body + HP-Balken positionieren (Host: Respawn). */
  setPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
    this.sprite.setPosition(x, y);
    this.body.reset(x, y);
    this.syncBar();
  }

  /**
   * Zielposition für client-seitige Interpolation setzen.
   * Nicht auf dem Host aufrufen – dort gilt setPosition().
   */
  setTargetPosition(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Sprite einen Schritt zur Zielposition interpolieren.
   * Jeden Frame auf dem Client aufrufen.
   * @param factor Interpolationsfaktor 0–1 (z. B. 0.2 für weiche Bewegung)
   */
  lerpStep(factor: number): void {
    this.sprite.x = Phaser.Math.Linear(this.sprite.x, this.targetX, factor);
    this.sprite.y = Phaser.Math.Linear(this.sprite.y, this.targetY, factor);
    this.syncBar();
  }

  /**
   * HP-Balken an aktuelle Sprite-Position angleichen.
   * Jeden Frame aufrufen wenn Sprite durch Physik bewegt wurde.
   */
  syncBar(): void {
    const x = this.sprite.x;
    const y = this.sprite.y + HP_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, y);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH / 2, y);
  }

  /** HP-Wert aktualisieren und Balken neu zeichnen. */
  updateHP(hp: number): void {
    this.currentHp = Math.max(0, Math.min(HP_MAX, hp));
    const ratio    = this.currentHp / HP_MAX;
    this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    const color    = ratio > 0.5 ? 0x00cc44 : ratio > 0.25 ? 0xffcc00 : 0xff3300;
    this.hpBarFg.setFillStyle(color);
  }

  /** Sprite und Balken ein-/ausblenden (Tod / Respawn). */
  setVisible(visible: boolean): void {
    this.sprite.setVisible(visible);
    this.hpBarBg.setVisible(visible);
    this.hpBarFg.setVisible(visible);
  }

  /** Burrow-Visualisierung setzen. */
  setBurrowVisual(isBurrowed: boolean): void {
    this.isBurrowedVisual = isBurrowed;
    this.resolveVisual();
  }

  /** Ultimate-Rage-Tint setzen (Spieler leuchtet rot). */
  setRageTint(active: boolean): void {
    this.isRagingVisual = active;
    this.resolveVisual();
  }

  /**
   * Einheitliche Methode zur visuellen Darstellung.
   * Priorität: Burrow > Rage > Normal.
   * Rectangle hat kein setTint() – stattdessen setFillStyle().
   */
  private resolveVisual(): void {
    if (this.isBurrowedVisual) {
      this.sprite.setAlpha(BURROW_ALPHA);
      this.sprite.setFillStyle(BURROW_TINT);
    } else if (this.isRagingVisual) {
      this.sprite.setAlpha(1.0);
      this.sprite.setFillStyle(0xff3333);
    } else {
      this.sprite.setAlpha(1.0);
      this.sprite.setFillStyle(this.colorHex);
    }
  }

  destroy(): void {
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.sprite.destroy();
  }
}
