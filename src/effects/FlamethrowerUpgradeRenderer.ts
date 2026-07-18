import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { PlayerManager } from '../entities/PlayerManager';
import type { FireChunkTarget, PlayerNetState, SyncedBurningGroundCell, SyncedBurningGroundSnapshot } from '../types';
import { createEmitter, destroyEmitter, ensureCanvasTexture } from './EffectUtils';
import {
  ensureFlameTextures,
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
} from './FlameShared';
import { GROUND_FIRE_CELL_SIZE } from './FireSystem';

const TEX_GROUND_HEAT = '__ground_fire_heat_haze';
const TEX_GROUND_SMOKE = '__ground_fire_smoke';
const GROUND_DEPTH = DEPTH.ROCKS - 0.24;
const GROUND_PARTICLE_DEPTH = DEPTH.FIRE - 0.18;
const RING_PARTICLE_DEPTH = DEPTH.FIRE + 0.12;
const MAX_GROUND_EMISSIONS_PER_SECOND = 720;
// Ein Ring-Burst erzeugt zwei Aussenflammen, eine Kernflamme und gelegentlich
// einen Funken: 110 Bursts entsprechen etwa 360, das globale Cap etwa 480 Partikeln/s.
const MAX_RING_EMISSIONS_PER_SECOND = 148;

interface GroundVisual {
  image: Phaser.GameObjects.Image;
  expiresAt: number;
  intensity: number;
  phase: number;
}

/**
 * Gemeinsamer Partikelrenderer fuer das 16-Pixel-Brandraster und Flammenringe.
 * Weit ueberlappende, weiche Heat-Haze-Decals verbinden Nachbarzellen; die
 * sichtbaren Flammen, Glut und Funken stammen aus wenigen gepoolten Emittern.
 */
export class FlamethrowerUpgradeRenderer {
  private readonly ground = new Map<string, GroundVisual>();
  private readonly groundImagePool: Phaser.GameObjects.Image[] = [];
  private readonly flyingChunks = new Set<Phaser.GameObjects.Image>();
  private readonly ringRadii = new Map<string, number>();
  private readonly groundCore: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundOuter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly groundSmoke: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringCore: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringOuter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly ringSparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private cells: readonly SyncedBurningGroundCell[] = [];
  private groundAccumulator = 0;
  private ringAccumulator = 0;
  private ringCursor = 0;
  private previousNow = 0;
  private lastUpdateMs = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
  ) {
    ensureFlameTextures(scene);
    this.ensureHeatTexture();
    this.ensureSmokeTexture();
    this.groundCore = this.createCoreEmitter(GROUND_PARTICLE_DEPTH + 0.05, false);
    this.groundOuter = this.createOuterEmitter(GROUND_PARTICLE_DEPTH, false);
    this.groundSparks = this.createSparkEmitter(GROUND_PARTICLE_DEPTH + 0.1, false);
    this.groundSmoke = this.createSmokeEmitter(GROUND_PARTICLE_DEPTH - 0.08);
    this.ringCore = this.createCoreEmitter(RING_PARTICLE_DEPTH + 0.05, true);
    this.ringOuter = this.createOuterEmitter(RING_PARTICLE_DEPTH, true);
    this.ringSparks = this.createSparkEmitter(RING_PARTICLE_DEPTH + 0.1, true);
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot): void {
    this.cells = snapshot.cells;
    const blocks = new Map<string, { x: number; y: number; expiresAt: number; intensity: number; seed: number }>();
    for (const cell of snapshot.cells) {
      const blockX = Math.floor(cell.gridX / 2);
      const blockY = Math.floor(cell.gridY / 2);
      const key = `${blockX}:${blockY}`;
      const current = blocks.get(key);
      if (current) {
        current.expiresAt = Math.max(current.expiresAt, cell.expiresAt);
        current.intensity += Math.max(1, cell.intensity);
      } else {
        blocks.set(key, {
          x: (blockX * 2 + 1) * GROUND_FIRE_CELL_SIZE,
          y: (blockY * 2 + 1) * GROUND_FIRE_CELL_SIZE,
          expiresAt: cell.expiresAt,
          intensity: Math.max(1, cell.intensity),
          seed: (blockX * 73856093) ^ (blockY * 19349663),
        });
      }
    }
    for (const [key, visual] of this.ground) {
      if (!blocks.has(key)) this.releaseGroundVisual(key, visual);
    }

    for (const [key, block] of blocks) {
      let visual = this.ground.get(key);
      if (!visual) {
        const image = this.groundImagePool.pop()
          ?? this.scene.add.image(0, 0, TEX_GROUND_HEAT);
        const phase = this.seededUnit(block.seed, 17) * Math.PI * 2;
        image
          .setPosition(
            block.x + (this.seededUnit(block.seed, 31) - 0.5) * GROUND_FIRE_CELL_SIZE * 0.65,
            block.y + (this.seededUnit(block.seed, 47) - 0.5) * GROUND_FIRE_CELL_SIZE * 0.6,
          )
          .setDepth(GROUND_DEPTH)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setRotation(phase)
          .setVisible(true)
          .setActive(true);
        visual = { image, expiresAt: block.expiresAt, intensity: block.intensity, phase };
        this.ground.set(key, visual);
      }
      visual.expiresAt = block.expiresAt;
      visual.intensity = block.intensity;
    }
  }

  playFireChunkBurst(x: number, y: number, targets: readonly FireChunkTarget[], landsAt: number, now = Date.now()): void {
    const duration = Phaser.Math.Clamp(landsAt - now, 80, 420);
    for (const target of targets) {
      const chunk = this.scene.add.image(x, y, TEX_FLAME_EMBER)
        .setDepth(DEPTH.PROJECTILES + 0.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(Phaser.Utils.Array.GetRandom([...FLAME_COLORS_OUTER]))
        .setScale(0.72);
      this.flyingChunks.add(chunk);
      const arc = Phaser.Math.Between(22, 46);
      this.scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration,
        ease: 'Sine.easeInOut',
        onUpdate: tween => {
          if (!chunk.active) return;
          const t = tween.getValue() ?? 0;
          chunk.setPosition(
            Phaser.Math.Linear(x, target.x, t),
            Phaser.Math.Linear(y, target.y, t) - Math.sin(t * Math.PI) * arc,
          );
          chunk.setRotation(t * Math.PI * 4);
          chunk.setScale(0.72 + Math.sin(t * Math.PI) * 0.28);
        },
        onComplete: () => {
          const shouldLand = chunk.active;
          this.flyingChunks.delete(chunk);
          chunk.destroy();
          if (!shouldLand) return;
          this.groundOuter.emitParticleAt(target.x, target.y, 3);
          this.groundCore.emitParticleAt(target.x, target.y, 2);
          this.groundSparks.emitParticleAt(target.x, target.y, 3);
        },
      });
    }
  }

  syncRings(players: Readonly<Record<string, PlayerNetState>>): void {
    this.ringRadii.clear();
    for (const [playerId, state] of Object.entries(players)) {
      if ((state.flameRingRadius ?? 0) > 0 && state.alive && !state.isBurrowed) {
        this.ringRadii.set(playerId, state.flameRingRadius ?? 0);
      }
    }
  }

  update(now: number): void {
    const updateStartedAt = performance.now();
    const delta = this.previousNow > 0 ? Phaser.Math.Clamp(now - this.previousNow, 0, 100) : 16.67;
    this.previousNow = now;

    for (const [id, visual] of this.ground) {
      const remaining = visual.expiresAt - now;
      if (remaining <= 0) {
        this.releaseGroundVisual(id, visual);
        continue;
      }
      const intensity = Phaser.Math.Clamp(Math.log2(visual.intensity + 1) / 3, 0.28, 1);
      const fade = Phaser.Math.Clamp(remaining / 420, 0, 1);
      const breathe = 1 + Math.sin(now * 0.0022 + visual.phase) * 0.055;
      const baseScale = (GROUND_FIRE_CELL_SIZE * (3.7 + intensity * 0.52)) / 96;
      visual.image
        .setScale(baseScale * breathe, baseScale * (0.88 + Math.cos(now * 0.0017 + visual.phase) * 0.045))
        .setRotation(visual.phase + Math.sin(now * 0.00045 + visual.phase) * 0.08)
        .setAlpha((0.12 + intensity * 0.24) * fade)
        .setTint(intensity > 0.72 ? 0xff9a32 : 0xd94a1f);
    }

    this.emitGroundParticles(delta);
    this.emitRingParticles(delta, now);
    this.lastUpdateMs = performance.now() - updateStartedAt;
  }

  getLastUpdateCostMs(): number { return this.lastUpdateMs; }

  clear(): void {
    this.cells = [];
    for (const [id, visual] of this.ground) this.releaseGroundVisual(id, visual);
    this.ringRadii.clear();
    this.groundAccumulator = 0;
    this.ringAccumulator = 0;
    this.ringCursor = 0;
    this.previousNow = 0;
    this.lastUpdateMs = 0;
    this.groundCore.killAll();
    this.groundOuter.killAll();
    this.groundSparks.killAll();
    this.groundSmoke.killAll();
    this.ringCore.killAll();
    this.ringOuter.killAll();
    this.ringSparks.killAll();
    for (const chunk of this.flyingChunks) {
      this.scene.tweens.killTweensOf(chunk);
      chunk.destroy();
    }
    this.flyingChunks.clear();
  }

  destroyAll(): void {
    this.clear();
    for (const image of this.groundImagePool) image.destroy();
    this.groundImagePool.length = 0;
    destroyEmitter(this.groundCore);
    destroyEmitter(this.groundOuter);
    destroyEmitter(this.groundSparks);
    destroyEmitter(this.groundSmoke);
    destroyEmitter(this.ringCore);
    destroyEmitter(this.ringOuter);
    destroyEmitter(this.ringSparks);
  }

  private emitGroundParticles(delta: number): void {
    if (this.cells.length === 0) return;
    const intensitySum = this.cells.reduce((sum, cell) => sum + Math.min(4, Math.max(1, cell.intensity)), 0);
    const rate = Math.min(MAX_GROUND_EMISSIONS_PER_SECOND, 30 + intensitySum * 1.8);
    this.groundAccumulator += delta * rate / 1000;
    let emissions = Math.min(32, Math.floor(this.groundAccumulator));
    this.groundAccumulator -= emissions;

    while (emissions-- > 0 && this.cells.length > 0) {
      let cell = Phaser.Utils.Array.GetRandom(this.cells as SyncedBurningGroundCell[]);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const candidate = Phaser.Utils.Array.GetRandom(this.cells as SyncedBurningGroundCell[]);
        if (candidate.intensity > cell.intensity && Math.random() < 0.7) cell = candidate;
      }
      const intensity = Math.max(1, cell.intensity);
      const x = (cell.gridX + 0.5) * GROUND_FIRE_CELL_SIZE
        + Phaser.Math.FloatBetween(-GROUND_FIRE_CELL_SIZE * 0.72, GROUND_FIRE_CELL_SIZE * 0.72);
      const y = (cell.gridY + 0.5) * GROUND_FIRE_CELL_SIZE
        + Phaser.Math.FloatBetween(-GROUND_FIRE_CELL_SIZE * 0.58, GROUND_FIRE_CELL_SIZE * 0.58);
      this.groundOuter.emitParticleAt(x, y, intensity >= 3 ? 2 : 1);
      if (Math.random() < 0.55 || intensity >= 2) this.groundCore.emitParticleAt(x, y + 2, 1);
      if (Math.random() < Math.min(0.42, 0.08 + intensity * 0.07)) {
        this.groundSparks.emitParticleAt(x, y, 1);
      }
      if (Math.random() < 0.12) this.groundSmoke.emitParticleAt(x, y - 3, 1);
    }
  }

  private emitRingParticles(delta: number, now: number): void {
    if (this.ringRadii.size === 0) return;
    const rate = Math.min(MAX_RING_EMISSIONS_PER_SECOND, this.ringRadii.size * 110);
    this.ringAccumulator += delta * rate / 1000;
    let emissions = Math.min(28, Math.floor(this.ringAccumulator));
    this.ringAccumulator -= emissions;
    const rings = [...this.ringRadii.entries()];

    while (emissions-- > 0 && rings.length > 0) {
      const [playerId, radius] = rings[this.ringCursor % rings.length];
      const player = this.playerManager.getPlayer(playerId);
      this.ringCursor += 1;
      if (!player?.sprite.visible) continue;

      const stream = this.ringCursor & 1;
      const direction = stream === 0 ? 1 : -1;
      const orbit = direction * now * 0.00012;
      const angle = orbit + this.ringCursor * 2.399963229728653;
      const wobble = Math.sin(angle * 3 - direction * now * 0.00115) * 3.2
        + Math.sin(angle * 5 + direction * now * 0.0007) * 1.4;
      const x = player.sprite.x + Math.cos(angle) * (radius + wobble);
      const y = player.sprite.y + Math.sin(angle) * (radius + wobble);
      this.ringOuter.emitParticleAt(x, y, 2);
      this.ringCore.emitParticleAt(x, y + 1, 1);
      if (this.ringCursor % 4 === 0) this.ringSparks.emitParticleAt(x, y, 1);
    }
  }

  private createCoreEmitter(depth: number, ring: boolean): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_CORE, {
      lifespan: ring ? { min: 520, max: 880 } : { min: 250, max: 520 },
      frequency: -1,
      quantity: 1,
      speedX: ring ? { min: -18, max: 18 } : { min: -13, max: 13 },
      speedY: ring ? { min: -64, max: -20 } : { min: -48, max: -14 },
      gravityY: -18,
      scale: { start: ring ? 0.62 : 0.52, end: 0.035 },
      alpha: { start: 0.96, end: 0 },
      tint: [...FLAME_COLORS_CORE],
      rotate: { min: -35, max: 35 },
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: ring ? 680 : 920,
      reserve: ring ? 180 : 260,
      emitting: false,
    }, depth);
  }

  private createOuterEmitter(depth: number, ring: boolean): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_EMBER, {
      lifespan: ring ? { min: 680, max: 1120 } : { min: 390, max: 780 },
      frequency: -1,
      quantity: 1,
      speedX: ring ? { min: -27, max: 27 } : { min: -20, max: 20 },
      speedY: ring ? { min: -58, max: -10 } : { min: -46, max: -7 },
      gravityY: -10,
      scale: { start: ring ? 0.78 : 0.67, end: 0.055 },
      alpha: { start: 0.82, end: 0 },
      tint: [...FLAME_COLORS_OUTER],
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: ring ? 820 : 1300,
      reserve: ring ? 240 : 380,
      emitting: false,
    }, depth);
  }

  private createSparkEmitter(depth: number, ring: boolean): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_FLAME_SPARK, {
      lifespan: { min: 300, max: 680 },
      frequency: -1,
      quantity: 1,
      speedX: ring ? { min: -48, max: 48 } : { min: -34, max: 34 },
      speedY: ring ? { min: -125, max: -55 } : { min: -98, max: -38 },
      gravityY: -36,
      scale: { start: ring ? 0.92 : 0.75, end: 0.04 },
      alpha: { start: 1, end: 0 },
      tint: [...FLAME_COLORS_SPARK],
      blendMode: Phaser.BlendModes.ADD,
      maxParticles: ring ? 360 : 520,
      reserve: ring ? 100 : 150,
      emitting: false,
    }, depth);
  }

  private createSmokeEmitter(depth: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return createEmitter(this.scene, 0, 0, TEX_GROUND_SMOKE, {
      lifespan: { min: 950, max: 1650 }, frequency: -1, quantity: 1,
      speedX: { min: -9, max: 9 }, speedY: { min: -24, max: -10 },
      scale: { start: 0.34, end: 0.78 }, alpha: { start: 0.16, end: 0 },
      tint: [0x72675d, 0x857468, 0x5c5651], rotate: { min: 0, max: 360 },
      maxParticles: 260, reserve: 80, emitting: false,
    }, depth);
  }

  private releaseGroundVisual(id: string, visual: GroundVisual): void {
    this.ground.delete(id);
    visual.image.setVisible(false).setActive(false).clearTint();
    this.groundImagePool.push(visual.image);
  }

  private ensureHeatTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_GROUND_HEAT, 96, 96, (ctx) => {
      const size = 96;
      const center = size * 0.5;
      const pixels = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const nx = (x + 0.5 - center) / center;
          const ny = (y + 0.5 - center) / center;
          const radius = Math.hypot(nx, ny);
          const angle = Math.atan2(ny, nx);
          const contour = 0.73
            + Math.sin(angle * 3 + 0.8) * 0.09
            + Math.sin(angle * 7 - 1.5) * 0.045;
          const edge = Phaser.Math.Clamp((contour - radius) / 0.56, 0, 1);
          const turbulence = 0.78
            + Math.sin(nx * 8.1 + ny * 5.7) * 0.09
            + Math.sin(nx * 17.3 - ny * 11.2) * 0.05;
          const alpha = Math.pow(edge, 1.28) * turbulence;
          if (alpha <= 0.002) continue;
          const offset = (y * size + x) * 4;
          pixels.data[offset] = 255;
          pixels.data[offset + 1] = 116;
          pixels.data[offset + 2] = 24;
          pixels.data[offset + 3] = Math.round(Phaser.Math.Clamp(alpha * 82, 0, 82));
        }
      }
      ctx.putImageData(pixels, 0, 0);
    });
  }

  private ensureSmokeTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_GROUND_SMOKE, 48, 48, (ctx) => {
      const gradient = ctx.createRadialGradient(24, 24, 2, 24, 24, 24);
      gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
      gradient.addColorStop(0.45, 'rgba(230,230,230,0.23)');
      gradient.addColorStop(1, 'rgba(200,200,200,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 48, 48);
    });
  }

  private seededUnit(id: number, salt: number): number {
    const value = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }
}
