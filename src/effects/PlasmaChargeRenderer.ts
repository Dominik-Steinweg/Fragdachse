import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import {
  PLASMA_CHARGE_MAX_STACKS,
} from '../systems/PlasmaCharge';
import { circleZone, ensureCanvasTexture, makeAdditive, registerParticleEmitter } from './EffectUtils';

export const MAX_PLASMA_CHARGE_STACKS = PLASMA_CHARGE_MAX_STACKS;

const TEX_CHARGE_CORE = '__plasma_charge_core';
const TEX_CHARGE_SPARK = '__plasma_charge_spark';
const TEX_CHARGE_GLOW = '__plasma_charge_glow';
const CHARGE_GLOW_DEPTH = DEPTH.PLAYERS + 0.16;
const CHARGE_CORE_DEPTH = DEPTH.PLAYERS + 0.24;
const CHARGE_SPARK_DEPTH = DEPTH.PLAYERS + 0.3;
const CHARGE_COLORS = [0xe8ffff, 0x8eeaff, 0x36cfff, 0x1397e8] as const;

/** Compact cyan/electric status VFX owned by one EnemyEntity. */
export class PlasmaChargeRenderer {
  private readonly coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly glowImage: Phaser.GameObjects.Image;
  private active = false;
  private lastStacks = -1;
  private lastBodySize = -1;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();

    this.coreEmitter = scene.add.particles(0, 0, TEX_CHARGE_CORE, {
      lifespan: { min: 260, max: 520 },
      frequency: 100,
      quantity: 1,
      speedX: { min: -18, max: 18 },
      speedY: { min: -30, max: 30 },
      scale: { start: 0.28, end: 0.04 },
      alpha: { start: 0.82, end: 0 },
      tint: [...CHARGE_COLORS],
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 28,
      emitting: false,
    }).setDepth(CHARGE_CORE_DEPTH);
    registerParticleEmitter(scene, 'plasmaCharge', this.coreEmitter);

    this.sparkEmitter = scene.add.particles(0, 0, TEX_CHARGE_SPARK, {
      lifespan: { min: 180, max: 380 },
      frequency: 190,
      quantity: 1,
      speed: { min: 30, max: 68 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.34, end: 0.03 },
      alpha: { start: 0.88, end: 0 },
      tint: [0xffffff, 0x9ff4ff, 0x42d6ff],
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      maxAliveParticles: 22,
      emitting: false,
    }).setDepth(CHARGE_SPARK_DEPTH);
    registerParticleEmitter(scene, 'plasmaCharge', this.sparkEmitter);

    this.glowImage = makeAdditive(
      scene.add.image(0, 0, TEX_CHARGE_GLOW)
        .setDepth(CHARGE_GLOW_DEPTH)
        .setTint(0x25cfff)
        .setVisible(false),
    );
  }

  sync(
    x: number,
    y: number,
    bodySize: number,
    stacks: number,
    visible: boolean,
  ): void {
    const activeStacks = Phaser.Math.Clamp(Math.floor(stacks), 0, MAX_PLASMA_CHARGE_STACKS);
    if (activeStacks <= 0 || !visible) {
      this.setActive(false);
      return;
    }

    const intensity = Phaser.Math.Clamp(activeStacks / MAX_PLASMA_CHARGE_STACKS, 0.12, 1);
    this.setActive(true);
    this.coreEmitter.setPosition(x, y);
    this.sparkEmitter.setPosition(x, y);
    this.glowImage.setPosition(x, y);

    if (activeStacks !== this.lastStacks || bodySize !== this.lastBodySize) {
      this.lastStacks = activeStacks;
      this.lastBodySize = bodySize;
      const spread = Math.max(8, bodySize * Phaser.Math.Linear(0.38, 0.72, intensity));
      this.coreEmitter.clearEmitZones();
      this.coreEmitter.addEmitZone(circleZone(spread * 0.54, 4));
      this.sparkEmitter.clearEmitZones();
      this.sparkEmitter.addEmitZone(circleZone(spread * 0.72, 3));

      this.coreEmitter.setFrequency(Math.round(120 - intensity * 80), activeStacks >= 7 ? 2 : 1);
      this.sparkEmitter.setFrequency(Math.round(210 - intensity * 145), 1 + Math.floor(activeStacks / 5));
      this.coreEmitter.setParticleScale(0.3 + intensity * 0.32, 0.04);
      this.sparkEmitter.setParticleScale(0.28 + intensity * 0.26, 0.03);
      this.coreEmitter.setAlpha(0.68 + intensity * 0.32);
      this.sparkEmitter.setAlpha(0.56 + intensity * 0.4);
    }

    const pulse = 0.9 + Math.sin(this.scene.time.now * 0.016 + activeStacks * 0.7) * 0.1;
    this.glowImage
      .setVisible(true)
      .setAlpha((0.12 + intensity * 0.34) * pulse)
      .setScale(Math.max(bodySize / 44 * (1.05 + intensity * 0.9) * pulse, 0.34));
  }

  destroy(): void {
    this.coreEmitter.destroy();
    this.sparkEmitter.destroy();
    this.glowImage.destroy();
  }

  private ensureTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_CHARGE_CORE, 24, 24, (ctx) => {
      const gradient = ctx.createRadialGradient(12, 12, 0, 12, 12, 12);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.26, 'rgba(128,239,255,0.92)');
      gradient.addColorStop(1, 'rgba(20,140,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 24, 24);
    });
    ensureCanvasTexture(this.scene.textures, TEX_CHARGE_SPARK, 24, 24, (ctx) => {
      ctx.translate(12, 12);
      ctx.strokeStyle = 'rgba(188,250,255,0.94)';
      ctx.shadowColor = 'rgba(38,208,255,0.85)';
      ctx.shadowBlur = 5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-9, 4);
      ctx.lineTo(-2, 1);
      ctx.lineTo(1, -7);
      ctx.lineTo(9, -3);
      ctx.stroke();
    });
    ensureCanvasTexture(this.scene.textures, TEX_CHARGE_GLOW, 72, 72, (ctx) => {
      const gradient = ctx.createRadialGradient(36, 36, 0, 36, 36, 36);
      gradient.addColorStop(0, 'rgba(72,224,255,0.32)');
      gradient.addColorStop(0.42, 'rgba(29,190,255,0.16)');
      gradient.addColorStop(1, 'rgba(9,120,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 72, 72);
    });
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      if (!active) this.glowImage.setVisible(false);
      return;
    }
    this.active = active;
    if (active) {
      this.coreEmitter.start();
      this.sparkEmitter.start();
      this.glowImage.setVisible(true);
      return;
    }
    this.coreEmitter.stop(true);
    this.sparkEmitter.stop(true);
    this.glowImage.setVisible(false);
  }
}
