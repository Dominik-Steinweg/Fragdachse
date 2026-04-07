import Phaser from 'phaser';
import type { SyncedNukeStrike } from '../types';
import { DEPTH, COLORS } from '../config';
import { NUKE_CONFIG } from './PowerUpConfig';
import type { EffectSystem } from '../effects/EffectSystem';
import type { GameAudioSystem } from '../audio/GameAudioSystem';

const TEX_NUKE_ICON = 'powerup_nuk';
const TEX_NUKE_WARN = '__nuke_warning_particle';

interface NukeVisual {
  radius:        Phaser.GameObjects.Arc;
  ring:          Phaser.GameObjects.Arc;
  outerRing:     Phaser.GameObjects.Arc;
  coreGlow:      Phaser.GameObjects.Arc;
  targetRing:    Phaser.GameObjects.Arc;
  icon:          Phaser.GameObjects.Image;
  shadow:        Phaser.GameObjects.Ellipse;
  sparks:        Phaser.GameObjects.Particles.ParticleEmitter;
  lastCountdown: number | null;
}

export class NukeRenderer {
  private visuals = new Map<number, NukeVisual>();
  private effectSystem: EffectSystem | null = null;
  private audioSystem: GameAudioSystem | null = null;

  constructor(private scene: Phaser.Scene) {}

  /** EffectSystem injizieren für gemeinsame Countdown-Text-Logik. */
  setEffectSystem(effectSystem: EffectSystem): void {
    this.effectSystem = effectSystem;
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  generateTextures(): void {
    if (!this.scene.textures.exists(TEX_NUKE_ICON)) {
      const size = 40;
      const canvas = this.scene.textures.createCanvas(TEX_NUKE_ICON, size, size);
      if (!canvas) return;

      const ctx = canvas.context;
      ctx.clearRect(0, 0, size, size);

      ctx.fillStyle = '#20140f';
      ctx.beginPath();
      ctx.arc(20, 24, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#cf573c';
      ctx.beginPath();
      ctx.arc(20, 20, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ebede9';
      ctx.fillRect(18, 6, 4, 7);
      ctx.fillRect(15, 9, 10, 4);

      ctx.fillStyle = '#241527';
      ctx.fillRect(18, 18, 4, 10);
      ctx.fillRect(14, 23, 12, 4);

      ctx.fillStyle = '#e8c170';
      ctx.beginPath();
      ctx.arc(20, 20, 4, 0, Math.PI * 2);
      ctx.fill();

      canvas.refresh();
    }

    if (!this.scene.textures.exists(TEX_NUKE_WARN)) {
      const warn = this.scene.textures.createCanvas(TEX_NUKE_WARN, 10, 10);
      if (!warn) return;
      const ctx = warn.context;
      const gradient = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(255,226,170,0.9)');
      gradient.addColorStop(0.75, 'rgba(207,87,60,0.45)');
      gradient.addColorStop(1, 'rgba(207,87,60,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 10, 10);
      warn.refresh();
    }
  }

  sync(nukes: SyncedNukeStrike[]): void {
    const activeIds = new Set<number>();
    const now = Date.now();

    for (const nuke of nukes) {
      activeIds.add(nuke.id);

      let visual = this.visuals.get(nuke.id);
      if (!visual) {
        visual = this.createVisual(nuke);
        this.visuals.set(nuke.id, visual);
        this.audioSystem?.playSound('sfx_nuke_countdown', nuke.x, nuke.y);
      }

      visual.radius.setPosition(nuke.x, nuke.y).setRadius(nuke.radius);
      visual.ring.setPosition(nuke.x, nuke.y).setRadius(nuke.radius);
      visual.outerRing.setPosition(nuke.x, nuke.y).setRadius(nuke.radius * 0.84);
      visual.targetRing.setPosition(nuke.x, nuke.y).setRadius(Math.max(44, nuke.radius * 0.085));
      visual.coreGlow.setPosition(nuke.x, nuke.y);
      visual.icon.setPosition(nuke.x, nuke.y);
      visual.shadow.setPosition(nuke.x, nuke.y + 16);
      visual.sparks.setPosition(nuke.x, nuke.y);

      const remainingSeconds = Math.max(0, Math.ceil((nuke.explodeAt - now) / 1000));
      if (remainingSeconds > 0 && visual.lastCountdown !== remainingSeconds) {
        visual.lastCountdown = remainingSeconds;
        this.emitCountdownText(nuke.x, nuke.y, remainingSeconds);
      }

      const progress = Phaser.Math.Clamp(1 - ((nuke.explodeAt - now) / NUKE_CONFIG.countdownMs), 0, 1);
      const pulse = 1 + 0.09 * Math.sin(now / 95 + nuke.id) + progress * 0.12;
      visual.icon.setScale(pulse);
      visual.ring.setAlpha(NUKE_CONFIG.circleStrokeAlpha + 0.16 * Math.sin(now / 135));
      visual.outerRing.setAlpha(0.22 + progress * 0.35);
      visual.coreGlow.setAlpha(0.16 + progress * 0.34);
      visual.targetRing.setAlpha(0.45 + progress * 0.4);
      visual.sparks.frequency = Math.max(28, 110 - progress * 80);

      if (progress > 0.72) {
        this.scene.cameras.main.shake(40, 0.0012 + progress * 0.0015);
      }
    }

    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(id);
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) {
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(nuke: SyncedNukeStrike): NukeVisual {
    const radius = this.scene.add.circle(nuke.x, nuke.y, nuke.radius, NUKE_CONFIG.warningColor, NUKE_CONFIG.circleFillAlpha);
    radius.setDepth(DEPTH.CANOPY - 1);
    radius.setBlendMode(Phaser.BlendModes.ADD);

    const ring = this.scene.add.circle(nuke.x, nuke.y, nuke.radius);
    ring.setStrokeStyle(4, COLORS.GOLD_1, NUKE_CONFIG.circleStrokeAlpha);
    ring.setDepth(DEPTH.CANOPY);
    ring.setBlendMode(Phaser.BlendModes.ADD);

    const outerRing = this.scene.add.circle(nuke.x, nuke.y, nuke.radius * 0.84);
    outerRing.setStrokeStyle(2, COLORS.RED_2, 0.28);
    outerRing.setDepth(DEPTH.CANOPY);
    outerRing.setBlendMode(Phaser.BlendModes.ADD);

    const coreGlow = this.scene.add.circle(nuke.x, nuke.y, 30, COLORS.RED_2, 0.24);
    coreGlow.setDepth(DEPTH.PLAYERS - 2);
    coreGlow.setBlendMode(Phaser.BlendModes.ADD);

    const targetRing = this.scene.add.circle(nuke.x, nuke.y, 44);
    targetRing.setStrokeStyle(3, COLORS.GREY_1, 0.68);
    targetRing.setDepth(DEPTH.PLAYERS - 1);
    targetRing.setBlendMode(Phaser.BlendModes.ADD);

    const shadow = this.scene.add.ellipse(nuke.x, nuke.y + 16, 34, 12, COLORS.GREY_10, 0.28);
    shadow.setDepth(DEPTH.PLAYERS - 2);

    const icon = this.scene.add.image(nuke.x, nuke.y, TEX_NUKE_ICON);
    icon.setDisplaySize(36, 36);
    icon.setDepth(DEPTH.PLAYERS - 1);

    const sparks = this.scene.add.particles(nuke.x, nuke.y, TEX_NUKE_WARN, {
      lifespan:  { min: 260, max: 620 },
      speed:     { min: 18, max: 48 },
      scale:     { start: 0.8, end: 0 },
      alpha:     { start: 0.85, end: 0 },
      tint:      [0xffffff, COLORS.GOLD_1, COLORS.RED_2],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 90,
      quantity:  1,
    });
    sparks.setDepth(DEPTH.PLAYERS - 1);

    this.scene.tweens.add({
      targets:  radius,
      alpha:    { from: NUKE_CONFIG.circleFillAlpha * 0.65, to: NUKE_CONFIG.circleFillAlpha * 1.35 },
      duration: 420,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });

    this.scene.tweens.add({
      targets:  outerRing,
      scaleX:   1.08,
      scaleY:   1.08,
      alpha:    { from: 0.18, to: 0.5 },
      duration: 540,
      yoyo:     true,
      repeat:   -1,
      ease:     'Quad.easeInOut',
    });

    this.scene.tweens.add({
      targets:  targetRing,
      scaleX:   1.2,
      scaleY:   1.2,
      alpha:    { from: 0.38, to: 0.82 },
      duration: 340,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });

    return {
      radius,
      ring,
      outerRing,
      coreGlow,
      targetRing,
      icon,
      shadow,
      sparks,
      lastCountdown: null,
    };
  }

  private emitCountdownText(x: number, y: number, value: number): void {
    // Delegiert an EffectSystem für gemeinsame Countdown-Logik
    if (this.effectSystem) {
      this.effectSystem.playCountdownText(x, y, value);
    }
  }

  private destroyVisual(visual: NukeVisual): void {
    visual.radius.destroy();
    visual.ring.destroy();
    visual.outerRing.destroy();
    visual.coreGlow.destroy();
    visual.targetRing.destroy();
    visual.icon.destroy();
    visual.shadow.destroy();
    visual.sparks.destroy();
  }
}