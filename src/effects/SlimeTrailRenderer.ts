import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SlimeBloomTarget, SyncedSlimeTrailCell, SyncedSlimeTrailSnapshot, SyncedSlimedEnemy } from '../types';
import { configureAdditiveImage, createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';
import { MAX_SLIME_LIGHTS, SLIME_LIGHT_BUCKET_SIZE } from './LightingConfig';
import type { LightingSystem } from './LightingSystem';

const TEX_SLIME_BUBBLE = '__slime_trail_bubble';
const TEX_SLIME_GLOW = '__slime_trail_glow';
const TEX_SLIME_RIPPLE = '__slime_trail_ripple';
const TEX_SLIME_GLINT = '__slime_trail_glint';
const TEX_SLIME_PUDDLE = '__slime_trail_puddle';
const TEX_SLIME_CHUNK = '__slime_bloom_chunk';
const SLIME_GROUND_DEPTH = DEPTH.ROCKS - 0.35;
const TRAIL_BUBBLE_INTERVAL_MS = 105;
const TRAIL_GLINT_INTERVAL_MS = 260;
const TRAIL_RIPPLE_INTERVAL_MS = 390;
const ENEMY_BUBBLE_INTERVAL_MS = 125;
const SMOOTH_TIME_MS = 55;
const PUDDLE_ALPHA_MULTIPLIER = 0.62;
const PUDDLE_TINT_PALETTE = [0x3f7d45, 0x36743d, 0x47733a, 0x2e693e] as const;

interface SlimePuddleVisual {
  image: Phaser.GameObjects.Image;
  baseScaleX: number;
  baseScaleY: number;
  baseRotation: number;
  phase: number;
  alpha: number;
}

interface SlimedEnemyVisual {
  halo: Phaser.GameObjects.Image;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  alpha: number;
}

/** Organische, animierte Schleimflaeche mit gemeinsam gepoolten Phaser-Partikelemittern. */
export class SlimeTrailRenderer {
  private readonly trailBubbles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly trailGlints: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly trailRipples: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly enemyBubbles: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly puddleVisuals = new Map<number, SlimePuddleVisual>();
  private readonly puddleImagePool: Phaser.GameObjects.Image[] = [];
  private readonly affectedVisuals = new Map<string, SlimedEnemyVisual>();
  private readonly activeBloomChunks = new Set<Phaser.GameObjects.Image>();
  private readonly activeBloomTweens = new Set<Phaser.Tweens.Tween>();
  private cells: readonly SyncedSlimeTrailCell[] = [];
  private trailBubbleAccumulator = 0;
  private trailGlintAccumulator = 0;
  private trailRippleAccumulator = 0;
  private enemyBubbleAccumulator = 0;
  private trailCursor = 0;
  private glintCursor = 0;
  private rippleCursor = 0;
  private lighting: LightingSystem | null = null;
  private readonly lightBuckets = new Map<string, { x: number; y: number; weight: number }>();
  private readonly lightRanking: { key: string; x: number; y: number; weight: number }[] = [];
  private readonly activeLightKeys = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {
    this.generateTextures();
    this.trailBubbles = this.createBubbleEmitter(SLIME_GROUND_DEPTH + 0.05, 0.58);
    this.trailGlints = this.createGlintEmitter();
    this.trailRipples = this.createRippleEmitter();
    this.enemyBubbles = this.createBubbleEmitter(DEPTH.PROJECTILES + 0.42, 0.92);
  }

  syncVisuals(snapshot: SyncedSlimeTrailSnapshot): void {
    this.cells = snapshot.cells;
    this.syncPuddles(snapshot.cells);
    this.syncAffectedEnemies(snapshot.affectedEnemies);
  }

  /** Laesst die replizierten Schleimbrocken sichtbar vom besiegten Gegner zu ihren Zielzellen fliegen. */
  playBloomBurst(x: number, y: number, targets: readonly SlimeBloomTarget[]): void {
    this.enemyBubbles.emitParticleAt(x, y, 7);
    this.trailGlints.emitParticleAt(x, y, 5);

    targets.forEach((target, index) => {
      const chunk = this.scene.add.image(x, y, TEX_SLIME_CHUNK)
        .setDepth(DEPTH.PROJECTILES + 0.48)
        .setBlendMode(Phaser.BlendModes.NORMAL)
        .setTint([0xa4ff69, 0x73e85e, 0x4fc94f][index % 3])
        .setScale(0.48 + index * 0.06)
        .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2));
      this.activeBloomChunks.add(chunk);

      const dx = target.x - x;
      const dy = target.y - y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const side = index % 2 === 0 ? 1 : -1;
      const bend = Phaser.Math.FloatBetween(14, 25) * side;
      const controlX = (x + target.x) * 0.5 - dy / distance * bend;
      const controlY = (y + target.y) * 0.5 + dx / distance * bend - Phaser.Math.FloatBetween(18, 30);
      const flight = { progress: 0 };
      let particleStep = 0;
      let tween: Phaser.Tweens.Tween | null = null;
      tween = this.scene.tweens.add({
        targets: flight,
        progress: 1,
        duration: Phaser.Math.Between(260, 340),
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          const t = flight.progress;
          const inverse = 1 - t;
          chunk
            .setPosition(
              inverse * inverse * x + 2 * inverse * t * controlX + t * t * target.x,
              inverse * inverse * y + 2 * inverse * t * controlY + t * t * target.y,
            )
            .setRotation(chunk.rotation + 0.13)
            .setScale((0.48 + index * 0.06) * (1 + Math.sin(Math.PI * t) * 0.34));
          particleStep += 1;
          if (particleStep % 3 === 0) this.enemyBubbles.emitParticleAt(chunk.x, chunk.y, 1);
        },
        onComplete: () => {
          this.trailRipples.emitParticleAt(target.x, target.y, 2);
          this.trailBubbles.emitParticleAt(target.x, target.y, 5);
          this.trailGlints.emitParticleAt(target.x, target.y, 4);
          this.activeBloomChunks.delete(chunk);
          chunk.destroy();
          if (tween) this.activeBloomTweens.delete(tween);
        },
      });
      this.activeBloomTweens.add(tween);
    });
  }

  update(delta: number): void {
    const safeDelta = Math.max(0, Math.min(delta, 100));
    this.emitTrailParticles(safeDelta);
    this.emitAffectedEnemyBubbles(safeDelta);

    const lerp = 1 - Math.exp(-safeDelta / SMOOTH_TIME_MS);
    const now = this.scene.time.now;
    for (const visual of this.puddleVisuals.values()) {
      const breathe = 1 + Math.sin(now * 0.00048 + visual.phase) * 0.018;
      const shear = 1 + Math.cos(now * 0.00037 + visual.phase * 1.31) * 0.012;
      visual.image
        .setScale(visual.baseScaleX * breathe, visual.baseScaleY * shear)
        .setRotation(visual.baseRotation + Math.sin(now * 0.00022 + visual.phase) * 0.018)
        .setAlpha(visual.alpha * PUDDLE_ALPHA_MULTIPLIER);
    }
    let index = 0;
    for (const visual of this.affectedVisuals.values()) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);
      const pulse = 0.84 + Math.sin(now * 0.0035 + index * 1.9) * 0.065;
      visual.halo
        .setPosition(visual.currentX, visual.currentY)
        .setScale(pulse)
        .setAlpha(0.48 * visual.alpha);
      index += 1;
    }

    this.syncPuddleLights();
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  /**
   * Schimmer der Schleimfläche, geclustert wie der brennende Boden.
   *
   * Eine Spur besteht aus vielen kleinen Pfützen. Ein Licht pro Pfütze wäre weder
   * bezahlbar noch richtig – optisch ist die Spur eine zusammenhängende Fläche. Die
   * Zellen werden deshalb in ein grobes Raster einsortiert, pro Rasterfeld entsteht ein
   * Licht, und nur die hellsten Felder bekommen eines.
   */
  private syncPuddleLights(): void {
    const lighting = this.lighting;
    if (!lighting) return;

    const buckets = this.lightBuckets;
    buckets.clear();

    for (const visual of this.puddleVisuals.values()) {
      if (visual.alpha <= 0.02) continue;
      const bucketX = Math.floor(visual.image.x / SLIME_LIGHT_BUCKET_SIZE);
      const bucketY = Math.floor(visual.image.y / SLIME_LIGHT_BUCKET_SIZE);
      const key = `${bucketX}:${bucketY}`;

      const existing = buckets.get(key);
      if (existing) {
        existing.weight += visual.alpha;
      } else {
        buckets.set(key, {
          x: (bucketX + 0.5) * SLIME_LIGHT_BUCKET_SIZE,
          y: (bucketY + 0.5) * SLIME_LIGHT_BUCKET_SIZE,
          weight: visual.alpha,
        });
      }
    }

    this.lightRanking.length = 0;
    for (const [key, bucket] of buckets) {
      this.lightRanking.push({ key, x: bucket.x, y: bucket.y, weight: bucket.weight });
    }
    this.lightRanking.sort((left, right) => right.weight - left.weight);
    if (this.lightRanking.length > MAX_SLIME_LIGHTS) {
      this.lightRanking.length = MAX_SLIME_LIGHTS;
    }

    const stale = this.activeLightKeys;
    for (const entry of this.lightRanking) {
      lighting.setLight(`slime:${entry.key}`, 'slimeGlow', entry.x, entry.y, {
        intensity: Phaser.Math.Clamp(0.16 + entry.weight * 0.08, 0, 0.34),
      });
      stale.delete(entry.key);
    }
    for (const staleKey of stale) lighting.releaseLight(`slime:${staleKey}`);

    stale.clear();
    for (const entry of this.lightRanking) stale.add(entry.key);
  }

  clear(): void {
    this.cells = [];
    for (const key of this.activeLightKeys) this.lighting?.releaseLight(`slime:${key}`);
    this.activeLightKeys.clear();
    for (const [id, visual] of this.puddleVisuals) {
      this.releasePuddleVisual(id, visual);
    }
    this.trailBubbleAccumulator = 0;
    this.trailGlintAccumulator = 0;
    this.trailRippleAccumulator = 0;
    this.enemyBubbleAccumulator = 0;
    this.trailCursor = 0;
    this.glintCursor = 0;
    this.rippleCursor = 0;
    this.trailBubbles.killAll();
    this.trailGlints.killAll();
    this.trailRipples.killAll();
    this.enemyBubbles.killAll();
    for (const tween of this.activeBloomTweens) tween.stop();
    this.activeBloomTweens.clear();
    for (const chunk of this.activeBloomChunks) chunk.destroy();
    this.activeBloomChunks.clear();
    for (const visual of this.affectedVisuals.values()) visual.halo.destroy();
    this.affectedVisuals.clear();
  }

  destroyAll(): void {
    this.clear();
    for (const image of this.puddleImagePool) image.destroy();
    this.puddleImagePool.length = 0;
    destroyEmitter(this.trailBubbles);
    destroyEmitter(this.trailGlints);
    destroyEmitter(this.trailRipples);
    destroyEmitter(this.enemyBubbles);
  }

  private generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_SLIME_BUBBLE, 18, [
      [0, 'rgba(240,255,198,1)'],
      [0.3, 'rgba(140,255,82,0.96)'],
      [0.68, 'rgba(36,205,55,0.72)'],
      [1, 'rgba(4,92,25,0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_SLIME_GLOW, 64, [
      [0, 'rgba(196,255,105,0.8)'],
      [0.28, 'rgba(75,240,70,0.48)'],
      [0.7, 'rgba(16,150,44,0.16)'],
      [1, 'rgba(4,62,24,0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_SLIME_GLINT, 12, [
      [0, 'rgba(255,255,220,1)'],
      [0.22, 'rgba(196,255,112,0.95)'],
      [0.58, 'rgba(77,236,72,0.42)'],
      [1, 'rgba(20,130,42,0)'],
    ]);
    ensureCanvasTexture(this.scene.textures, TEX_SLIME_RIPPLE, 48, 48, (ctx) => {
      const size = 48;
      const center = size / 2;
      const pixels = ctx.createImageData(size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = (x + 0.5 - center) / center;
          const ny = (y + 0.5 - center) / center;
          const radius = Math.hypot(nx, ny);
          const angle = Math.atan2(ny, nx);
          const irregularRing = 0.61
            + Math.sin(angle * 3 + 0.4) * 0.075
            + Math.sin(angle * 7 - 1.2) * 0.035;
          const band = Phaser.Math.Clamp(1 - Math.abs(radius - irregularRing) / 0.3, 0, 1);
          const outerFade = Phaser.Math.Clamp((1 - radius) / 0.22, 0, 1);
          const alpha = Math.pow(band, 1.7) * outerFade * 0.18;
          if (alpha <= 0.002) continue;
          const offset = (y * size + x) * 4;
          pixels.data[offset] = 118;
          pixels.data[offset + 1] = 238;
          pixels.data[offset + 2] = 91;
          pixels.data[offset + 3] = Math.round(alpha * 255);
        }
      }
      ctx.putImageData(pixels, 0, 0);
    });
    ensureCanvasTexture(this.scene.textures, TEX_SLIME_PUDDLE, 128, 128, (ctx) => {
      const size = 128;
      const center = size / 2;
      const pixels = ctx.createImageData(size, size);
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const nx = (x + 0.5 - center) / center;
          const ny = (y + 0.5 - center) / center;
          const radius = Math.hypot(nx, ny);
          const angle = Math.atan2(ny, nx);
          const contour = 0.72
            + Math.sin(angle * 3 + 0.8) * 0.075
            + Math.sin(angle * 5 - 1.4) * 0.052
            + Math.sin(angle * 9 + 2.1) * 0.026;
          const feather = 0.46;
          const edge = Phaser.Math.Clamp((contour - radius) / feather, 0, 1);
          const broadNoise = 0.78
            + Math.sin(nx * 8.3 + ny * 5.1) * 0.08
            + Math.sin(nx * 15.7 - ny * 11.9) * 0.045;
          const washedAlpha = Math.pow(edge, 1.18) * broadNoise;
          if (washedAlpha <= 0.002) continue;

          const offset = (y * size + x) * 4;
          const colorNoise = Math.sin(nx * 6.7 - ny * 9.2) * 5;
          pixels.data[offset] = Phaser.Math.Clamp(17 + colorNoise, 0, 255);
          pixels.data[offset + 1] = Phaser.Math.Clamp(91 + colorNoise * 1.8, 0, 255);
          pixels.data[offset + 2] = Phaser.Math.Clamp(43 + colorNoise, 0, 255);
          pixels.data[offset + 3] = Math.round(Phaser.Math.Clamp(washedAlpha * 118, 0, 118));
        }
      }
      ctx.putImageData(pixels, 0, 0);
    });
    ensureCanvasTexture(this.scene.textures, TEX_SLIME_CHUNK, 40, 40, (ctx) => {
      const size = 40;
      const center = size / 2;
      const pixels = ctx.createImageData(size, size);
      for (let py = 0; py < size; py += 1) {
        for (let px = 0; px < size; px += 1) {
          const nx = (px + 0.5 - center) / center;
          const ny = (py + 0.5 - center) / center;
          const radius = Math.hypot(nx, ny);
          const angle = Math.atan2(ny, nx);
          const contour = 0.7
            + Math.sin(angle * 3 + 0.6) * 0.13
            + Math.sin(angle * 5 - 1.3) * 0.07;
          const edge = Phaser.Math.Clamp((contour - radius) / 0.2, 0, 1);
          if (edge <= 0.002) continue;
          const highlight = Phaser.Math.Clamp(1 - Math.hypot(nx + 0.25, ny + 0.3) / 0.75, 0, 1);
          const offset = (py * size + px) * 4;
          pixels.data[offset] = Math.round(55 + highlight * 75);
          pixels.data[offset + 1] = Math.round(168 + highlight * 75);
          pixels.data[offset + 2] = Math.round(55 + highlight * 35);
          pixels.data[offset + 3] = Math.round(edge * 245);
        }
      }
      ctx.putImageData(pixels, 0, 0);
    });
  }

  private createBubbleEmitter(depth: number, scale: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_SLIME_BUBBLE, {
      lifespan: { min: 1250, max: 2300 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -3, max: 3 },
      speedY: { min: -9, max: -2 },
      gravityY: -1,
      scale: { start: scale * 0.24, end: scale, ease: 'Sine.easeOut' },
      alpha: { start: 0.54, end: 0, ease: 'Sine.easeIn' },
      tint: [0xeaffaa, 0x8dff55, 0x35d94d, 0x0c7b31],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: depth > DEPTH.PROJECTILES ? 320 : 520,
      reserve: depth > DEPTH.PROJECTILES ? 96 : 192,
      emitting: false,
    }, depth);
  }

  private createGlintEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_SLIME_GLINT, {
      lifespan: { min: 1100, max: 1900 },
      frequency: -1,
      quantity: 1,
      speedX: { min: -4, max: 4 },
      speedY: { min: -3, max: 2 },
      rotate: { min: 0, max: 360 },
      scale: { start: 0.34, end: 0.08 },
      alpha: { start: 0.34, end: 0 },
      tint: [0xf1ffc2, 0xb6ff75, 0x5eff61],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 420,
      reserve: 160,
      emitting: false,
    }, SLIME_GROUND_DEPTH + 0.06);
  }

  private createRippleEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_SLIME_RIPPLE, {
      lifespan: { min: 1250, max: 1900 },
      frequency: -1,
      quantity: 1,
      speed: 0,
      rotate: { min: 0, max: 360 },
      scale: { start: 0.12, end: 0.58, ease: 'Sine.easeOut' },
      alpha: { start: 0.3, end: 0, ease: 'Sine.easeIn' },
      tint: [0xc5ff85, 0x76f96d, 0x2ecf50],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: 180,
      reserve: 72,
      emitting: false,
    }, SLIME_GROUND_DEPTH + 0.04);
  }

  private syncPuddles(cells: readonly SyncedSlimeTrailCell[]): void {
    const activeIds = new Set(cells.map(cell => cell.id));
    for (const [id, visual] of this.puddleVisuals) {
      if (!activeIds.has(id)) this.releasePuddleVisual(id, visual);
    }

    for (const cell of cells) {
      let visual = this.puddleVisuals.get(cell.id);
      if (!visual) {
        const image = this.puddleImagePool.pop()
          ?? this.scene.add.image(cell.x, cell.y, TEX_SLIME_PUDDLE);
        const widthVariation = 3.65 + this.seededUnit(cell.id, 17) * 0.75;
        const aspectVariation = 0.82 + this.seededUnit(cell.id, 43) * 0.34;
        const baseScale = Math.max(8, cell.size) * widthVariation / 128;
        image
          .setTexture(TEX_SLIME_PUDDLE)
          .setPosition(
            cell.x + (this.seededUnit(cell.id, 59) - 0.5) * cell.size * 0.45,
            cell.y + (this.seededUnit(cell.id, 67) - 0.5) * cell.size * 0.4,
          )
          .setDepth(SLIME_GROUND_DEPTH)
          .setBlendMode(Phaser.BlendModes.NORMAL)
          .setTint(PUDDLE_TINT_PALETTE[cell.id % PUDDLE_TINT_PALETTE.length])
          .setVisible(true)
          .setActive(true);
        visual = {
          image,
          baseScaleX: baseScale,
          baseScaleY: baseScale * aspectVariation,
          baseRotation: this.seededUnit(cell.id, 79) * Math.PI * 2,
          phase: this.seededUnit(cell.id, 97) * Math.PI * 2,
          alpha: cell.alpha,
        };
        this.puddleVisuals.set(cell.id, visual);
      }
      visual.alpha = Phaser.Math.Clamp(cell.alpha, 0, 1);
    }
  }

  private releasePuddleVisual(id: number, visual: SlimePuddleVisual): void {
    this.puddleVisuals.delete(id);
    visual.image.setVisible(false).setActive(false).clearTint();
    this.puddleImagePool.push(visual.image);
  }

  private seededUnit(id: number, salt: number): number {
    const value = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  private syncAffectedEnemies(enemies: readonly SyncedSlimedEnemy[]): void {
    const activeIds = new Set(enemies.map(enemy => enemy.enemyId));
    for (const [enemyId, visual] of this.affectedVisuals) {
      if (activeIds.has(enemyId)) continue;
      visual.halo.destroy();
      this.affectedVisuals.delete(enemyId);
    }

    for (const enemy of enemies) {
      let visual = this.affectedVisuals.get(enemy.enemyId);
      if (!visual) {
        visual = {
          halo: configureAdditiveImage(
            this.scene.add.image(enemy.x, enemy.y, TEX_SLIME_GLOW),
            DEPTH.PROJECTILES + 0.38,
            0.48,
            0x75ff62,
          ),
          currentX: enemy.x,
          currentY: enemy.y,
          targetX: enemy.x,
          targetY: enemy.y,
          alpha: enemy.alpha,
        };
        this.affectedVisuals.set(enemy.enemyId, visual);
        this.enemyBubbles.emitParticleAt(enemy.x, enemy.y, 3);
      }
      visual.targetX = enemy.x;
      visual.targetY = enemy.y;
      visual.alpha = enemy.alpha;
    }
  }

  private emitTrailParticles(delta: number): void {
    if (this.cells.length === 0) {
      this.trailBubbleAccumulator = 0;
      this.trailGlintAccumulator = 0;
      this.trailRippleAccumulator = 0;
      return;
    }

    this.trailBubbleAccumulator += delta;
    let emitted = 0;
    while (this.trailBubbleAccumulator >= TRAIL_BUBBLE_INTERVAL_MS && emitted < 10) {
      this.trailBubbleAccumulator -= TRAIL_BUBBLE_INTERVAL_MS;
      const cell = this.cells[this.trailCursor % this.cells.length];
      this.trailCursor += 1;
      const jitter = cell.size * 0.58;
      this.trailBubbles.emitParticleAt(
        cell.x + Phaser.Math.FloatBetween(-jitter, jitter),
        cell.y + Phaser.Math.FloatBetween(-jitter, jitter),
        1,
      );
      emitted += 1;
    }

    this.trailGlintAccumulator += delta;
    emitted = 0;
    while (this.trailGlintAccumulator >= TRAIL_GLINT_INTERVAL_MS && emitted < 8) {
      this.trailGlintAccumulator -= TRAIL_GLINT_INTERVAL_MS;
      const cell = this.cells[this.glintCursor % this.cells.length];
      this.glintCursor += 3;
      const jitter = cell.size * 0.52;
      this.trailGlints.emitParticleAt(
        cell.x + Phaser.Math.FloatBetween(-jitter, jitter),
        cell.y + Phaser.Math.FloatBetween(-jitter, jitter),
        Phaser.Math.Between(1, 2),
      );
      emitted += 1;
    }

    this.trailRippleAccumulator += delta;
    emitted = 0;
    while (this.trailRippleAccumulator >= TRAIL_RIPPLE_INTERVAL_MS && emitted < 4) {
      this.trailRippleAccumulator -= TRAIL_RIPPLE_INTERVAL_MS;
      const cell = this.cells[this.rippleCursor % this.cells.length];
      this.rippleCursor += 5;
      this.trailRipples.emitParticleAt(
        cell.x + Phaser.Math.FloatBetween(-cell.size * 0.18, cell.size * 0.18),
        cell.y + Phaser.Math.FloatBetween(-cell.size * 0.18, cell.size * 0.18),
        1,
      );
      emitted += 1;
    }
  }

  private emitAffectedEnemyBubbles(delta: number): void {
    if (this.affectedVisuals.size === 0) {
      this.enemyBubbleAccumulator = 0;
      return;
    }
    this.enemyBubbleAccumulator += delta;
    if (this.enemyBubbleAccumulator < ENEMY_BUBBLE_INTERVAL_MS) return;
    this.enemyBubbleAccumulator %= ENEMY_BUBBLE_INTERVAL_MS;
    for (const visual of this.affectedVisuals.values()) {
      this.enemyBubbles.emitParticleAt(
        visual.currentX + Phaser.Math.FloatBetween(-11, 11),
        visual.currentY + Phaser.Math.FloatBetween(-8, 8),
        1,
      );
    }
  }
}
