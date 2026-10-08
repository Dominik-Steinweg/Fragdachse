import type * as Phaser from 'phaser';
import { VOID_PALETTE } from '../config';
import { VOID_SPARKS_INTRO, type BossIntroState } from '../config/bossIntros';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import { clearCameraFocusOverride, setCameraFocusOverride } from '../graphics/cameraFocusOverride';
import type { BossPresenceSource } from './BossPresenceRenderer';
import type { LightingSystem } from './LightingSystem';
import { getGpuVfxFrame, GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

const EFFECT = GpuVfxEffectId.VoidHunterSpark;
const INTRO_KEY = 'intro';
const LIGHT_COUNT = 6;

interface SparkLight {
  x: number; y: number; vx: number; vy: number;
  bornAt: number; lifeMs: number;
}

interface SparkSource {
  source: number;
  x: number; y: number; size: number;
  phase: number;
  /** null for a living boss; otherwise synchronized time since intro start. */
  introElapsed: number | null;
  randomState: number;
  readonly flow: ParticleFlowScheduler;
  readonly lights: SparkLight[];
}

/** GPU sparks for the replicated boss/intro, with a bounded sample lighting the actual trajectories. */
export class VoidHunterSparksRenderer {
  private readonly sources = new Map<string, SparkSource>();
  private readonly view = createVisibleWorldView();
  private readonly spark;
  private readonly glow;
  private readonly stopEmission: () => void;
  private generation: number;
  private introIdentity: string | null = null;
  private destroyed = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly gpu: GpuVfxSystem,
    private readonly lighting: LightingSystem,
  ) {
    this.spark = gpu.createSpec(EFFECT);
    this.glow = gpu.createSpec(EFFECT);
    this.glow.frame = GpuVfxFrameId.DeathGlow;
    this.generation = gpu.emissionGeneration;
    this.stopEmission = gpu.registerEmission((delta, now) => this.emit(delta, now));
  }

  syncBosses(bosses: readonly BossPresenceSource[]): void {
    if (this.destroyed) return;
    // Suppressed GPU ticks do not call emit; the presentation frame still owns light cleanup.
    if (this.gpu.isSuppressed()) {
      for (const [key, source] of this.sources) this.releaseVisuals(key, source);
      return;
    }
    const active = new Set<string>();
    for (const boss of bosses) {
      if (!boss.voidPhase || !boss.visible) continue;
      const key = `boss:${boss.id}`;
      active.add(key);
      const source = this.sources.get(key) ?? this.createSource(key, hashId(boss.id));
      source.x = boss.x; source.y = boss.y; source.size = boss.size;
      source.phase = boss.voidPhase;
    }
    for (const key of this.sources.keys()) {
      if (key !== INTRO_KEY && !active.has(key)) this.removeSource(key);
    }
  }

  ownsSpawnAt(state: BossIntroState | null, now: number): boolean {
    if (state?.preset !== 'void-sparks') return false;
    const elapsed = now - state.startedAtMs;
    return elapsed >= 0 && elapsed <= VOID_SPARKS_INTRO.durationMs + 4_000;
  }

  syncIntro(state: BossIntroState | null, now: number): void {
    if (this.destroyed) return;
    const elapsed = state ? now - state.startedAtMs : -1;
    if (state?.preset !== 'void-sparks' || elapsed < 0 || elapsed > VOID_SPARKS_INTRO.durationMs) {
      this.clearIntro();
      return;
    }
    const identity = `${state.startedAtMs}:${state.seed}:${state.x}:${state.y}`;
    if (identity !== this.introIdentity) {
      this.clearIntro();
      this.introIdentity = identity;
    }
    const source = this.sources.get(INTRO_KEY) ?? this.createSource(INTRO_KEY, state.seed);
    source.x = state.x; source.y = state.y;
    source.introElapsed = elapsed;
    const focus = Math.min(1, elapsed / 750, (VOID_SPARKS_INTRO.durationMs - elapsed) / 800);
    setCameraFocusOverride(this.scene, state.x, state.y, focus, 1.25);
  }

  clear(): void {
    this.clearIntro();
    for (const key of this.sources.keys()) this.removeSource(key);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.stopEmission();
    this.destroyed = true;
  }

  private clearIntro(): void {
    if (this.introIdentity !== null) clearCameraFocusOverride(this.scene);
    this.introIdentity = null;
    this.removeSource(INTRO_KEY);
  }

  private createSource(key: string, seed: number): SparkSource {
    const source: SparkSource = {
      source: -1, x: 0, y: 0, size: 0, phase: 1, introElapsed: null,
      randomState: seed || 1, flow: new ParticleFlowScheduler(0),
      lights: Array.from({ length: LIGHT_COUNT }, () => ({ x: 0, y: 0, vx: 0, vy: 0, bornAt: 0, lifeMs: 0 })),
    };
    this.sources.set(key, source);
    return source;
  }

  private removeSource(key: string): void {
    const source = this.sources.get(key);
    if (!source) return;
    this.releaseVisuals(key, source);
    this.sources.delete(key);
  }

  private releaseVisuals(key: string, source: SparkSource): void {
    if (source.source >= 0) this.gpu.releaseSource(source.source);
    source.source = -1;
    source.flow.resetCountdown();
    for (let i = 0; i < LIGHT_COUNT; i++) {
      source.lights[i].lifeMs = 0;
      this.lighting.releaseLight(`voidSparks:${key}:${i}`, { immediate: true });
    }
  }

  private emit(delta: number, now: number): void {
    if (this.generation !== this.gpu.emissionGeneration) {
      for (const [key, source] of this.sources) this.releaseVisuals(key, source);
      this.generation = this.gpu.emissionGeneration;
    }
    const view = getVisibleWorldView(this.scene.cameras.main, this.view);
    for (const [key, source] of this.sources) {
      const intro = source.introElapsed !== null;
      const elapsed = source.introElapsed ?? 0;
      const progress = Math.min(1, elapsed / VOID_SPARKS_INTRO.emergeAtMs);
      const afterSpawn = elapsed >= VOID_SPARKS_INTRO.emergeAtMs;
      const fade = intro ? Math.min(1, (VOID_SPARKS_INTRO.durationMs - elapsed) / 800) : 1;
      const rate = intro ? (220 + progress * progress * 950) * fade : source.phase >= 2 ? 170 : 110;
      const frequency = this.gpu.quality.scaleFrequency(1000 / Math.max(1, rate), EFFECT);
      const inView = source.x + 240 >= view.x && source.x - 240 <= view.right
        && source.y + 240 >= view.y && source.y - 240 <= view.bottom;
      if (this.gpu.isSuppressed() || frequency <= 0 || !inView) {
        this.releaseVisuals(key, source);
        continue;
      }
      if (source.source < 0) source.source = this.gpu.createSource(EFFECT);
      if (source.source < 0) continue;
      source.flow.setFrequency(frequency);
      const count = Math.min(160, source.flow.tick(Math.max(0, Math.min(100, delta))));
      for (let i = 0; i < count; i++) this.spawnSpark(source, now, intro, progress, afterSpawn);
      for (let i = 0; i < LIGHT_COUNT; i++) {
        const light = source.lights[i];
        const age = now - light.bornAt;
        const lightKey = `voidSparks:${key}:${i}`;
        if (age >= light.lifeMs) {
          this.lighting.releaseLight(lightKey, { immediate: true });
          continue;
        }
        const t = age / light.lifeMs;
        this.lighting.setLight(lightKey, 'voidFireChunk', light.x + light.vx * age / 1000,
          light.y + light.vy * age / 1000, {
            color: VOID_PALETTE.bright, radiusPx: intro ? 125 : 90,
            intensity: (intro ? 0.85 : 0.65) * (1 - t) * fade,
          });
      }
    }
  }

  private spawnSpark(source: SparkSource, now: number, intro: boolean, progress: number, afterSpawn: boolean): void {
    const random = () => nextRandom(source);
    const angle = random() * Math.PI * 2;
    const radius = intro && !afterSpawn
      ? (55 + random() * 140) * (1 - progress * 0.55)
      : source.size * (0.2 + random() * 0.3);
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const spark = this.spark;
    spark.lifeMs = 480 + random() * 550;
    spark.x = source.x + dx * radius; spark.y = source.y + dy * radius;
    const speed = intro && !afterSpawn ? -radius / (spark.lifeMs / 1000) : 25 + random() * (intro ? 240 : 80);
    const swirl = intro && !afterSpawn ? 25 + progress * 35 : 12;
    spark.vx = dx * speed - dy * swirl; spark.vy = dy * speed + dx * swirl;
    spark.rotation = Math.atan2(spark.vy, spark.vx);
    spark.scaleStart = (2.5 + random() * 3) / getGpuVfxFrame(spark.frame).width;
    spark.scaleEnd = spark.scaleStart * 0.12;
    spark.stretchStart = 1.8 + random() * 2.5; spark.stretchEnd = 0.5;
    spark.alphaStart = 0.95; spark.alphaEnd = 0;
    spark.tint = random() < 0.22 ? VOID_PALETTE.core : random() < 0.5 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
    if (!this.gpu.spawn(spark, source.source, now)) return;

    // Only six accepted spark trajectories own lights, irrespective of particle density.
    const light = source.lights.find(candidate => now - candidate.bornAt >= candidate.lifeMs);
    if (light) Object.assign(light, {
      x: spark.x, y: spark.y, vx: spark.vx, vy: spark.vy, bornAt: now, lifeMs: spark.lifeMs,
    });
    if (random() < 0.24) {
      const glow = this.glow;
      glow.x = spark.x; glow.y = spark.y; glow.vx = spark.vx; glow.vy = spark.vy;
      glow.lifeMs = spark.lifeMs;
      glow.scaleStart = (12 + random() * 12) / getGpuVfxFrame(glow.frame).width;
      glow.scaleEnd = 0;
      glow.alphaStart = 0.25; glow.alphaEnd = 0;
      glow.tint = VOID_PALETTE.primary;
      this.gpu.spawn(glow, source.source, now);
    }
  }
}

function nextRandom(source: SparkSource): number {
  let seed = source.randomState;
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  source.randomState = seed >>> 0;
  return source.randomState / 4294967296;
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return hash >>> 0;
}
