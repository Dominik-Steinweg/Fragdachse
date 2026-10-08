import type * as Phaser from 'phaser';
import { VOID_PALETTE } from '../config';
import { VOID_SPARKS_INTRO, type BossIntroState } from '../config/bossIntros';
import { createVisibleWorldView, getVisibleWorldView } from '../graphics/CameraWorldView';
import type { BossPresenceSource } from './BossPresenceRenderer';
import type { LightingSystem } from './LightingSystem';
import { getGpuVfxFrame, GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

/**
 * GPU-Funken des Void-Hunters: der Sog in den Dimensionsriss während des Intros und die
 * Void-Korona am lebenden Boss (Kometen auf Umlaufbahnen, Glut, Void-Blitze).
 *
 * Reine Präsentation replizierter Zustände; die Riss-Geometrie, Kamera und Verzerrung
 * besitzt {@link VoidRiftIntroRenderer}. Beide lesen dieselbe Zeitachse aus `VOID_SPARKS_INTRO`.
 */

const EFFECT = GpuVfxEffectId.VoidHunterSpark;
const INTRO_KEY = 'intro';
const LIGHT_COUNT = 6;
const TAU = Math.PI * 2;
const I = VOID_SPARKS_INTRO;

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
  /** Letzte gesehene Intro-Zeit; Einmal-Effekte zünden nur beim live erlebten Überschreiten. */
  lastIntroElapsed: number | null;
  randomState: number;
  readonly flow: ParticleFlowScheduler;
  readonly lights: SparkLight[];
  /** Präsentationszeit der Korona (Kometenwinkel) und nächster Void-Blitz. */
  orbitTime: number;
  nextArcAt: number;
}

/** Zwei geneigte Umlaufbahnen; `squash` ist die perspektivische Neigung der Ellipse. */
const ORBITS = [
  { radius: 0.62, squash: 0.48, tilt: 0.45, speed: 2.3 },
  { radius: 0.82, squash: 0.36, tilt: -0.85, speed: -1.7 },
] as const;

export class VoidHunterSparksRenderer {
  private readonly sources = new Map<string, SparkSource>();
  private readonly view = createVisibleWorldView();
  private readonly spark: GpuVfxSpawnSpec;
  private readonly glow: GpuVfxSpawnSpec;
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
    return elapsed >= 0 && elapsed <= I.durationMs + 4_000;
  }

  syncIntro(state: BossIntroState | null, now: number): void {
    if (this.destroyed) return;
    const elapsed = state ? now - state.startedAtMs : -1;
    if (state?.preset !== 'void-sparks' || elapsed < 0 || elapsed > I.durationMs) {
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
    source.size = 78;
    source.introElapsed = elapsed;
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
    this.introIdentity = null;
    this.removeSource(INTRO_KEY);
  }

  private createSource(key: string, seed: number): SparkSource {
    const source: SparkSource = {
      source: -1, x: 0, y: 0, size: 0, phase: 1, introElapsed: null, lastIntroElapsed: null,
      randomState: seed || 1, flow: new ParticleFlowScheduler(0),
      lights: Array.from({ length: LIGHT_COUNT }, () => ({ x: 0, y: 0, vx: 0, vy: 0, bornAt: 0, lifeMs: 0 })),
      orbitTime: 0, nextArcAt: 0,
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

  // ── Emission ──────────────────────────────────────────────────────────────

  private emit(delta: number, now: number): void {
    if (this.generation !== this.gpu.emissionGeneration) {
      for (const [key, source] of this.sources) this.releaseVisuals(key, source);
      this.generation = this.gpu.emissionGeneration;
    }
    const view = getVisibleWorldView(this.scene.cameras.main, this.view);
    const dt = Math.max(0, Math.min(100, delta));
    for (const [key, source] of this.sources) {
      const intro = source.introElapsed !== null;
      const rate = intro ? this.introRate(source.introElapsed!) : source.phase >= 2 ? 720 : 480;
      const frequency = this.gpu.quality.scaleFrequency(1000 / Math.max(1, rate), EFFECT);
      const margin = intro ? I.shockwaveRadiusPx : 240;
      const inView = source.x + margin >= view.x && source.x - margin <= view.right
        && source.y + margin >= view.y && source.y - margin <= view.bottom;
      if (this.gpu.isSuppressed() || frequency <= 0 || !inView) {
        this.releaseVisuals(key, source);
        continue;
      }
      if (source.source < 0) source.source = this.gpu.createSource(EFFECT);
      if (source.source < 0) continue;
      source.flow.setFrequency(frequency);
      const count = Math.min(260, source.flow.tick(dt));
      if (intro) this.emitIntro(source, now, count);
      else this.emitCorona(source, now, count, dt);
      this.syncLights(key, source, now, intro);
    }
  }

  /** Funken pro Sekunde entlang der Intro-Zeitachse. */
  private introRate(elapsed: number): number {
    if (elapsed < I.riftOpenStartMs) return 70 + 90 * (elapsed / I.riftOpenStartMs);
    if (elapsed < I.collapseStartMs) {
      const t = (elapsed - I.riftOpenStartMs) / (I.collapseStartMs - I.riftOpenStartMs);
      return 260 + t * t * 760;
    }
    if (elapsed < I.collapseEndMs) return 1_200;
    // Stille vor dem Erscheinen: nur noch vereinzelte Funken.
    if (elapsed < I.emergeAtMs) return 25;
    const after = (elapsed - I.emergeAtMs) / (I.durationMs - I.emergeAtMs);
    return Math.max(0, 160 * (1 - after));
  }

  private emitIntro(source: SparkSource, now: number, count: number): void {
    const elapsed = source.introElapsed!;
    const last = source.lastIntroElapsed ?? elapsed;
    source.lastIntroElapsed = elapsed;
    const random = () => nextRandom(source);

    // Einmal-Effekt: Explosion beim Erscheinen (nur live erlebt, nicht für Late-Joiner).
    if (last < I.emergeAtMs && elapsed >= I.emergeAtMs && elapsed - I.emergeAtMs < 400) {
      for (let i = 0; i < 320; i++) this.spawnBurst(source, now, random);
    }

    for (let i = 0; i < count; i++) {
      if (elapsed < I.riftOpenStartMs) this.spawnAnomalyMote(source, now, elapsed, random);
      else if (elapsed < I.collapseStartMs) this.spawnSuctionStream(source, now, elapsed, random);
      else if (elapsed < I.emergeAtMs) this.spawnCollapse(source, now, random);
      else this.spawnEmber(source, now, random, 40 + random() * 160, 1.6);
    }
    // Void-Blitze schlagen vom Riss in den Boden.
    if (elapsed >= I.arcs.startMs && elapsed < I.arcs.endMs && now >= source.nextArcAt) {
      const angle = random() * TAU;
      const reach = I.arcs.reachPx * (0.45 + random() * 0.55);
      const from = (random() - 0.5) * I.riftLengthPx * 0.8;
      this.spawnArc(source, now, source.x + from, source.y,
        source.x + Math.cos(angle) * reach, source.y + Math.sin(angle) * reach, random, 1.25);
      source.nextArcAt = now + I.arcs.minIntervalMs + random() * (I.arcs.maxIntervalMs - I.arcs.minIntervalMs);
    }
  }

  /** Anomalie: einzelne Funken sickern langsam aus großer Entfernung auf den Punkt zu. */
  private spawnAnomalyMote(source: SparkSource, now: number, elapsed: number, random: () => number): void {
    const angle = random() * TAU;
    const radius = 160 + random() * 170;
    const spark = this.spark;
    spark.lifeMs = 900 + random() * 700;
    spark.x = source.x + Math.cos(angle) * radius;
    spark.y = source.y + Math.sin(angle) * radius;
    const speed = -radius * (0.35 + 0.25 * elapsed / I.riftOpenStartMs) / (spark.lifeMs / 1000);
    spark.vx = Math.cos(angle) * speed; spark.vy = Math.sin(angle) * speed;
    spark.positionEase = GpuVfxEase.Linear;
    this.streak(spark, 1.4 + random() * 0.9, 3 + random() * 2.5, 0.8, random() < 0.5 ? VOID_PALETTE.primary : VOID_PALETTE.bright);
    this.commit(source, now, random, 0.12);
  }

  /**
   * Sog: Funken laufen auf vier rotierenden Spiralarmen in den Riss. Der Drall nimmt zu,
   * je weiter sich der Riss öffnet.
   */
  private spawnSuctionStream(source: SparkSource, now: number, elapsed: number, random: () => number): void {
    const open = smooth((elapsed - I.riftOpenStartMs) / (I.riftOpenEndMs - I.riftOpenStartMs));
    const arm = Math.floor(random() * 4);
    const radius = 70 + random() * 230;
    const angle = arm * TAU / 4 + elapsed * 0.0011 + radius * 0.012 + (random() - 0.5) * 0.35;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const spark = this.spark;
    spark.lifeMs = 380 + random() * 360;
    spark.x = source.x + dx * radius;
    spark.y = source.y + dy * radius * 0.86;
    const inward = -radius * (0.85 + random() * 0.3) / (spark.lifeMs / 1000);
    const swirl = (120 + open * 260) * (0.7 + random() * 0.6);
    spark.vx = dx * inward - dy * swirl;
    spark.vy = dy * inward + dx * swirl;
    spark.positionEase = GpuVfxEase.QuadOut;
    const tint = random() < 0.38 ? VOID_PALETTE.core : random() < 0.72 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
    this.streak(spark, 1.6 + random() * 1.1, 5 + random() * 4, 1, tint);
    this.commit(source, now, random, 0.2);
  }

  /** Kollaps: alles schießt in einem engen Wirbel ins Zentrum. */
  private spawnCollapse(source: SparkSource, now: number, random: () => number): void {
    const angle = random() * TAU;
    const radius = 50 + random() * 170;
    const spark = this.spark;
    spark.lifeMs = 170 + random() * 150;
    spark.x = source.x + Math.cos(angle) * radius;
    spark.y = source.y + Math.sin(angle) * radius;
    const speed = -radius / (spark.lifeMs / 1000);
    spark.vx = Math.cos(angle) * speed - Math.sin(angle) * 140;
    spark.vy = Math.sin(angle) * speed + Math.cos(angle) * 140;
    spark.positionEase = GpuVfxEase.Linear;
    this.streak(spark, 1.8 + random() * 1.2, 7 + random() * 4, 1, random() < 0.55 ? VOID_PALETTE.core : VOID_PALETTE.bright);
    this.commit(source, now, random, 0.1);
  }

  /** Erscheinen: radiale Explosion aus dem Zentrum. */
  private spawnBurst(source: SparkSource, now: number, random: () => number): void {
    const angle = random() * TAU;
    const speed = 260 + random() * 640;
    const spark = this.spark;
    spark.lifeMs = 450 + random() * 700;
    spark.x = source.x + Math.cos(angle) * 12;
    spark.y = source.y + Math.sin(angle) * 12;
    spark.vx = Math.cos(angle) * speed; spark.vy = Math.sin(angle) * speed;
    spark.positionEase = GpuVfxEase.QuadOut;
    const tint = random() < 0.4 ? VOID_PALETTE.core : random() < 0.72 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
    this.streak(spark, 2 + random() * 1.4, 6 + random() * 5, 1, tint);
    this.commit(source, now, random, 0.35);
  }

  /** Glut: langsam nach außen treibende, wachsende Glimmteilchen (Aufsteigen in der Draufsicht). */
  private spawnEmber(source: SparkSource, now: number, random: () => number, radius: number, growth: number): void {
    const angle = random() * TAU;
    const spark = this.spark;
    spark.lifeMs = 800 + random() * 700;
    spark.x = source.x + Math.cos(angle) * radius;
    spark.y = source.y + Math.sin(angle) * radius;
    const speed = 12 + random() * 30;
    spark.vx = Math.cos(angle) * speed; spark.vy = Math.sin(angle) * speed - 8;
    spark.positionEase = GpuVfxEase.QuadOut;
    this.streak(spark, 2 + random() * 2.5, 1, 0.85, random() < 0.5 ? VOID_PALETTE.primary : VOID_PALETTE.deep);
    spark.scaleEnd = spark.scaleStart * growth;
    this.commit(source, now, random, 0.18);
  }

  /**
   * Void-Korona am Boss: Kometen auf zwei geneigten Umlaufbahnen ziehen leuchtende Schweife,
   * dazu Glut vom Körper und gelegentliche Void-Blitze über den Körper.
   */
  private emitCorona(source: SparkSource, now: number, count: number, deltaMs: number): void {
    const random = () => nextRandom(source);
    const phaseTwo = source.phase >= 2;
    const spin = phaseTwo ? 1.55 : 1;
    const previousTime = source.orbitTime;
    source.orbitTime += (deltaMs / 1000) * spin;
    const heads = phaseTwo ? 3 : 2;
    for (let i = 0; i < count; i++) {
      // Glut und Kometen teilen sich den Strom; Kometen sind die Mehrheit.
      if (random() < 0.22) {
        this.spawnEmber(source, now, random, source.size * (0.25 + random() * 0.22), phaseTwo ? 2 : 1.6);
        continue;
      }
      const orbit = ORBITS[i % ORBITS.length];
      const head = Math.floor(random() * heads);
      // Zeitlich über den Frame verteilt, damit die Schweife lückenlos sind.
      const time = previousTime + (source.orbitTime - previousTime) * (i / Math.max(1, count));
      const theta = time * orbit.speed + head * TAU / heads;
      const r = source.size * orbit.radius;
      const lx = Math.cos(theta) * r, ly = Math.sin(theta) * r * orbit.squash;
      const cos = Math.cos(orbit.tilt), sin = Math.sin(orbit.tilt);
      const spark = this.spark;
      spark.lifeMs = 420 + random() * 320;
      spark.x = source.x + lx * cos - ly * sin + (random() - 0.5) * 3;
      spark.y = source.y + lx * sin + ly * cos + (random() - 0.5) * 3;
      // Tangente der Bahn; der Kometenkopf ist der jüngste Funke, der Schweif verglimmt hinter ihm.
      const tx = -Math.sin(theta) * r * orbit.speed, ty = Math.cos(theta) * r * orbit.squash * orbit.speed;
      spark.vx = (tx * cos - ty * sin) * 0.08;
      spark.vy = (tx * sin + ty * cos) * 0.08;
      spark.positionEase = GpuVfxEase.Linear;
      const tint = random() < 0.35 ? VOID_PALETTE.core : random() < 0.75 ? VOID_PALETTE.bright : VOID_PALETTE.primary;
      this.streak(spark, 2.4 + random() * 1.6, 2.2 + random() * 1.4, 1, tint);
      spark.rotation = Math.atan2(tx * sin + ty * cos, tx * cos - ty * sin);
      this.commit(source, now, random, 0.08);
    }
    this.spawnCometHeads(source, now, heads, random);
    if (now >= source.nextArcAt) {
      const a = random() * TAU, b = a + Math.PI * (0.5 + random() * 0.9);
      const r1 = source.size * (0.35 + random() * 0.4), r2 = source.size * (0.35 + random() * 0.45);
      this.spawnArc(source, now, source.x + Math.cos(a) * r1, source.y + Math.sin(a) * r1,
        source.x + Math.cos(b) * r2, source.y + Math.sin(b) * r2, random, 0.8);
      source.nextArcAt = now + (phaseTwo ? 260 + random() * 420 : 650 + random() * 900);
    }
  }

  /** Weißglühende Kometenköpfe mit violettem Glimmen an der aktuellen Bahnposition. */
  private spawnCometHeads(source: SparkSource, now: number, heads: number, random: () => number): void {
    for (const orbit of ORBITS) {
      const r = source.size * orbit.radius;
      const cos = Math.cos(orbit.tilt), sin = Math.sin(orbit.tilt);
      for (let head = 0; head < heads; head++) {
        const theta = source.orbitTime * orbit.speed + head * TAU / heads;
        const lx = Math.cos(theta) * r, ly = Math.sin(theta) * r * orbit.squash;
        const x = source.x + lx * cos - ly * sin, y = source.y + lx * sin + ly * cos;
        const glow = this.glow;
        glow.x = x; glow.y = y; glow.vx = 0; glow.vy = 0;
        glow.positionEase = GpuVfxEase.Linear;
        glow.lifeMs = 90;
        glow.scaleStart = (10 + random() * 4) / getGpuVfxFrame(glow.frame).width;
        glow.scaleEnd = glow.scaleStart * 0.6;
        glow.alphaStart = 0.45; glow.alphaEnd = 0;
        glow.tint = VOID_PALETTE.bright;
        this.gpu.spawn(glow, source.source, now);
        const spark = this.spark;
        spark.x = x; spark.y = y; spark.vx = 0; spark.vy = 0;
        spark.lifeMs = 90;
        spark.positionEase = GpuVfxEase.Linear;
        this.streak(spark, 3.4, 1, 1, VOID_PALETTE.core);
        this.gpu.spawn(spark, source.source, now);
      }
    }
  }

  /**
   * Void-Blitz aus einer Kette sehr kurzlebiger, gestreckter Funken entlang einer gezackten Linie,
   * mit weichem Glühen am Einschlag.
   */
  private spawnArc(
    source: SparkSource, now: number, x1: number, y1: number, x2: number, y2: number,
    random: () => number, intensity: number,
  ): void {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const segments = Math.max(4, Math.min(14, Math.round(length / 16)));
    const nx = -(y2 - y1) / Math.max(1, length), ny = (x2 - x1) / Math.max(1, length);
    let px = x1, py = y1;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const jitter = s === segments ? 0 : (random() - 0.5) * length * 0.18 * Math.sin(t * Math.PI);
      const qx = x1 + (x2 - x1) * t + nx * jitter, qy = y1 + (y2 - y1) * t + ny * jitter;
      const segLength = Math.hypot(qx - px, qy - py);
      const spark = this.spark;
      spark.lifeMs = 110 + random() * 80;
      spark.x = (px + qx) / 2; spark.y = (py + qy) / 2;
      spark.vx = 0; spark.vy = 0;
      spark.positionEase = GpuVfxEase.Linear;
      const width = 2.2 * intensity;
      this.streak(spark, width, Math.max(1, segLength / width), 1, s % 3 === 0 ? VOID_PALETTE.bright : VOID_PALETTE.core);
      spark.scaleEnd = spark.scaleStart;
      spark.stretchEnd = spark.stretchStart;
      spark.rotation = Math.atan2(qy - py, qx - px);
      this.gpu.spawn(spark, source.source, now);
      px = qx; py = qy;
    }
    const glow = this.glow;
    glow.x = x2; glow.y = y2; glow.vx = 0; glow.vy = 0;
    glow.lifeMs = 260;
    glow.scaleStart = (26 * intensity) / getGpuVfxFrame(glow.frame).width;
    glow.scaleEnd = glow.scaleStart * 1.4;
    glow.alphaStart = 0.55; glow.alphaEnd = 0;
    glow.tint = VOID_PALETTE.bright;
    this.gpu.spawn(glow, source.source, now);
  }

  /** Setzt Größe, Streckung, Deckkraft und Farbe eines Funkens; Rotation folgt der Geschwindigkeit. */
  private streak(spark: GpuVfxSpawnSpec, sizePx: number, stretch: number, alpha: number, tint: number): void {
    spark.rotation = Math.atan2(spark.vy, spark.vx);
    spark.scaleStart = sizePx / getGpuVfxFrame(spark.frame).width;
    spark.scaleEnd = spark.scaleStart * 0.15;
    spark.stretchStart = stretch; spark.stretchEnd = Math.max(0.5, stretch * 0.4);
    spark.alphaStart = alpha; spark.alphaEnd = 0;
    spark.tint = tint;
  }

  /** Spawnt den vorbereiteten Funken; ein Teil bekommt ein weiches Glühen, sechs Bahnen tragen Licht. */
  private commit(source: SparkSource, now: number, random: () => number, glowChance: number): void {
    const spark = this.spark;
    if (!this.gpu.spawn(spark, source.source, now)) return;
    const light = source.lights.find(candidate => now - candidate.bornAt >= candidate.lifeMs);
    if (light) Object.assign(light, {
      x: spark.x, y: spark.y, vx: spark.vx, vy: spark.vy, bornAt: now, lifeMs: spark.lifeMs,
    });
    if (random() >= glowChance) return;
    const glow = this.glow;
    glow.x = spark.x; glow.y = spark.y; glow.vx = spark.vx; glow.vy = spark.vy;
    glow.positionEase = spark.positionEase;
    glow.lifeMs = spark.lifeMs;
    glow.scaleStart = (14 + random() * 14) / getGpuVfxFrame(glow.frame).width;
    glow.scaleEnd = 0;
    glow.alphaStart = 0.28; glow.alphaEnd = 0;
    glow.tint = VOID_PALETTE.primary;
    this.gpu.spawn(glow, source.source, now);
  }

  private syncLights(key: string, source: SparkSource, now: number, intro: boolean): void {
    const fade = intro ? Math.min(1, (I.durationMs - source.introElapsed!) / 800) : 1;
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
          color: VOID_PALETTE.bright, radiusPx: intro ? 125 : 95,
          intensity: (intro ? 0.85 : 0.7) * (1 - t) * fade,
        });
    }
  }
}

function smooth(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
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
