import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { ArenaLayout } from '../types';
import { createLeafBlowerMaterialSampler, type LeafBlowerMaterial, type LeafBlowerMaterialSampler } from './LeafBlowerMaterial';
import { ensureLeafBlowerDustTexture, ensureLeafDebrisTexture } from './gpu/GpuVfxSourceTextures';
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
const DUST_PARTICLE_FREQUENCY_MS = 40;
const DUST_PARTICLE_LIFESPAN_MIN_MS = 350;
const DUST_PARTICLE_LIFESPAN_MAX_MS = 650;
const DUST_PARTICLE_ALPHA = 0.48;
const GRASS_BROWN_CHANCE = 0.05;
const DIRT_BROWN_CHANCE = 0.90;
const LEAF_BLOWER_VISUAL_SIZE_SCALE = 4.7;
const LEAF_BLOWER_VISUAL_SIZE_OFFSET = -12;

const SPAWN_CIRCLE = new Phaser.Geom.Circle();
const SPAWN_POINT = new Phaser.Math.Vector2();

/** Sichtbare Zielfarben; die GPU-Tints darunter kompensieren die gefaerbte Legacy-Quelltextur. */
export const LEAF_GREEN_COLORS: readonly number[] = [
  0x6f8f4d,
  0x809b55,
  0x6a8447,
  0x879858,
];
export const LEAF_BROWN_COLORS: readonly number[] = [
  0x88683e,
  0x7b5f38,
  0x836a43,
  0x755936,
];

const LEAF_GREEN_TINTS = LEAF_GREEN_COLORS.map(compensateLeafTint);
const LEAF_BROWN_TINTS = LEAF_BROWN_COLORS.map(compensateLeafTint);

interface LeafBlowerVisual {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  leafFlow: ParticleFlowScheduler;
  dustFlow: ParticleFlowScheduler;
  leafSource: number;
  dustSource: number;
  material: LeafBlowerMaterial;
  brownChance: number;
  lastMaterialSampleX: number;
  lastMaterialSampleY: number;
}

function ensureLeafBlowerTextures(scene: Phaser.Scene): void {
  ensureLeafDebrisTexture(scene);
  ensureLeafBlowerDustTexture(scene);
}

export class LeafBlowerRenderer {
  private readonly scene: Phaser.Scene;
  private readonly visuals = new Map<number, LeafBlowerVisual>();
  private gpuVfx: GpuVfxSystem | null = null;
  private leafSpec: GpuVfxSpawnSpec | null = null;
  private dustSpec: GpuVfxSpawnSpec | null = null;
  private terrainSnapshot: TerrainColorSnapshot | null = null;
  private materialSampler: LeafBlowerMaterialSampler | null = null;

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
    this.dustSpec = system.createSpec(GpuVfxEffectId.LeafBlowerDust);
    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
  }

  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void {
    this.terrainSnapshot = snapshot;
  }

  setTerrainMaterialLayout(
    layout: Pick<ArenaLayout, 'dirt' | 'tracks'> | null,
    baseCells: readonly { gridX: number; gridY: number }[] = [],
  ): void {
    this.materialSampler = layout
      ? createLeafBlowerMaterialSampler(layout, baseCells)
      : null;
    for (const visual of this.visuals.values()) {
      visual.lastMaterialSampleX = visual.x;
      visual.lastMaterialSampleY = visual.y;
      this.applyMaterialAt(visual, visual.x, visual.y);
    }
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;

    const visual: LeafBlowerVisual = {
      x,
      y,
      size,
      vx: 0,
      vy: 0,
      leafFlow: new ParticleFlowScheduler(LEAF_PARTICLE_FREQUENCY_MS),
      dustFlow: new ParticleFlowScheduler(DUST_PARTICLE_FREQUENCY_MS),
      leafSource: this.gpuVfx?.createSource(GpuVfxEffectId.LeafDebris) ?? GPU_VFX_NO_SOURCE_HANDLE,
      dustSource: this.gpuVfx?.createSource(GpuVfxEffectId.LeafBlowerDust) ?? GPU_VFX_NO_SOURCE_HANDLE,
      material: 'grass',
      brownChance: GRASS_BROWN_CHANCE,
      lastMaterialSampleX: x,
      lastMaterialSampleY: y,
    };
    this.applyMaterialAt(visual, x, y);
    this.visuals.set(id, visual);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    this.advanceMaterialSampling(visual, x, y);
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

    if (this.gpuVfx) {
      if (immediate) {
        if (visual.leafSource !== GPU_VFX_NO_SOURCE_HANDLE) this.gpuVfx.clearSource(visual.leafSource);
        if (visual.dustSource !== GPU_VFX_NO_SOURCE_HANDLE) this.gpuVfx.clearSource(visual.dustSource);
      }
      if (visual.leafSource !== GPU_VFX_NO_SOURCE_HANDLE) this.gpuVfx.releaseSource(visual.leafSource);
      if (visual.dustSource !== GPU_VFX_NO_SOURCE_HANDLE) this.gpuVfx.releaseSource(visual.dustSource);
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
    const leafSpec = this.leafSpec;
    const dustSpec = this.dustSpec;
    if (!system || !leafSpec || !dustSpec || !this.terrainSnapshot) return;

    const leafFrequency = system.quality.scaleFrequency(
      LEAF_PARTICLE_FREQUENCY_MS,
      GpuVfxEffectId.LeafDebris,
    );
    const dustFrequency = system.quality.scaleFrequency(
      DUST_PARTICLE_FREQUENCY_MS,
      GpuVfxEffectId.LeafBlowerDust,
    );
    if (leafFrequency <= 0) system.recordQualityDrop(GpuVfxEffectId.LeafDebris);
    if (dustFrequency <= 0) system.recordQualityDrop(GpuVfxEffectId.LeafBlowerDust);

    for (const visual of this.visuals.values()) {
      if (leafFrequency > 0) {
        visual.leafFlow.setFrequency(leafFrequency);
        const dueLeaves = visual.leafFlow.tick(deltaMs);
        for (let cycle = 0; cycle < dueLeaves; cycle += 1) {
          for (let count = 0; count < LEAF_PARTICLE_QUANTITY; count += 1) {
            this.spawnLeaf(visual, leafSpec, nowMs);
          }
        }
      }

      if (dustFrequency > 0) {
        visual.dustFlow.setFrequency(dustFrequency);
        const dueDust = visual.dustFlow.tick(deltaMs);
        for (let count = 0; count < dueDust; count += 1) {
          this.spawnDust(visual, dustSpec, nowMs);
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
    spec.scaleEnd = 0.04;
    spec.alphaStart = 0.96;
    spec.alphaEnd = 0;
    spec.tint = pickLeafTint(visual.brownChance);
    system.spawn(spec, visual.leafSource, nowMs);
  }

  private spawnDust(visual: LeafBlowerVisual, spec: GpuVfxSpawnSpec, nowMs: number): void {
    const system = this.gpuVfx;
    const snapshot = this.terrainSnapshot;
    if (!system || !snapshot) return;

    const visualSize = getVisualSize(visual.size);
    const speed = Math.max(1, Math.hypot(visual.vx, visual.vy));
    const dirX = visual.vx / speed;
    const dirY = visual.vy / speed;
    const heading = Math.atan2(visual.vy, visual.vx);
    const sourceRadius = Math.max(visualSize * 0.06, 1.25);
    const sourceX = visual.x - dirX * sourceRadius * 1.15;
    const sourceY = visual.y - dirY * sourceRadius * 1.15;
    const radius = Math.max(visualSize * 0.18, 5.5);

    SPAWN_CIRCLE.setTo(sourceX, sourceY, radius);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    const emissionAngle = heading + Math.PI + Phaser.Math.FloatBetween(-0.32, 0.32);
    const emissionSpeed = Phaser.Math.FloatBetween(
      Math.max(speed * 0.04, 10),
      Math.max(speed * 0.16, 24),
    );

    spec.frame = GpuVfxFrameId.LeafBlowerDust;
    spec.lifeMs = Phaser.Math.FloatBetween(DUST_PARTICLE_LIFESPAN_MIN_MS, DUST_PARTICLE_LIFESPAN_MAX_MS);
    spec.x = SPAWN_POINT.x;
    spec.y = SPAWN_POINT.y;
    spec.vx = Math.cos(emissionAngle) * emissionSpeed;
    spec.vy = Math.sin(emissionAngle) * emissionSpeed;
    spec.yMode = GpuVfxEase.Linear;
    spec.rotation = Phaser.Math.FloatBetween(0, Math.PI * 2);
    spec.angularVelocity = 0;
    spec.scaleStart = Math.max(visualSize / 160, 0.08);
    spec.scaleEnd = Math.max(visualSize / 105, 0.14);
    spec.alphaStart = DUST_PARTICLE_ALPHA;
    spec.alphaEnd = 0;
    spec.tint = snapshot.sample(SPAWN_POINT.x, SPAWN_POINT.y);
    system.spawn(spec, visual.dustSource, nowMs);
  }

  private advanceMaterialSampling(visual: LeafBlowerVisual, x: number, y: number): void {
    const dx = x - visual.lastMaterialSampleX;
    const dy = y - visual.lastMaterialSampleY;
    const distance = Math.hypot(dx, dy);
    if (distance < CELL_SIZE) return;

    const sampleCount = Math.floor(distance / CELL_SIZE);
    for (let index = 1; index <= sampleCount; index += 1) {
      const ratio = (index * CELL_SIZE) / distance;
      this.applyMaterialAt(visual, visual.lastMaterialSampleX + dx * ratio, visual.lastMaterialSampleY + dy * ratio);
    }
    const consumed = sampleCount * CELL_SIZE / distance;
    visual.lastMaterialSampleX += dx * consumed;
    visual.lastMaterialSampleY += dy * consumed;
  }

  private applyMaterialAt(visual: LeafBlowerVisual, x: number, y: number): void {
    const material = this.materialSampler?.sample(x, y) ?? 'grass';
    visual.material = material;
    if (material === 'dirt') visual.brownChance = DIRT_BROWN_CHANCE;
    else if (material === 'grass') visual.brownChance = GRASS_BROWN_CHANCE;
  }
}

/** Kompensiert den Multiply-Tint fuer die gefaerbte Legacy-Leaf-Quelltextur. */
export function compensateLeafTint(visibleColor: number): number {
  const red = compensateChannel((visibleColor >> 16) & 0xff, 0x8a);
  const green = compensateChannel((visibleColor >> 8) & 0xff, 0xa3);
  const blue = compensateChannel(visibleColor & 0xff, 0x57);
  return (red << 16) | (green << 8) | blue;
}

function compensateChannel(visible: number, source: number): number {
  return Math.min(0xff, Math.round((visible * 0xff) / source));
}

function pickLeafTint(brownChance: number): number {
  return pickGpuVfxTint(Math.random() < brownChance ? LEAF_BROWN_TINTS : LEAF_GREEN_TINTS);
}

function getVisualSize(size: number): number {
  return Math.max(size * LEAF_BLOWER_VISUAL_SIZE_SCALE + LEAF_BLOWER_VISUAL_SIZE_OFFSET, size);
}
