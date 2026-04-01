import Phaser from 'phaser';
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

const DEPTH_BURN_GLOW  = DEPTH.PLAYERS + 0.18;
const DEPTH_BURN_FLAME = DEPTH.PLAYERS + 0.24;
const DEPTH_BURN_SPARK = DEPTH.PLAYERS + 0.3;
const MAX_VISUAL_STACKS = 10;

export class PlayerBurnRenderer {
  private readonly coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glowImage: Phaser.GameObjects.Image;
  private active = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);

    this.coreEmitter = scene.add.particles(0, 0, TEX_FLAME_CORE, {
      lifespan:  { min: 170, max: 320 },
      frequency: 20,
      quantity:  2,
      speedX:    { min: -10, max: 10 },
      speedY:    { min: -34, max: -10 },
      scale:     { start: 0.36, end: 0.08 },
      alpha:     { start: 0.9, end: 0 },
      tint:      FLAME_COLORS_CORE,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    this.coreEmitter.setDepth(DEPTH_BURN_FLAME + 0.02);

    this.outerEmitter = scene.add.particles(0, 0, TEX_FLAME_EMBER, {
      lifespan:  { min: 240, max: 440 },
      frequency: 24,
      quantity:  2,
      speedX:    { min: -16, max: 16 },
      speedY:    { min: -42, max: -8 },
      scale:     { start: 0.48, end: 0.08 },
      alpha:     { start: 0.72, end: 0 },
      tint:      FLAME_COLORS_OUTER,
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    this.outerEmitter.setDepth(DEPTH_BURN_FLAME);

    this.sparkEmitter = scene.add.particles(0, 0, TEX_FLAME_SPARK, {
      lifespan:  { min: 120, max: 260 },
      frequency: 44,
      quantity:  1,
      speedX:    { min: -22, max: 22 },
      speedY:    { min: -62, max: -18 },
      scale:     { start: 0.6, end: 0.12 },
      alpha:     { start: 1, end: 0 },
      tint:      FLAME_COLORS_SPARK,
      gravityY:  -26,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    this.sparkEmitter.setDepth(DEPTH_BURN_SPARK);

    this.glowImage = scene.add.image(0, 0, TEX_FLAME_GLOW);
    this.glowImage.setBlendMode(Phaser.BlendModes.ADD);
    this.glowImage.setDepth(DEPTH_BURN_GLOW);
    this.glowImage.setVisible(false);
  }

  sync(x: number, y: number, bodySize: number, stacks: number, visible: boolean): void {
    const activeStacks = Math.max(0, Math.floor(stacks));
    if (activeStacks <= 0 || !visible) {
      this.setActive(false);
      return;
    }

    const intensity = Phaser.Math.Clamp(activeStacks, 1, MAX_VISUAL_STACKS) / MAX_VISUAL_STACKS;
    const spread = Math.max(bodySize * (0.45 + intensity * 0.38), 10);

    this.setActive(true);

    this.coreEmitter.setPosition(x, y + bodySize * 0.04);
    this.outerEmitter.setPosition(x, y + bodySize * 0.06);
    this.sparkEmitter.setPosition(x, y - bodySize * 0.05);
    this.glowImage.setPosition(x, y);

    this.coreEmitter.clearEmitZones();
    this.coreEmitter.addEmitZone(circleZone(spread * 0.46, 2));
    this.outerEmitter.clearEmitZones();
    this.outerEmitter.addEmitZone(circleZone(spread * 0.62, 2));
    this.sparkEmitter.clearEmitZones();
    this.sparkEmitter.addEmitZone(circleZone(spread * 0.54, 1));

    this.coreEmitter.setParticleScale(0.34 + intensity * 0.3, 0.08);
    this.outerEmitter.setParticleScale(0.44 + intensity * 0.4, 0.08);
    this.sparkEmitter.setParticleScale(0.5 + intensity * 0.24, 0.12);

    this.coreEmitter.setAlpha(0.52 + intensity * 0.38);
    this.outerEmitter.setAlpha(0.4 + intensity * 0.4);
    this.sparkEmitter.setAlpha(0.34 + intensity * 0.46);

    this.glowImage.setVisible(true);
    this.glowImage.setAlpha(0.18 + intensity * 0.34);
    this.glowImage.setScale(Math.max(bodySize / 48 * (1.5 + intensity * 1.25), 0.45));
    this.glowImage.setTint(0xffaa44);
  }

  destroy(): void {
    this.coreEmitter.stop();
    this.coreEmitter.destroy();
    this.outerEmitter.stop();
    this.outerEmitter.destroy();
    this.sparkEmitter.stop();
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

    this.coreEmitter.stop();
    this.outerEmitter.stop();
    this.sparkEmitter.stop();
    this.glowImage.setVisible(false);
  }
}