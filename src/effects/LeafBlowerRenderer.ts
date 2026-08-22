import * as Phaser from 'phaser';
import { mixColors } from './EffectUtils';
import { ensureLeafDebrisTexture } from './gpu/GpuVfxSourceTextures';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GPU_VFX_NO_SOURCE_HANDLE, GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import type { TerrainColorSnapshot } from '../arena/TerrainColorSnapshot';

const LEAF_PARTICLE_FREQUENCY_MS = 40;
const LEAF_PARTICLE_QUANTITY = 5;
const LEAF_PARTICLE_LIFESPAN_MIN_MS = 360;
const LEAF_PARTICLE_LIFESPAN_MAX_MS = 860;
const TERRAIN_SAMPLE_INTERVAL_MS = 300;
const LEAF_BLOWER_VISUAL_SIZE_SCALE = 4.7;
const LEAF_BLOWER_VISUAL_SIZE_OFFSET = -12;

const SPAWN_CIRCLE = new Phaser.Geom.Circle();
const SPAWN_POINT = new Phaser.Math.Vector2();

interface LeafBlowerVisual {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  flow: ParticleFlowScheduler;
  source: number;
  sampledColor: number;
  lastTerrainSampleAt: number;
}

function ensureLeafBlowerTextures(scene: Phaser.Scene): void {
  ensureLeafDebrisTexture(scene);
}

export class LeafBlowerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly visuals = new Map<number, LeafBlowerVisual>();
  private gpuVfx: GpuVfxSystem | null = null;
  private leafSpec: GpuVfxSpawnSpec | null = null;
  private terrainSnapshot: TerrainColorSnapshot | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  generateTextures(): void {
    ensureLeafBlowerTextures(this.scene);
  }

  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;
    this.leafSpec = system.createSpec(GpuVfxEffectId.LeafDebris);
    this.leafSpec.scaleEnd = 0.04;
    this.leafSpec.alphaStart = 0.96;
    this.leafSpec.alphaEnd = 0;
    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void {
    this.terrainSnapshot = snapshot;
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;

    this.visuals.set(id, {
      x,
      y,
      size,
      vx: 0,
      vy: 0,
      flow: new ParticleFlowScheduler(LEAF_PARTICLE_FREQUENCY_MS),
      source: this.gpuVfx?.createSource(GpuVfxEffectId.LeafDebris) ?? GPU_VFX_NO_SOURCE_HANDLE,
      sampledColor: 0xb7c8a7,
      lastTerrainSampleAt: -9999,
    });
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.x = x;
    visual.y = y;
    visual.size = size;
    visual.vx = vx;
    visual.vy = vy;
  }

  destroyVisual(id: number, immediate = false): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.visuals.delete(id);

    if (this.gpuVfx && visual.source !== GPU_VFX_NO_SOURCE_HANDLE) {
      if (immediate) this.gpuVfx.clearSource(visual.source);
      this.gpuVfx.releaseSource(visual.source);
    }
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const [id] of this.visuals) this.destroyVisual(id, true);
  }

  private emitParticles(deltaMs: number, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.leafSpec;
    if (!system || !spec || !this.terrainSnapshot) return;

    const frequency = system.quality.scaleFrequency(
      LEAF_PARTICLE_FREQUENCY_MS,
      GpuVfxEffectId.LeafDebris,
    );
    if (frequency <= 0) {
      system.recordQualityDrop(GpuVfxEffectId.LeafDebris);
      return;
    }

    for (const visual of this.visuals.values()) {
      if (nowMs - visual.lastTerrainSampleAt >= TERRAIN_SAMPLE_INTERVAL_MS) {
        visual.sampledColor = this.terrainSnapshot.sample(visual.x, visual.y);
        visual.lastTerrainSampleAt = nowMs;
      }
      visual.flow.setFrequency(frequency);
      const due = visual.flow.tick(deltaMs);
      for (let cycle = 0; cycle < due; cycle += 1) {
        for (let count = 0; count < LEAF_PARTICLE_QUANTITY; count += 1) {
          this.spawnLeaf(visual, spec, nowMs);
        }
      }
    }
  }

  private spawnLeaf(visual: LeafBlowerVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    if (!system) return;

    const visualSize = getVisualSize(visual.size);
    const speed = Math.max(1, Math.hypot(visual.vx, visual.vy));
    const dirX = visual.vx / speed;
    const dirY = visual.vy / speed;
    const heading = Math.atan2(visual.vy, visual.vx);
    const sourceRadius = Math.max(visualSize * 0.06, 1.25);
    const debrisRadius = Math.max(visualSize * 0.12, 2.4);
    const radius = Math.max(debrisRadius * 1.45, 4.4);
    const sourceX = visual.x - dirX * sourceRadius * 1.15;
    const sourceY = visual.y - dirY * sourceRadius * 1.15;

    SPAWN_CIRCLE.setTo(sourceX, sourceY, radius);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    const terrainBase = visual.sampledColor;
    const tint = pickGpuVfxTint([
      terrainBase,
      mixColors(terrainBase, 0x6f9340, 0.22),
      mixColors(terrainBase, 0x9e7c45, 0.12),
      mixColors(terrainBase, 0x597637, 0.16),
    ]);
    const emissionAngle = heading + Math.PI;
    const emissionSpeed = Phaser.Math.FloatBetween(
      Math.max(speed * 0.08, 18),
      Math.max(speed * 0.28, 48),
    );

    spec.frame = GpuVfxFrameId.LeafDebris;
    spec.lifeMs = Phaser.Math.FloatBetween(LEAF_PARTICLE_LIFESPAN_MIN_MS, LEAF_PARTICLE_LIFESPAN_MAX_MS);
    spec.x = SPAWN_POINT.x;
    spec.y = SPAWN_POINT.y;
    spec.vx = Math.cos(emissionAngle) * emissionSpeed;
    spec.vy = Math.sin(emissionAngle) * emissionSpeed;
    spec.yMode = GpuVfxEase.Linear;
    spec.rotation = Phaser.Math.FloatBetween(0, Math.PI * 2);
    spec.angularVelocity = 0;
    spec.scaleStart = Math.max(visualSize / 102, 0.11);
    spec.tint = tint;
    system.spawn(spec, visual.source, nowMs);
  }
}

function getVisualSize(size: number): number {
  return Math.max(size * LEAF_BLOWER_VISUAL_SIZE_SCALE + LEAF_BLOWER_VISUAL_SIZE_OFFSET, size);
}
