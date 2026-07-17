import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { circleZone } from './EffectUtils';
import {
  ensureFlameTextures,
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
  TEX_FLAME_GLOW,
} from './FlameShared';

const DEPTH_BURN_GLOW = DEPTH.PLAYERS + 0.18;
const DEPTH_BURN_OUTER = DEPTH.PLAYERS + 0.23;
const DEPTH_BURN_CORE = DEPTH.PLAYERS + 0.27;
const DEPTH_BURN_SPARK = DEPTH.PLAYERS + 0.32;
export const MAX_VISUAL_BURN_STACKS = 32;

/** Gemeinsamer, stackabhängiger Brand-Partikeleffekt für Spieler und Gegner. */
export class EntityBurnRenderer {
  private readonly coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glowImage: Phaser.GameObjects.Image;
  private active = false;
  private lastStacks = -1;
  private lastBodySize = -1;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);

    this.coreEmitter = scene.add.particles(0, 0, TEX_FLAME_CORE, {
      lifespan: { min: 190, max: 360 },
      frequency: 52,
      quantity: 1,
      speedX: { min: -15, max: 15 },
      speedY: { min: -58, max: -20 },
      scale: { start: 0.4, end: 0.04 },
      alpha: { start: 1, end: 0 },
      tint: FLAME_COLORS_CORE,
      rotate: { min: -25, max: 25 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH_BURN_CORE);

    this.outerEmitter = scene.add.particles(0, 0, TEX_FLAME_EMBER, {
      lifespan: { min: 300, max: 560 },
      frequency: 65,
      quantity: 1,
      speedX: { min: -24, max: 24 },
      speedY: { min: -52, max: -12 },
      scale: { start: 0.56, end: 0.08 },
      alpha: { start: 0.82, end: 0 },
      tint: FLAME_COLORS_OUTER,
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH_BURN_OUTER);

    this.sparkEmitter = scene.add.particles(0, 0, TEX_FLAME_SPARK, {
      lifespan: { min: 220, max: 520 },
      frequency: 115,
      quantity: 1,
      speedX: { min: -34, max: 34 },
      speedY: { min: -92, max: -34 },
      scale: { start: 0.68, end: 0.06 },
      alpha: { start: 1, end: 0 },
      tint: FLAME_COLORS_SPARK,
      gravityY: -34,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH_BURN_SPARK);

    this.glowImage = scene.add.image(0, 0, TEX_FLAME_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH_BURN_GLOW)
      .setTint(0xff8a24)
      .setVisible(false);
  }

  sync(x: number, y: number, bodySize: number, stacks: number, visible: boolean): void {
    const activeStacks = Math.max(0, Math.floor(stacks));
    if (activeStacks <= 0 || !visible) {
      this.setActive(false);
      return;
    }

    const clampedStacks = Math.min(activeStacks, MAX_VISUAL_BURN_STACKS);
    const intensity = Phaser.Math.Clamp(Math.log2(clampedStacks + 1) / 5, 0.2, 1);
    const spread = Math.max(bodySize * Phaser.Math.Linear(0.42, 0.88, intensity), 10);
    this.setActive(true);

    this.coreEmitter.setPosition(x, y + bodySize * 0.08);
    this.outerEmitter.setPosition(x, y + bodySize * 0.1);
    this.sparkEmitter.setPosition(x, y - bodySize * 0.02);
    this.glowImage.setPosition(x, y + bodySize * 0.03);

    if (clampedStacks !== this.lastStacks || bodySize !== this.lastBodySize) {
      this.lastStacks = clampedStacks;
      this.lastBodySize = bodySize;

      this.coreEmitter.clearEmitZones();
      this.coreEmitter.addEmitZone(circleZone(spread * 0.5, 4));
      this.outerEmitter.clearEmitZones();
      this.outerEmitter.addEmitZone(circleZone(spread * 0.7, 5));
      this.sparkEmitter.clearEmitZones();
      this.sparkEmitter.addEmitZone(circleZone(spread * 0.58, 3));

      this.coreEmitter.setFrequency(Math.round(Phaser.Math.Linear(52, 14, intensity)), clampedStacks >= 8 ? 2 : 1);
      this.outerEmitter.setFrequency(Math.round(Phaser.Math.Linear(65, 18, intensity)), clampedStacks >= 12 ? 2 : 1);
      this.sparkEmitter.setFrequency(Math.round(Phaser.Math.Linear(115, 32, intensity)), 1);

      this.coreEmitter.setParticleScale(0.38 + intensity * 0.34, 0.04);
      this.outerEmitter.setParticleScale(0.46 + intensity * 0.42, 0.06);
      this.sparkEmitter.setParticleScale(0.48 + intensity * 0.34, 0.05);
      this.coreEmitter.setAlpha(0.72 + intensity * 0.28);
      this.outerEmitter.setAlpha(0.55 + intensity * 0.34);
      this.sparkEmitter.setAlpha(0.62 + intensity * 0.38);
    }

    const pulse = 0.88 + Math.sin(this.scene.time.now * 0.018 + activeStacks * 0.7) * 0.12;
    this.glowImage
      .setVisible(true)
      .setAlpha((0.18 + intensity * 0.38) * pulse)
      .setScale(Math.max(bodySize / 48 * (1.3 + intensity * 1.15) * pulse, 0.42));
  }

  destroy(): void {
    this.coreEmitter.destroy();
    this.outerEmitter.destroy();
    this.sparkEmitter.destroy();
    this.glowImage.destroy();
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      if (!active) this.glowImage.setVisible(false);
      return;
    }

    this.active = active;
    if (active) {
      this.coreEmitter.start();
      this.outerEmitter.start();
      this.sparkEmitter.start();
      this.glowImage.setVisible(true);
      return;
    }

    this.coreEmitter.stop(true);
    this.outerEmitter.stop(true);
    this.sparkEmitter.stop(true);
    this.glowImage.setVisible(false);
  }
}
