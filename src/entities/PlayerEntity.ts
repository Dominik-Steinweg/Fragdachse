import Phaser from 'phaser';
import type { PlayerProfile } from '../types';
import {
  PLAYER_SIZE, DEPTH,
  HP_MAX, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_OFFSET_Y,
  BURROW_ALPHA, BURROW_TINT,
} from '../config';

export class PlayerEntity {
  readonly id:     string;
  readonly sprite: Phaser.GameObjects.Image;

  private readonly colorHex: number;
  private hpBarBg:  Phaser.GameObjects.Rectangle;
  private hpBarFg:  Phaser.GameObjects.Rectangle;
  private currentHp = HP_MAX;

  // Zielposition für client-seitige Interpolation (Lerp)
  private targetX = 0;
  private targetY = 0;

  // Rotation: Bild zeigt nach Norden (up = -π/2 in Phaser), Offset +π/2 nötig
  private static readonly ROTATION_OFFSET = Math.PI / 2;
  private targetRotation = 0;

  // Glow-Aura für Spielerfarbe
  private glowFx: Phaser.FX.Glow | null = null;
  private glowTween: Phaser.Tweens.Tween | null = null;

  // Sterbeanimation
  private deathSprite: Phaser.GameObjects.Sprite | null = null;
  private isAliveVisual = true; // verfolgt Übergang alive→dead für einmaligen Animationsstart

  // Visuelle Zustände – kombiniert in resolveVisual()
  private isBurrowedVisual = false;
  private isRagingVisual   = false;

  constructor(scene: Phaser.Scene, profile: PlayerProfile, x: number, y: number) {
    this.id       = profile.id;
    this.colorHex = profile.colorHex;
    this.targetX  = x;
    this.targetY  = y;

    // Spieler-Sprite (Badger-Bild statt Rechteck)
    this.sprite = scene.add.image(x, y, 'badger');
    this.sprite.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    this.sprite.setDepth(DEPTH.PLAYERS);
    scene.physics.add.existing(this.sprite);
    this.body.setCircle(PLAYER_SIZE / 2);
    this.body.setCollideWorldBounds(true);

    // Leuchtende Spielerfarb-Aura (vgl. PowerUpRenderer)
    this.glowFx = this.sprite.preFX?.addGlow(profile.colorHex, 4, 0, false, 0.1, 16) ?? null;
    if (this.glowFx) {
      this.glowTween = scene.tweens.add({
        targets:       this.glowFx,
        outerStrength: { from: 3, to: 7 },
        duration:      1000,
        yoyo:          true,
        repeat:        -1,
        ease:          'Sine.easeInOut',
      });
    }

    // HP-Balken Hintergrund (dunkelgrau, zentriert)
    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);

    // HP-Balken Vordergrund (farbig, links ausgerichtet)
    this.hpBarFg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x00cc44);
    this.hpBarFg.setOrigin(0, 0.5);   // linke Kante als Ankerpunkt → schrumpft von rechts
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.syncBar();

    // Sterbe-Sprite (zunächst ausgeblendet; Tiefe leicht unter Spielern)
    // Origin (0.5, 1) = untere Mitte → Animation wächst nach oben
    this.deathSprite = scene.add.sprite(x, y, 'dachs_death');
    this.deathSprite.setOrigin(0.5, 1);
    this.deathSprite.setDepth(DEPTH.PLAYERS - 1);
    this.deathSprite.setVisible(false);
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
    this.lerpRotation(factor);
    this.syncBar();
  }

  /** Sprite-Rotation direkt setzen (lokaler Spieler, jeden Frame). */
  setRotation(aimAngle: number): void {
    this.sprite.rotation = aimAngle + PlayerEntity.ROTATION_OFFSET;
  }

  /** Ziel-Rotation für client-seitige Interpolation (Remote-Spieler). */
  setTargetRotation(aimAngle: number): void {
    this.targetRotation = aimAngle;
  }

  /** Rotation smooth zum Ziel interpolieren (Shortest-Path). */
  private lerpRotation(factor: number): void {
    const current = this.sprite.rotation - PlayerEntity.ROTATION_OFFSET;
    const diff = Phaser.Math.Angle.Wrap(this.targetRotation - current);
    this.sprite.rotation = (current + diff * factor) + PlayerEntity.ROTATION_OFFSET;
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

    if (!visible && this.isAliveVisual) {
      // Übergang alive → dead: Sterbeanimation starten
      this.isAliveVisual = false;
      if (this.deathSprite) {
        // Unterkante des 32×64-Frames bündig mit Sprite-Unterkante (wächst nach oben)
        this.deathSprite.setPosition(this.sprite.x, this.sprite.y + PLAYER_SIZE / 2);
        this.deathSprite.setVisible(true);
        this.deathSprite.play('player_death');
        this.deathSprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          this.deathSprite?.setVisible(false);
        });
      }
    } else if (visible && !this.isAliveVisual) {
      // Übergang dead → alive (Respawn): Animation abbrechen
      this.isAliveVisual = true;
      if (this.deathSprite) {
        this.deathSprite.stop();
        this.deathSprite.setVisible(false);
      }
    } else if (visible) {
      this.isAliveVisual = true;
    }
  }

  /** Visuelle Skalierung für Dash-Hitbox-Feedback (Client-Seite). */
  setDashScale(scale: number): void {
    this.sprite.setScale(scale);
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
   * Bild bleibt ungetinted – Zustand wird über Glow-Aura-Farbe + Alpha vermittelt.
   */
  private resolveVisual(): void {
    if (this.isBurrowedVisual) {
      this.sprite.setAlpha(BURROW_ALPHA);
      if (this.glowFx) this.glowFx.color = BURROW_TINT;
    } else if (this.isRagingVisual) {
      this.sprite.setAlpha(1.0);
      if (this.glowFx) this.glowFx.color = 0xff3333;
    } else {
      this.sprite.setAlpha(1.0);
      if (this.glowFx) this.glowFx.color = this.colorHex;
    }
  }

  destroy(): void {
    this.glowTween?.stop();
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.sprite.destroy();
    this.deathSprite?.destroy();
  }
}
