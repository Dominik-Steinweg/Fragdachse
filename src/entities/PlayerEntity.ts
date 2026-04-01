import Phaser from 'phaser';
import type { BurrowPhase, PlayerProfile } from '../types';
import { PlayerBurnRenderer } from '../effects/PlayerBurnRenderer';
import {
  PLAYER_SIZE, DEPTH, COLORS,
  ARMOR_BAR_HEIGHT, ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH,
  ARMOR_COLOR, ARMOR_MAX,
  HP_MAX, HP_BAR_WIDTH, HP_BAR_HEIGHT, HP_BAR_OFFSET_Y,
} from '../config';

export class PlayerEntity {
  readonly id:     string;
  readonly sprite: Phaser.GameObjects.Image;

  private readonly colorHex: number;
  private readonly isEnemy: boolean;
  private hpBarBg:  Phaser.GameObjects.Rectangle;
  private hpBarFg:  Phaser.GameObjects.Rectangle;
  private armorBarBg: Phaser.GameObjects.Rectangle;
  private armorBarFg: Phaser.GameObjects.Rectangle;
  private currentHp = HP_MAX;
  private currentArmor = 0;
  private worldBarsVisible = true;

  // Zielposition für client-seitige Interpolation (Lerp)
  private targetX = 0;
  private targetY = 0;

  // Rotation: Bild zeigt nach Norden (up = -π/2 in Phaser), Offset +π/2 nötig
  private static readonly ROTATION_OFFSET = Math.PI / 2;
  private targetRotation = 0;

  // Glow-Aura für Spielerfarbe
  private glowFx: Phaser.FX.Glow | null = null;
  private glowTween: Phaser.Tweens.Tween | null = null;
  private stealthTween: Phaser.Tweens.Tween | null = null;
  private stealthScanTween: Phaser.Tweens.Tween | null = null;
  private stealthShell: Phaser.GameObjects.Image | null = null;
  private stealthScan: Phaser.GameObjects.Image | null = null;
  private burnRenderer: PlayerBurnRenderer | null = null;
  private burnStacks = 0;

  // Sterbeanimation
  private deathSprite: Phaser.GameObjects.Sprite | null = null;
  private isAliveVisual = true; // verfolgt Übergang alive→dead für einmaligen Animationsstart
  private baseVisible = true;

  // Visuelle Zustände – kombiniert in resolveVisual()
  private burrowPhase: BurrowPhase = 'idle';
  private isRagingVisual   = false;
  private isDecoyStealthed = false;
  private burrowTween: Phaser.Tweens.Tween | null = null;
  private burrowTweenAlpha = 1;
  private stealthTweenAlpha = 1;
  private stealthGlowStrength = 4;
  private stealthShellAlpha = 0;
  private stealthShellScaleX = 1;
  private stealthShellScaleY = 1;
  private stealthShellRotation = 0;
  private stealthScanProgress = 0;

  constructor(scene: Phaser.Scene, profile: PlayerProfile, x: number, y: number, isEnemy = false) {
    this.id       = profile.id;
    this.colorHex = profile.colorHex;
    this.isEnemy  = isEnemy;
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
    // setPadding nötig, damit der Glow nicht an den Sprite-Grenzen abgeschnitten wird
    this.sprite.preFX?.setPadding(20);
    this.glowFx = this.sprite.preFX?.addGlow(profile.colorHex, 4, 0, false, 0.1, 16) ?? null;
    this.startDefaultGlowTween();

    this.stealthShell = scene.add.image(x, y, 'badger');
    this.stealthShell.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    this.stealthShell.setDepth(DEPTH.PLAYERS + 0.03);
    this.stealthShell.setTint(profile.colorHex);
    this.stealthShell.setBlendMode(Phaser.BlendModes.ADD);
    this.stealthShell.setVisible(false);

    this.stealthScan = scene.add.image(x, y, 'badger');
    this.stealthScan.setDisplaySize(PLAYER_SIZE, PLAYER_SIZE);
    this.stealthScan.setDepth(DEPTH.PLAYERS + 0.04);
    this.stealthScan.setTint(profile.colorHex);
    this.stealthScan.setBlendMode(Phaser.BlendModes.ADD);
    this.stealthScan.setVisible(false);

    // HP-Balken Hintergrund (dunkelgrau, zentriert)
    this.hpBarBg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, 0x333333);
    this.hpBarBg.setDepth(DEPTH.PLAYERS + 1);

    // HP-Balken Vordergrund (farbig, links ausgerichtet)
    this.hpBarFg = scene.add.rectangle(x, y + HP_BAR_OFFSET_Y, HP_BAR_WIDTH, HP_BAR_HEIGHT, isEnemy ? COLORS.RED_2 : 0x00cc44);
    this.hpBarFg.setOrigin(0, 0.5);   // linke Kante als Ankerpunkt → schrumpft von rechts
    this.hpBarFg.setDepth(DEPTH.PLAYERS + 2);

    this.armorBarBg = scene.add.rectangle(x, y + ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH, ARMOR_BAR_HEIGHT, 0x333333);
    this.armorBarBg.setDepth(DEPTH.PLAYERS + 1);
    this.armorBarBg.setVisible(false);

    this.armorBarFg = scene.add.rectangle(x, y + ARMOR_BAR_OFFSET_Y, ARMOR_BAR_WIDTH, ARMOR_BAR_HEIGHT, ARMOR_COLOR);
    this.armorBarFg.setOrigin(0, 0.5);
    this.armorBarFg.setDepth(DEPTH.PLAYERS + 2);
    this.armorBarFg.setVisible(false);

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

  isDecoyStealthedVisual(): boolean {
    return this.isDecoyStealthed;
  }

  setWorldBarsVisible(visible: boolean): void {
    this.worldBarsVisible = visible;
    this.applyDisplayVisibility();
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
    const hpY = this.sprite.y + HP_BAR_OFFSET_Y;
    const armorY = this.sprite.y + ARMOR_BAR_OFFSET_Y;
    this.hpBarBg.setPosition(x, hpY);
    this.hpBarFg.setPosition(x - HP_BAR_WIDTH / 2, hpY);
    this.armorBarBg.setPosition(x, armorY);
    this.armorBarFg.setPosition(x - ARMOR_BAR_WIDTH / 2, armorY);
    this.syncAttachedEffects();
  }

  /** HP-Wert aktualisieren und Balken neu zeichnen. */
  updateHP(hp: number): void {
    this.currentHp = Math.max(0, Math.min(HP_MAX, hp));
    const ratio    = this.currentHp / HP_MAX;
    this.hpBarFg.width = HP_BAR_WIDTH * ratio;
    const color = this.isEnemy
      ? (ratio > 0.5 ? COLORS.RED_2 : ratio > 0.25 ? COLORS.RED_3 : COLORS.RED_4)
      : (ratio > 0.5 ? 0x00cc44 : ratio > 0.25 ? 0xffcc00 : 0xff3300);
    this.hpBarFg.setFillStyle(color);
  }

  updateArmor(armor: number): void {
    this.currentArmor = Math.max(0, Math.min(ARMOR_MAX, armor));
    const ratio = this.currentArmor / ARMOR_MAX;
    this.armorBarFg.width = ARMOR_BAR_WIDTH * ratio;
    this.armorBarFg.setFillStyle(ARMOR_COLOR);
    const visible = this.sprite.visible && this.worldBarsVisible && this.currentArmor > 0;
    this.armorBarBg.setVisible(visible);
    this.armorBarFg.setVisible(visible);
  }

  updateBurnStacks(stacks: number): void {
    const nextStacks = Math.max(0, Math.floor(stacks));
    this.burnStacks = nextStacks;

    if (nextStacks <= 0) {
      this.burnRenderer?.destroy();
      this.burnRenderer = null;
      return;
    }

    if (!this.burnRenderer) {
      this.burnRenderer = new PlayerBurnRenderer(this.sprite.scene);
    }

    this.syncAttachedEffects();
  }

  /** Sprite und Balken ein-/ausblenden (Tod / Respawn). */
  setVisible(visible: boolean): void {
    this.baseVisible = visible;
    this.applyDisplayVisibility();

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

  getBurrowPhase(): BurrowPhase {
    return this.burrowPhase;
  }

  setBurrowPhase(phase: BurrowPhase, animate: boolean): void {
    const previousPhase = this.burrowPhase;
    const changed = previousPhase !== phase;
    if (!changed && !animate) return;

    this.burrowPhase = phase;

    if (changed && (phase === 'underground' || phase === 'trapped')) {
      this.stopBurrowTween(true);
      this.sprite.setScale(1, 1);
      this.burrowTweenAlpha = 1;
    }

    if (animate && phase === 'windup' && previousPhase === 'idle') {
      this.playWindUpTween();
    } else if (animate && phase === 'recovery' && (previousPhase === 'underground' || previousPhase === 'trapped')) {
      this.playPopOutTween();
    } else if (changed && phase === 'idle') {
      this.stopBurrowTween(true);
      this.sprite.setScale(1, 1);
      this.burrowTweenAlpha = 1;
    }

    this.resolveVisual();
  }

  /** Ultimate-Rage-Tint setzen (Spieler leuchtet rot). */
  setRageTint(active: boolean): void {
    this.isRagingVisual = active;
    this.resolveVisual();
  }

  setDecoyStealth(active: boolean): void {
    if (this.isDecoyStealthed === active) return;
    this.isDecoyStealthed = active;

    if (active) {
      this.glowTween?.stop();
      this.glowTween = null;
      this.stealthTween?.stop();
      this.stealthScanTween?.stop();
      const state = { alpha: 0.028, glow: 0.18, shellAlpha: 0.075, shellScaleX: 1.02, shellScaleY: 0.98, shellRotation: -0.02 };
      this.stealthTweenAlpha = state.alpha;
      this.stealthGlowStrength = state.glow;
      this.stealthShellAlpha = state.shellAlpha;
      this.stealthShellScaleX = state.shellScaleX;
      this.stealthShellScaleY = state.shellScaleY;
      this.stealthShellRotation = state.shellRotation;
      this.stealthScanProgress = 0;
      this.stealthTween = this.sprite.scene.tweens.add({
        targets: state,
        alpha: 0.045,
        glow: 0.42,
        shellAlpha: 0.13,
        shellScaleX: 1.055,
        shellScaleY: 1.035,
        shellRotation: 0.024,
        duration: 2600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          this.stealthTweenAlpha = state.alpha;
          this.stealthGlowStrength = state.glow;
          this.stealthShellAlpha = state.shellAlpha;
          this.stealthShellScaleX = state.shellScaleX;
          this.stealthShellScaleY = state.shellScaleY;
          this.stealthShellRotation = state.shellRotation;
          this.syncStealthOverlay();
          this.resolveVisual();
        },
      });
      this.stealthScanTween = this.sprite.scene.tweens.add({
        targets: this,
        stealthScanProgress: 1,
        duration: 1650,
        ease: 'Sine.easeInOut',
        repeat: -1,
        onRepeat: () => {
          this.stealthScanProgress = 0;
        },
        onUpdate: () => {
          this.syncStealthOverlay();
        },
      });
    } else {
      this.stealthTween?.stop();
      this.stealthTween = null;
      this.stealthScanTween?.stop();
      this.stealthScanTween = null;
      this.stealthTweenAlpha = 1;
      this.stealthGlowStrength = 4;
      this.stealthShellAlpha = 0;
      this.stealthShellScaleX = 1;
      this.stealthShellScaleY = 1;
      this.stealthShellRotation = 0;
      this.stealthScanProgress = 0;
      this.stealthShell?.setVisible(false);
      this.stealthScan?.setVisible(false);
      this.startDefaultGlowTween();
    }

    this.resolveVisual();
  }

  /**
   * Einheitliche Methode zur visuellen Darstellung.
   * Burrow arbeitet primär über Sichtbarkeit/Tweening, Rage nur noch über Glow.
   */
  private resolveVisual(): void {
    const alpha = this.burrowTweenAlpha * (this.isDecoyStealthed ? this.stealthTweenAlpha : 1);
    if (this.isRagingVisual) {
      this.sprite.setAlpha(alpha);
      if (this.glowFx) this.glowFx.color = 0xff3333;
    } else {
      this.sprite.setAlpha(alpha);
      if (this.glowFx) this.glowFx.color = this.colorHex;
    }
    if (this.glowFx && this.isDecoyStealthed) {
      this.glowFx.outerStrength = this.stealthGlowStrength;
      this.glowFx.innerStrength = 0;
    }
    this.applyDisplayVisibility();
    this.syncStealthOverlay();
    this.syncAttachedEffects();
  }

  private playWindUpTween(): void {
    this.stopBurrowTween(false);
    this.sprite.setVisible(this.baseVisible);
    this.sprite.setScale(1, 1);
    this.burrowTweenAlpha = 1;
    const state = { scaleX: 1, scaleY: 1, alpha: 1 };
    this.burrowTween = this.sprite.scene.tweens.add({
      targets: state,
      scaleX: 1.16,
      scaleY: 0.66,
      alpha: 0.72,
      duration: 150,
      ease: 'Cubic.easeIn',
      onUpdate: () => {
        this.sprite.setScale(state.scaleX, state.scaleY);
        this.burrowTweenAlpha = state.alpha;
        this.resolveVisual();
      },
      onComplete: () => {
        this.burrowTween = null;
        this.resolveVisual();
      },
    });
  }

  private playPopOutTween(): void {
    this.stopBurrowTween(false);
    this.sprite.setVisible(this.baseVisible);
    const state = { scaleX: 0.72, scaleY: 1.28, alpha: 0.55 };
    this.sprite.setScale(state.scaleX, state.scaleY);
    this.burrowTweenAlpha = state.alpha;
    this.resolveVisual();
    this.burrowTween = this.sprite.scene.tweens.add({
      targets: state,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 180,
      ease: 'Back.easeOut',
      onUpdate: () => {
        this.sprite.setScale(state.scaleX, state.scaleY);
        this.burrowTweenAlpha = state.alpha;
        this.resolveVisual();
      },
      onComplete: () => {
        this.burrowTween = null;
        this.resolveVisual();
      },
    });
  }

  private stopBurrowTween(resetAlpha: boolean): void {
    this.burrowTween?.stop();
    this.burrowTween = null;
    if (resetAlpha) this.burrowTweenAlpha = 1;
  }

  private applyDisplayVisibility(): void {
    const hiddenByBurrow = this.burrowPhase === 'underground' || this.burrowPhase === 'trapped';
    const visible = this.baseVisible && !hiddenByBurrow;
    const barsVisible = visible && this.worldBarsVisible && !this.isDecoyStealthed;
    const alpha = this.burrowTweenAlpha * (this.isDecoyStealthed ? this.stealthTweenAlpha : 1);
    this.sprite.setVisible(visible);
    this.hpBarBg.setVisible(barsVisible);
    this.hpBarFg.setVisible(barsVisible);
    this.armorBarBg.setVisible(barsVisible && this.currentArmor > 0);
    this.armorBarFg.setVisible(barsVisible && this.currentArmor > 0);
    this.hpBarBg.setAlpha(alpha * 0.92);
    this.hpBarFg.setAlpha(alpha);
    this.armorBarBg.setAlpha(alpha * 0.92);
    this.armorBarFg.setAlpha(alpha);
    this.stealthShell?.setVisible(visible && this.isDecoyStealthed);
    this.stealthScan?.setVisible(visible && this.isDecoyStealthed);
    this.syncAttachedEffects();
  }

  private syncStealthOverlay(): void {
    if (!this.stealthShell || !this.stealthScan) return;

    const visible = this.sprite.visible && this.isDecoyStealthed;
    this.stealthShell.setVisible(visible);
    this.stealthScan.setVisible(visible);
    if (!visible) return;

    const spriteScaleX = this.sprite.scaleX || 1;
    const spriteScaleY = this.sprite.scaleY || 1;
    const spriteRotation = this.sprite.rotation;

    this.stealthShell
      .setPosition(this.sprite.x, this.sprite.y)
      .setRotation(spriteRotation + this.stealthShellRotation)
      .setScale(spriteScaleX * this.stealthShellScaleX, spriteScaleY * this.stealthShellScaleY)
      .setAlpha(this.stealthShellAlpha)
      .setTint(this.colorHex);

    const frameWidth = this.stealthScan.frame.cutWidth;
    const frameHeight = this.stealthScan.frame.cutHeight;
    const cropWidth = Math.max(5, Math.round(frameWidth * 0.24));
    const scanX = Math.round((frameWidth - cropWidth) * Phaser.Math.Clamp(this.stealthScanProgress, 0, 1));
    const scanPulse = Math.sin(this.stealthScanProgress * Math.PI);
    const scanAlpha = 0.015 + scanPulse * 0.11;

    this.stealthScan
      .setPosition(this.sprite.x, this.sprite.y)
      .setRotation(spriteRotation)
      .setScale(spriteScaleX * 1.03, spriteScaleY * (0.985 + scanPulse * 0.07))
      .setAlpha(scanAlpha)
      .setTint(this.colorHex)
      .setCrop(scanX, 0, cropWidth, frameHeight);
  }

  private startDefaultGlowTween(): void {
    if (!this.glowFx) return;
    this.glowTween?.stop();
    this.glowTween = this.sprite.scene.tweens.add({
      targets:       this.glowFx,
      outerStrength: { from: 3, to: 7 },
      duration:      1000,
      yoyo:          true,
      repeat:        -1,
      ease:          'Sine.easeInOut',
    });
  }

  private syncAttachedEffects(): void {
    this.burnRenderer?.sync(this.sprite.x, this.sprite.y, PLAYER_SIZE, this.burnStacks, this.sprite.visible);
  }

  destroy(): void {
    this.stopBurrowTween(true);
    this.glowTween?.stop();
    this.stealthTween?.stop();
    this.stealthScanTween?.stop();
    this.burnRenderer?.destroy();
    this.hpBarBg.destroy();
    this.hpBarFg.destroy();
    this.armorBarBg.destroy();
    this.armorBarFg.destroy();
    this.sprite.destroy();
    this.stealthShell?.destroy();
    this.stealthScan?.destroy();
    this.deathSprite?.destroy();
  }
}
