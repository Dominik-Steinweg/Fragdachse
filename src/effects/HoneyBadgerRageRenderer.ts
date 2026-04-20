import * as Phaser from 'phaser';
import { BLOOD_HIT_VFX, DEPTH } from '../config';
import type { GlowHandle } from '../utils/phaserFx';
import { TEX_BLOOD_DROPLET, TEX_BLOOD_STREAK, ensureBloodHitTextures, spawnBloodStain } from './BloodEffectShared';
import { circleZone, createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture, mixColors } from './EffectUtils';

const TEX_RAGE_AURA_OUTER = '__honey_badger_rage_aura_outer';
const TEX_RAGE_AURA_CORE = '__honey_badger_rage_aura_core';
const TEX_RAGE_AURA_RING = '__honey_badger_rage_aura_ring';

const RAGE_DEEP_COLOR = 0x5a0006;
const RAGE_CORE_COLOR = 0xb31217;
const RAGE_HOT_COLOR = 0xff6868;

const DEPTH_RAGE_AURA_OUTER = DEPTH.PLAYERS + 0.05;
const DEPTH_RAGE_AURA_CORE = DEPTH.PLAYERS + 0.07;
const DEPTH_RAGE_BLOOD = DEPTH.PLAYERS + 0.11;
const DEPTH_RAGE_SPLASH = DEPTH.PLAYERS + 0.15;
const DEPTH_RAGE_STAIN = DEPTH.PLAYERS - 0.05;

function ensureRageTextures(textures: Phaser.Textures.TextureManager): void {
  fillRadialGradientTexture(textures, TEX_RAGE_AURA_OUTER, 176, [
    [0, 'rgba(255,255,255,0.32)'],
    [0.34, 'rgba(255,255,255,0.18)'],
    [0.72, 'rgba(255,255,255,0.08)'],
    [1, 'rgba(255,255,255,0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_RAGE_AURA_CORE, 112, [
    [0, 'rgba(255,255,255,0.92)'],
    [0.24, 'rgba(255,255,255,0.5)'],
    [0.72, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)'],
  ]);

  ensureCanvasTexture(textures, TEX_RAGE_AURA_RING, 156, 156, (ctx) => {
    ctx.clearRect(0, 0, 156, 156);
    const center = 78;
    const gradient = ctx.createRadialGradient(center, center, 38, center, center, 74);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.16)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,0.62)');
    gradient.addColorStop(0.86, 'rgba(255,255,255,0.1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, 74, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(center, center, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  });
}

export class HoneyBadgerRageRenderer {
  private readonly outerAura: Phaser.GameObjects.Image;
  private readonly coreAura: Phaser.GameObjects.Image;
  private readonly ringAura: Phaser.GameObjects.Image;
  private readonly bloodEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly transient = new Set<Phaser.GameObjects.GameObject>();
  private active = false;
  private nextBurstAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sprite: Phaser.GameObjects.Image,
    private readonly glowFx: GlowHandle | null,
  ) {
    ensureBloodHitTextures(scene);
    ensureRageTextures(scene.textures);

    this.outerAura = scene.add.image(sprite.x, sprite.y, TEX_RAGE_AURA_OUTER)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH_RAGE_AURA_OUTER)
      .setVisible(false);

    this.coreAura = scene.add.image(sprite.x, sprite.y, TEX_RAGE_AURA_CORE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH_RAGE_AURA_CORE)
      .setVisible(false);

    this.ringAura = scene.add.image(sprite.x, sprite.y, TEX_RAGE_AURA_RING)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(DEPTH_RAGE_AURA_CORE + 0.01)
      .setVisible(false);

    this.bloodEmitter = createEmitter(scene, sprite.x, sprite.y, TEX_BLOOD_DROPLET, {
      lifespan: { min: 190, max: 340 },
      frequency: 38,
      quantity: 1,
      speed: { min: 20, max: 84 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.02, end: 0.1 },
      alpha: { start: 0.82, end: 0 },
      tint: [...BLOOD_HIT_VFX.palette],
      rotate: { min: -180, max: 180 },
      gravityY: 0,
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    }, DEPTH_RAGE_BLOOD);
    this.bloodEmitter.startFollow(sprite, 0, 0, false);
  }

  sync(x: number, y: number, bodySize: number, visible: boolean): void {
    if (!visible) {
      this.setActive(false);
      return;
    }

    this.setActive(true);

    const now = this.scene.time.now;
    const pulse = (Math.sin(now * 0.015) + 1) * 0.5;
    const throb = (Math.sin(now * 0.023 + 0.8) + 1) * 0.5;
    const baseScale = Math.max(bodySize / 48, 0.5);
    const outerTint = mixColors(RAGE_DEEP_COLOR, RAGE_CORE_COLOR, 0.22 + pulse * 0.16);
    const coreTint = mixColors(RAGE_CORE_COLOR, RAGE_HOT_COLOR, 0.28 + throb * 0.32);

    this.outerAura
      .setPosition(x, y)
      .setScale(baseScale * (1.95 + pulse * 0.34))
      .setAlpha(0.22 + pulse * 0.12)
      .setTint(outerTint);

    this.coreAura
      .setPosition(x, y)
      .setScale(baseScale * (1.22 + throb * 0.24))
      .setAlpha(0.3 + throb * 0.18)
      .setTint(coreTint);

    this.ringAura
      .setPosition(x, y)
      .setScale(baseScale * (1.46 + pulse * 0.26))
      .setRotation(now * 0.00115)
      .setAlpha(0.14 + throb * 0.12)
      .setTint(mixColors(RAGE_CORE_COLOR, RAGE_HOT_COLOR, 0.18 + pulse * 0.22));

    this.bloodEmitter.setPosition(x, y);
    this.bloodEmitter.clearEmitZones();
    this.bloodEmitter.addEmitZone(circleZone(Math.max(bodySize * (0.34 + pulse * 0.07), 8), 1));
    this.bloodEmitter.setParticleScale(0.92 + pulse * 0.34, 0.1);
    this.bloodEmitter.setAlpha(0.7 + throb * 0.16);
    this.bloodEmitter.setFrequency(34);

    if (this.glowFx) {
      this.glowFx.color = mixColors(RAGE_CORE_COLOR, RAGE_HOT_COLOR, 0.24 + throb * 0.28);
      this.glowFx.outerStrength = 10 + pulse * 6;
      this.glowFx.innerStrength = 0.65 + throb * 0.9;
    }

    if (now >= this.nextBurstAt) {
      this.playBloodBurst(x, y, bodySize);
      this.nextBurstAt = now + Phaser.Math.Between(150, 210);
    }
  }

  destroy(): void {
    destroyEmitter(this.bloodEmitter);
    this.outerAura.destroy();
    this.coreAura.destroy();
    this.ringAura.destroy();

    for (const object of this.transient) {
      if ('destroy' in object && typeof object.destroy === 'function') {
        object.destroy();
      }
    }
    this.transient.clear();
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      if (!active) {
        this.outerAura.setVisible(false);
        this.coreAura.setVisible(false);
        this.ringAura.setVisible(false);
      }
      return;
    }

    this.active = active;
    this.outerAura.setVisible(active);
    this.coreAura.setVisible(active);
    this.ringAura.setVisible(active);

    if (active) {
      this.bloodEmitter.start();
      return;
    }

    this.bloodEmitter.stop();
  }

  private playBloodBurst(x: number, y: number, bodySize: number): void {
    const streakCount = Phaser.Math.Between(3, 5);
    const dropletCount = Phaser.Math.Between(3, 5);
    const clusterAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const clusterSpread = Phaser.Math.DegToRad(42);
    const startRadius = bodySize * Phaser.Math.FloatBetween(0.16, 0.3);

    for (let index = 0; index < streakCount; index++) {
      const angle = clusterAngle + Phaser.Math.FloatBetween(-clusterSpread, clusterSpread);
      const startX = x + Math.cos(angle) * startRadius + Phaser.Math.FloatBetween(-5, 5);
      const startY = y + Math.sin(angle) * startRadius + Phaser.Math.FloatBetween(-5, 5);
      const travel = Phaser.Math.FloatBetween(bodySize * 1.35, bodySize * 2.45);
      const endX = startX + Math.cos(angle) * travel + Phaser.Math.FloatBetween(-8, 8);
      const endY = startY + Math.sin(angle) * travel + Phaser.Math.FloatBetween(-8, 8);
      const tint = this.pickBloodTint();
      const streak = this.scene.add.image(startX, startY, TEX_BLOOD_STREAK)
        .setDepth(DEPTH_RAGE_SPLASH)
        .setTint(tint)
        .setRotation(angle)
        .setScale(Phaser.Math.FloatBetween(0.35, 1.15))
        .setAlpha(0.84);
      this.transient.add(streak);

      const leaveStain = index < streakCount - 1 || Phaser.Math.Between(0, 100) < 45;
      this.scene.tweens.add({
        targets: streak,
        x: endX,
        y: endY,
        alpha: 0,
        scaleX: streak.scaleX * 1.24,
        scaleY: streak.scaleY * 0.9,
        duration: Phaser.Math.Between(210, 320),
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.transient.delete(streak);
          streak.destroy();
          if (leaveStain) {
            spawnBloodStain(this.scene, {
              x: endX,
              y: endY,
              scale: Phaser.Math.FloatBetween(0.86, 1.42),
              alpha: Phaser.Math.FloatBetween(0.34, 0.5),
              fadeMs: Phaser.Math.Between(7800, 10800),
              tint,
              rotation: Phaser.Math.FloatBetween(-Math.PI, Math.PI),
              depth: DEPTH_RAGE_STAIN,
              stainDelayMs: BLOOD_HIT_VFX.stainDelayMs,
            });
          }
        },
      });
    }

    for (let index = 0; index < dropletCount; index++) {
      const angle = clusterAngle + Phaser.Math.FloatBetween(-clusterSpread * 1.35, clusterSpread * 1.35);
      const startX = x + Math.cos(angle) * (startRadius * 0.68) + Phaser.Math.FloatBetween(-3, 3);
      const startY = y + Math.sin(angle) * (startRadius * 0.68) + Phaser.Math.FloatBetween(-3, 3);
      const travel = Phaser.Math.FloatBetween(bodySize * 0.95, bodySize * 1.85);
      const droplet = this.scene.add.image(startX, startY, TEX_BLOOD_DROPLET)
        .setDepth(DEPTH_RAGE_SPLASH + 0.01)
        .setTint(this.pickBloodTint())
        .setScale(Phaser.Math.FloatBetween(0.96, 1.46))
        .setRotation(Phaser.Math.FloatBetween(-Math.PI, Math.PI))
        .setAlpha(0.88);
      this.transient.add(droplet);

      this.scene.tweens.add({
        targets: droplet,
        x: startX + Math.cos(angle) * travel,
        y: startY + Math.sin(angle) * travel,
        alpha: 0,
        duration: Phaser.Math.Between(170, 260),
        ease: 'Quad.easeOut',
        onComplete: () => {
          this.transient.delete(droplet);
          droplet.destroy();
        },
      });
    }
  }

  private pickBloodTint(): number {
    const palette = BLOOD_HIT_VFX.palette;
    return palette[Phaser.Math.Between(0, palette.length - 1)] ?? palette[0];
  }
}