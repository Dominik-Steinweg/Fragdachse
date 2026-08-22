import * as Phaser from 'phaser';
import { emissiveAlpha } from './EmissiveScale';
import {
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
} from './FlameShared';
import {
  GpuVfxEffectId,
  type GpuVfxEffectId as GpuVfxEffectIdType,
} from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import {
  GPU_VFX_NO_SOURCE_HANDLE,
  type GpuVfxSystem,
} from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

const TWO_PI = Math.PI * 2;
type GpuVfxMotionEase = typeof GpuVfxEase.Linear | typeof GpuVfxEase.Gravity;

interface ParticleSetup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  scaleStart: number;
  scaleEnd: number;
  alphaStart: number;
  tint: number;
  yMode?: GpuVfxMotionEase;
  gravityFactor?: number;
  rotation?: number;
  angularVelocity?: number;
}

/**
 * GPU-only burst renderer for the particle layers owned by EffectSystem explosions.
 *
 * The controller deliberately has no source handles: an explosion is a one-shot visual
 * burst, and every member owns its own lifetime in the shared GPU pool.
 */
export class ExplosionGpuRenderer {
  private gpuVfx: GpuVfxSystem | null = null;
  private readonly specs = new Map<GpuVfxEffectIdType, GpuVfxSpawnSpec>();

  registerGpuVfx(system: GpuVfxSystem): void {
    this.gpuVfx = system;
    this.specs.clear();
    const effects: readonly GpuVfxEffectIdType[] = [
      GpuVfxEffectId.ExplosionSpark,
      GpuVfxEffectId.ExplosionEmberDown,
      GpuVfxEffectId.ExplosionEmberUp,
      GpuVfxEffectId.ExplosionAccent,
      GpuVfxEffectId.ExplosionCascade,
      GpuVfxEffectId.ExplosionTrainChunk,
      GpuVfxEffectId.ExplosionTrainSpark,
      GpuVfxEffectId.ExplosionLightningSpark,
      GpuVfxEffectId.ExplosionHolyCrown,
      GpuVfxEffectId.ExplosionTrainCore,
      GpuVfxEffectId.ExplosionNukePlume,
      GpuVfxEffectId.ExplosionNukeFallout,
      GpuVfxEffectId.ExplosionRegeneration,
    ];
    for (const effect of effects) this.specs.set(effect, system.createSpec(effect));
  }

  spawnTimebombPop(x: number, y: number, radius: number, popColor: number): void {
    this.spawnRadial(
      GpuVfxEffectId.ExplosionAccent,
      x,
      y,
      9,
      160,
      320,
      radius * 0.45,
      radius * 1.4,
      0.75,
      0,
      0.8,
      [0xffffff, 0xd58aff, popColor],
    );
  }

  spawnStandardSpark(
    x: number,
    y: number,
    count: number,
    lifespanMin: number,
    lifespanMax: number,
    speedMin: number,
    speedMax: number,
    scaleStart: number,
    alphaStart: number,
    tints: readonly number[],
  ): void {
    this.spawnRadial(
      GpuVfxEffectId.ExplosionSpark,
      x,
      y,
      count,
      lifespanMin,
      lifespanMax,
      speedMin,
      speedMax,
      scaleStart,
      0,
      alphaStart,
      tints,
    );
  }

  spawnEnergyArc(
    x: number,
    y: number,
    radius: number,
    count: number,
    tints: readonly number[],
  ): void {
    this.spawnBurst(GpuVfxEffectId.ExplosionAccent, count, (spec, index, amount) => {
      const angle = (index / Math.max(1, amount)) * TWO_PI;
      const edgeRadius = radius * 0.28;
      const speed = Phaser.Math.FloatBetween(radius * 0.35, radius * 0.85);
      const velocityAngle = Phaser.Math.FloatBetween(0, TWO_PI);
      this.configure(spec, {
        x: x + Math.cos(angle) * edgeRadius,
        y: y + Math.sin(angle) * edgeRadius,
        vx: Math.cos(velocityAngle) * speed,
        vy: Math.sin(velocityAngle) * speed,
        lifeMs: Phaser.Math.FloatBetween(180, 360),
        scaleStart: 1.1,
        scaleEnd: 0,
        alphaStart: 0.8,
        tint: pickGpuVfxTint(tints),
      });
    });
  }

  spawnEmber(
    x: number,
    y: number,
    count: number,
    lifespanMin: number,
    lifespanMax: number,
    speedMin: number,
    speedMax: number,
    scaleStart: number,
    scaleEnd: number,
    alphaStart: number,
    tints: readonly number[],
    gravityY: number,
  ): void {
    const effect = gravityY < 0
      ? GpuVfxEffectId.ExplosionEmberUp
      : GpuVfxEffectId.ExplosionEmberDown;
    const gravityFactor = gravityY < 0 ? Math.abs(gravityY) / 180 : gravityY / 40;
    this.spawnRadial(
      effect,
      x,
      y,
      count,
      lifespanMin,
      lifespanMax,
      speedMin,
      speedMax,
      scaleStart,
      scaleEnd,
      alphaStart,
      tints,
      GpuVfxEase.Gravity,
      gravityFactor,
    );
  }

  spawnCascadeSparks(
    x: number,
    y: number,
    radius: number,
    count: number,
    tints: readonly number[],
  ): void {
    this.spawnRadial(
      GpuVfxEffectId.ExplosionCascade,
      x,
      y,
      count,
      240,
      520,
      radius * 0.45,
      radius * 1.65,
      1.05,
      0,
      0.78,
      tints,
    );
  }

  spawnHolyCrown(x: number, y: number, radius: number, count: number): void {
    this.spawnBurst(GpuVfxEffectId.ExplosionHolyCrown, count, (spec) => {
      this.configure(spec, {
        x,
        y: y - radius * 0.05,
        vx: Phaser.Math.FloatBetween(-radius * 0.42, radius * 0.42),
        vy: Phaser.Math.FloatBetween(-radius * 1.35, -radius * 0.5),
        lifeMs: Phaser.Math.FloatBetween(520, 980),
        scaleStart: 1.6,
        scaleEnd: 0.04,
        alphaStart: 0.9,
        tint: pickGpuVfxTint([0xffffff, 0xfff1b8, 0xffcf57]),
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
      });
    });
  }

  spawnNuke(
    x: number,
    y: number,
    radius: number,
    sparkCount: number,
    emberCount: number,
    plumeCount: number,
    falloutCount: number,
  ): void {
    this.spawnRadial(
      GpuVfxEffectId.ExplosionSpark,
      x,
      y,
      sparkCount,
      450,
      1100,
      radius * 0.65,
      radius * 2.8,
      2.2,
      0,
      1,
      [0xffffff, 0xfff0b8, 0xffa348, 0xff6422],
    );
    this.spawnRadial(
      GpuVfxEffectId.ExplosionEmberUp,
      x,
      y,
      emberCount,
      900,
      1800,
      radius * 0.2,
      radius * 1.1,
      1.3,
      0.18,
      0.92,
      [0xffd27a, 0xff8f42, 0x6a2a1b, 0x2e1d23],
      GpuVfxEase.Gravity,
      1,
    );
    this.spawnBurst(GpuVfxEffectId.ExplosionNukePlume, plumeCount, (spec) => {
      this.configure(spec, {
        x,
        y: y + radius * 0.06,
        vx: Phaser.Math.FloatBetween(-radius * 0.1, radius * 0.1),
        vy: Phaser.Math.FloatBetween(-radius * 0.95, -radius * 0.35),
        lifeMs: Phaser.Math.FloatBetween(950, 1800),
        scaleStart: 2.4,
        scaleEnd: 0.15,
        alphaStart: 0.7,
        tint: pickGpuVfxTint([0xfff4d8, 0xffb347, 0x583a43, 0x20202b]),
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
      });
    });
    this.spawnBurst(GpuVfxEffectId.ExplosionNukeFallout, falloutCount, (spec) => {
      this.configure(spec, {
        x,
        y: y - radius * 0.1,
        vx: Phaser.Math.FloatBetween(-radius * 0.22, radius * 0.22),
        vy: Phaser.Math.FloatBetween(-radius * 0.3, radius * 0.1),
        lifeMs: Phaser.Math.FloatBetween(1200, 2200),
        scaleStart: 1.05,
        scaleEnd: 0.12,
        alphaStart: 0.55,
        tint: pickGpuVfxTint([0x3b2a33, 0x5a3e42, 0x8a5c43]),
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
      });
    });
  }

  spawnTrainExplosion(x: number, y: number, radius: number, coreColor: number, haloColor: number): void {
    this.spawnBurst(GpuVfxEffectId.ExplosionTrainChunk, Math.max(48, Math.ceil(radius * 1.05)), (spec) => {
      const point = this.randomPointInCircle(Math.max(6, radius * 0.24));
      const speed = Phaser.Math.FloatBetween(radius * 0.42, radius * 2.15);
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      this.configure(spec, {
        x: x + point.x,
        y: y + point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs: Phaser.Math.FloatBetween(620, 1450),
        scaleStart: 1.65,
        scaleEnd: 0.08,
        alphaStart: emissiveAlpha(0.96),
        tint: pickGpuVfxTint([0xffffff, ...FLAME_COLORS_CORE, ...FLAME_COLORS_OUTER]),
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        angularVelocity: Phaser.Math.DegToRad(Phaser.Math.FloatBetween(-180, 180)),
      });
    });
    this.spawnRadial(
      GpuVfxEffectId.ExplosionTrainSpark,
      x,
      y,
      Math.max(28, Math.ceil(radius * 0.62)),
      260,
      720,
      radius * 0.55,
      radius * 2.45,
      1.4,
      0,
      emissiveAlpha(1),
      [0xffffff, ...FLAME_COLORS_SPARK, coreColor],
      GpuVfxEase.Gravity,
      1,
    );
    this.spawnRadial(
      GpuVfxEffectId.ExplosionTrainCore,
      x,
      y,
      Math.max(16, Math.ceil(radius * 0.38)),
      320,
      860,
      radius * 0.28,
      radius * 1.25,
      1.05,
      0.05,
      emissiveAlpha(0.84),
      [0xffffff, coreColor, haloColor],
      GpuVfxEase.Gravity,
      1,
    );
  }

  spawnLightning(x: number, y: number, radius: number, count: number, color: number, coreColor: number, outerColor: number): void {
    this.spawnRadial(
      GpuVfxEffectId.ExplosionLightningSpark,
      x,
      y,
      count,
      260,
      620,
      radius * 0.35,
      radius * 1.8,
      1.4,
      0,
      1,
      [0xffffff, coreColor, color, outerColor],
    );
  }

  spawnRegeneration(x: number, y: number, radius: number, count: number, color: number, brightColor: number): void {
    this.spawnBurst(GpuVfxEffectId.ExplosionRegeneration, count, (spec) => {
      this.configure(spec, {
        x,
        y,
        vx: Phaser.Math.FloatBetween(-radius * 0.35, radius * 0.35),
        vy: Phaser.Math.FloatBetween(-radius * 1.5, -radius * 0.6),
        lifeMs: Phaser.Math.FloatBetween(380, 720),
        scaleStart: 0.85,
        scaleEnd: 0,
        alphaStart: 0.9,
        tint: pickGpuVfxTint([0xffffff, brightColor, color]),
      });
    });
  }

  private spawnRadial(
    effect: GpuVfxEffectIdType,
    x: number,
    y: number,
    count: number,
    lifespanMin: number,
    lifespanMax: number,
    speedMin: number,
    speedMax: number,
    scaleStart: number,
    scaleEnd: number,
    alphaStart: number,
    tints: readonly number[],
    yMode: GpuVfxMotionEase = GpuVfxEase.Linear,
    gravityFactor = 1,
  ): void {
    this.spawnBurst(effect, count, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(speedMin, speedMax);
      this.configure(spec, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs: Phaser.Math.FloatBetween(lifespanMin, lifespanMax),
        scaleStart,
        scaleEnd,
        alphaStart,
        tint: pickGpuVfxTint(tints),
        yMode,
        gravityFactor,
      });
    });
  }

  private spawnBurst(
    effect: GpuVfxEffectIdType,
    count: number,
    configure: (spec: GpuVfxSpawnSpec, index: number, amount: number) => void,
  ): void {
    const system = this.gpuVfx;
    const spec = this.specs.get(effect);
    if (!system || !spec || count <= 0) return;

    const amount = system.quality.scaleBurst(effect, count);
    if (amount < count) system.recordQualityDrop(effect, count - amount);
    const nowMs = system.now();
    for (let index = 0; index < amount; index += 1) {
      configure(spec, index, amount);
      system.spawn(spec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }

  private configure(spec: GpuVfxSpawnSpec, setup: ParticleSetup): void {
    spec.x = setup.x;
    spec.y = setup.y;
    spec.vx = setup.vx;
    spec.vy = setup.vy;
    spec.yMode = setup.yMode ?? GpuVfxEase.Linear;
    spec.gravityFactor = setup.gravityFactor ?? 1;
    spec.rotation = setup.rotation ?? 0;
    spec.angularVelocity = setup.angularVelocity ?? 0;
    spec.lifeMs = setup.lifeMs;
    spec.scaleStart = setup.scaleStart;
    spec.scaleEnd = setup.scaleEnd;
    spec.scaleEase = GpuVfxEase.Linear;
    spec.stretchStart = 1;
    spec.stretchEnd = 1;
    spec.alphaStart = setup.alphaStart;
    spec.alphaEnd = 0;
    spec.alphaEase = GpuVfxEase.Linear;
    spec.tint = setup.tint;
    spec.tintBlendStart = 1;
    spec.tintBlendEnd = 1;
  }

  private randomPointInCircle(radius: number): { x: number; y: number } {
    const angle = Phaser.Math.FloatBetween(0, TWO_PI);
    const distance = Math.sqrt(Math.random()) * radius;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }
}
