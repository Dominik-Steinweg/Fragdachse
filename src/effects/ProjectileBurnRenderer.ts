import * as Phaser from 'phaser';
import { DEPTH, VOID_FIRE_COLOR } from '../config';
import type { GroundFireVisualStyle } from '../types';
import type { LightingSystem } from './LightingSystem';
import {
  ensureFlameTextures,
  ensureVoidFlameTextures,
  TEX_FLAME_GLOW,
  TEX_VOID_FLAME_GLOW,
  VOID_FLAME_COLORS_CORE,
  VOID_FLAME_COLORS_OUTER,
  VOID_FLAME_COLORS_SPARK,
} from './FlameShared';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';

interface BurningProjectileVisual {
  glow: Phaser.GameObjects.Image;
  x: number;
  y: number;
  lastEmitX: number;
  lastEmitY: number;
  lastEmitAt: number;
  size: number;
  visualStyle: GroundFireVisualStyle;
}

const MAX_TRAIL_SAMPLES_PER_SYNC = 7;
const TARGET_TRAIL_SAMPLES_PER_SYNC = 36;
const MIN_TRAIL_EMIT_INTERVAL_MS = 14;
const MAX_TRAIL_SAMPLES_PER_MS = 2.5;

/**
 * Die Trail-Palette ist eigenstaendig und bewusst nicht `FLAME_COLORS_*`: sie ist waermer und
 * kontrastreicher als das Standardfeuer, damit ein brennendes Projektil auch vor hellem Boden
 * lesbar bleibt.
 */
const TRAIL_COLORS_OUTER = [0xff7b21, 0xff4417, 0xe52611, 0xffad2f] as const;
const TRAIL_COLORS_CORE  = [0xffffff, 0xffe36b, 0xffa526, 0xff681c] as const;
const TRAIL_COLORS_SPARK = [0xffffff, 0xffd94f, 0xff7a22, 0xed2d15] as const;

/** Starkes, rendererunabhaengiges Brand-Overlay fuer schnelle und kleine Projektile. */
export class ProjectileBurnRenderer {
  private readonly visuals = new Map<number, BurningProjectileVisual>();
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private outerSpec: GpuVfxSpawnSpec | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;
  /**
   * Eine einzige Quelle fuer alle brennenden Projektile – die Emitter waren schon bisher global
   * geteilt. Ein verschwindendes Projektil laesst seinen Trail auslaufen ('linger'); erst
   * `destroyAll()` raeumt ihn ab.
   */
  private source = GPU_VFX_NO_SOURCE_HANDLE;

  constructor(private readonly scene: Phaser.Scene) {
    ensureFlameTextures(scene);
    ensureVoidFlameTextures(scene);
  }

  /** Meldet die drei Trail-Effekte beim szenenweiten GPUFX-Backend an. */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    // Die Lane traegt -30 px/s²; der Outer-Anteil entspricht den fruehreren -24 px/s².
    const outer = system.createSpec(GpuVfxEffectId.ProjectileBurnOuter);
    outer.yMode = GpuVfxEase.Gravity;
    outer.gravityFactor = 24 / 30;
    outer.scaleStart = 0.72;
    outer.scaleEnd = 0.04;
    outer.alphaStart = 0.94;
    outer.alphaEnd = 0;
    this.outerSpec = outer;

    // Der Kern stieg schon bisher ohne Gravity auf.
    const core = system.createSpec(GpuVfxEffectId.ProjectileBurnCore);
    core.scaleStart = 0.52;
    core.scaleEnd = 0.025;
    core.alphaStart = 1;
    core.alphaEnd = 0;
    this.coreSpec = core;

    const spark = system.createSpec(GpuVfxEffectId.ProjectileBurnSpark);
    spark.yMode = GpuVfxEase.Gravity;
    spark.scaleStart = 0.9;
    spark.scaleEnd = 0.04;
    spark.alphaStart = 1;
    spark.alphaEnd = 0;
    this.sparkSpec = spark;

    this.source = system.createSource(GpuVfxEffectId.ProjectileBurnOuter);
  }

  sync(
    id: number,
    x: number,
    y: number,
    size: number,
    burning: boolean,
    emitTrail = true,
    visualStyle: GroundFireVisualStyle = 'normal',
  ): void {
    if (!burning) {
      this.destroyVisual(id);
      return;
    }

    let visual = this.visuals.get(id);
    if (!visual) {
      const isVoid = visualStyle === 'void';
      const glow = this.scene.add.image(x, y, isVoid ? TEX_VOID_FLAME_GLOW : TEX_FLAME_GLOW)
        .setDepth(DEPTH.PROJECTILES + 0.28)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(isVoid ? VOID_FIRE_COLOR : 0xff4d18)
        .setAlpha(0.78);
      visual = {
        glow,
        x,
        y,
        lastEmitX: x,
        lastEmitY: y,
        lastEmitAt: this.scene.time.now,
        size,
        visualStyle,
      };
      this.visuals.set(id, visual);
      this.emitAt(x, y, size, 3, visualStyle);
    }

    if (visual.visualStyle !== visualStyle) {
      visual.visualStyle = visualStyle;
      const isVoid = visualStyle === 'void';
      visual.glow
        .setTexture(isVoid ? TEX_VOID_FLAME_GLOW : TEX_FLAME_GLOW)
        .setTint(isVoid ? VOID_FIRE_COLOR : 0xff4d18);
    }

    const now = this.scene.time.now;
    if (!emitTrail) {
      // Network snapshots correct the extrapolation anchor. Emission happens in
      // clientExtrapolate(), otherwise clients emit twice on snapshot frames.
      visual.lastEmitX = x;
      visual.lastEmitY = y;
    } else {
      const visualCount = Math.max(1, this.visuals.size);
      const minEmitInterval = Math.max(
        MIN_TRAIL_EMIT_INTERVAL_MS,
        visualCount / MAX_TRAIL_SAMPLES_PER_MS,
      );
      const dx = x - visual.lastEmitX;
      const dy = y - visual.lastEmitY;
      const distance = Math.hypot(dx, dy);
      const spacing = Math.max(3, Math.min(8, size * 0.75));

      if (distance > 0.01 && now - visual.lastEmitAt >= minEmitInterval) {
        // Share the fixed particle pools between all burning projectiles. With a
        // fully upgraded shotgun this deliberately becomes one sample per pellet
        // and update instead of silently exhausting the emitters for later pellets.
        const sampleBudget = Phaser.Math.Clamp(
          Math.floor(TARGET_TRAIL_SAMPLES_PER_SYNC / visualCount),
          1,
          MAX_TRAIL_SAMPLES_PER_SYNC,
        );
        const samples = Math.min(Math.ceil(distance / spacing), sampleBudget);
        for (let sample = 1; sample <= samples; sample++) {
          const t = sample / samples;
          this.emitAt(visual.lastEmitX + dx * t, visual.lastEmitY + dy * t, size, 1, visual.visualStyle);
        }
        visual.lastEmitX = x;
        visual.lastEmitY = y;
        visual.lastEmitAt = now;
      }
    }

    visual.x = x;
    visual.y = y;
    visual.size = size;
    const pulse = 0.88 + Math.sin(now * 0.024 + id * 1.7) * 0.12;
    visual.glow
      .setPosition(x, y)
      .setScale(Math.max(0.68, size / 11) * pulse)
      .setAlpha(0.66 + pulse * 0.18);

    // Dauerlicht am selben Lebenszyklus wie das Glow-Visual: erzeugt in `sync()`,
    // freigegeben in `destroyVisual()`. Der Radius bleibt eng – die Helligkeit kommt
    // aus Intensität und Kernfarbe des Presets, nicht aus der Reichweite.
    this.lighting?.setLight(`projburn:${id}`, visual.visualStyle === 'void' ? 'voidFlameProjectile' : 'projectileBurn', x, y, {
      radiusPx: 45 + size * 2.4,
    });
  }

  retain(activeBurningIds: ReadonlySet<number>): void {
    for (const id of this.visuals.keys()) {
      if (!activeBurningIds.has(id)) this.destroyVisual(id);
    }
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  destroyVisual(id: number): void {
    this.lighting?.releaseLight(`projburn:${id}`);
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.glow.destroy();
    this.visuals.delete(id);
  }

  destroyAll(): void {
    for (const id of [...this.visuals.keys()]) this.destroyVisual(id);
    // Die Quelle bleibt bestehen; nur ihre Member werden stillgelegt.
    this.gpuVfx?.clearSource(this.source);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.ProjectileBurnOuter);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.ProjectileBurnCore);
    this.gpuVfx?.quality.resetCarry(GpuVfxEffectId.ProjectileBurnSpark);
  }

  shutdown(): void {
    this.destroyAll();
  }

  /**
   * Ein Trail-Sample. Die Emission laeuft nicht ueber den GPUFX-Emissions-Tick, sondern direkt
   * aus dem CPU-Sync-Pfad: Sampling-Budget und Distanzinterpolation in `sync()` bestimmen
   * weiterhin, wann und wo ein Sample entsteht.
   */
  private emitAt(x: number, y: number, size: number, strength: number, visualStyle: GroundFireVisualStyle): void {
    const system = this.gpuVfx;
    if (!system || system.isSuppressed()) return;
    const jitter = Math.max(1.5, size * 0.35);
    const px = x + Phaser.Math.FloatBetween(-jitter, jitter);
    const py = y + Phaser.Math.FloatBetween(-jitter, jitter);
    const isVoid = visualStyle === 'void';
    // Der Spawn liegt ausserhalb des Emissions-Ticks; die Partikeluhr steht auf dem Vorframe.
    const nowMs = system.now();

    this.spawnTrailOuter(px, py, Math.max(1, strength), isVoid, nowMs);
    this.spawnTrailCore(px, py + 1, isVoid, nowMs);
    if ((Math.floor(this.scene.time.now) + Math.round(x + y)) % 3 === 0) {
      this.spawnTrailSpark(px, py, isVoid, nowMs);
    }
  }

  /**
   * Burst-Politik der Grafikqualitaet, identisch zum fruehreren `emitParticleAt`-Wrapper samt
   * Nachkomma-Uebertrag. Die Differenz wird als Qualitaets-Drop gebucht.
   */
  private admitTrailBurst(effect: GpuVfxEffectId, count: number): number {
    const system = this.gpuVfx;
    if (!system) return 0;
    const amount = system.quality.scaleBurst(effect, count);
    if (amount < count) system.recordQualityDrop(effect, count - amount);
    return amount;
  }

  private spawnTrailOuter(x: number, y: number, count: number, isVoid: boolean, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.outerSpec;
    if (!system || !spec) return;
    const amount = this.admitTrailBurst(GpuVfxEffectId.ProjectileBurnOuter, count);
    if (amount <= 0) return;

    spec.frame = isVoid ? GpuVfxFrameId.FlameOuterVoid : GpuVfxFrameId.FlameOuter;
    const tints = isVoid ? VOID_FLAME_COLORS_OUTER : TRAIL_COLORS_OUTER;
    spec.x = x;
    spec.y = y;
    for (let index = 0; index < amount; index += 1) {
      spec.lifeMs = Phaser.Math.FloatBetween(170, 360);
      spec.vx = Phaser.Math.FloatBetween(-25, 25);
      spec.vy = Phaser.Math.FloatBetween(-55, -15);
      spec.tint = pickGpuVfxTint(tints);
      system.spawn(spec, this.source, nowMs);
    }
  }

  private spawnTrailCore(x: number, y: number, isVoid: boolean, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.coreSpec;
    if (!system || !spec) return;
    if (this.admitTrailBurst(GpuVfxEffectId.ProjectileBurnCore, 1) <= 0) return;

    spec.frame = isVoid ? GpuVfxFrameId.FlameCoreVoid : GpuVfxFrameId.FlameCore;
    spec.lifeMs = Phaser.Math.FloatBetween(120, 250);
    spec.x = x;
    spec.y = y;
    spec.vx = Phaser.Math.FloatBetween(-15, 15);
    spec.vy = Phaser.Math.FloatBetween(-42, -9);
    spec.tint = pickGpuVfxTint(isVoid ? VOID_FLAME_COLORS_CORE : TRAIL_COLORS_CORE);
    system.spawn(spec, this.source, nowMs);
  }

  private spawnTrailSpark(x: number, y: number, isVoid: boolean, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.sparkSpec;
    if (!system || !spec) return;
    if (this.admitTrailBurst(GpuVfxEffectId.ProjectileBurnSpark, 1) <= 0) return;

    spec.frame = isVoid ? GpuVfxFrameId.FlameSparkVoid : GpuVfxFrameId.FlameSpark;
    spec.lifeMs = Phaser.Math.FloatBetween(170, 380);
    spec.x = x;
    spec.y = y;
    spec.vx = Phaser.Math.FloatBetween(-52, 52);
    spec.vy = Phaser.Math.FloatBetween(-105, -36);
    spec.tint = pickGpuVfxTint(isVoid ? VOID_FLAME_COLORS_SPARK : TRAIL_COLORS_SPARK);
    system.spawn(spec, this.source, nowMs);
  }
}
