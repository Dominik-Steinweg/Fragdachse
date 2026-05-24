import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { createEmitter, destroyEmitter, ensureCanvasTexture, mixColors, setCircleEmitZone, setEmitterTintArray } from './EffectUtils';
import type { TerrainColorSampler } from '../arena/ArenaTerrainColorSampler';

const TEX_LEAF = '__leaf_blower_leaf';
const TERRAIN_SAMPLE_INTERVAL_MS = 30;
const LEAF_PARTICLE_LINGER_MS = 1220;
const LEAF_BLOWER_VISUAL_SIZE_SCALE = 2.7;
const LEAF_BLOWER_VISUAL_SIZE_OFFSET = -12;

const DEPTH_DEBRIS = DEPTH.FIRE + 0.05;

interface LeafBlowerVisual {
  leafEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sampledColor: number;
  lastTerrainSampleAt: number;
}

function ensureLeafBlowerTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  refreshLeafTexture(textures, TEX_LEAF);

  ensureCanvasTexture(textures, TEX_LEAF, 24, 18, (ctx) => {
    ctx.translate(12, 9);
    ctx.rotate(-0.28);
    ctx.fillStyle = '#8aa357';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.quadraticCurveTo(-2, -8, 8, -2);
    ctx.quadraticCurveTo(10, 0, 8, 2);
    ctx.quadraticCurveTo(-2, 8, -9, 0);
    ctx.fill();
    ctx.strokeStyle = '#d8c97a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });
}

function refreshLeafTexture(textures: Phaser.Textures.TextureManager, key: string): void {
  if (textures.exists(key)) {
    textures.remove(key);
  }
}

export class LeafBlowerRenderer {
  private scene: Phaser.Scene;
  private visuals = new Map<number, LeafBlowerVisual>();
  private terrainColorSampler: TerrainColorSampler | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  generateTextures(): void {
    ensureLeafBlowerTextures(this.scene);
  }

  setTerrainColorSampler(sampler: TerrainColorSampler | null): void {
    this.terrainColorSampler = sampler;
  }

  createVisual(id: number, x: number, y: number, size: number): void {
    if (this.visuals.has(id)) return;

    const visualSize = getVisualSize(size);

    const leafEmitter = createEmitter(this.scene, x, y, TEX_LEAF, {
      lifespan: { min: 360, max: 860 },
      frequency: 40,
      quantity: 5,
      angle: 0,
      speed: { min: 34, max: 62 },
      scale: { start: 0.16 + visualSize * 0.016, end: 0.01 },
      alpha: { start: 0.96, end: 0 },
      rotate: { min: 0, max: 360 },
      gravityY: 0,
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: true,
    }, DEPTH_DEBRIS);

    this.visuals.set(id, {
      leafEmitter,
      sampledColor: 0xb7c8a7,
      lastTerrainSampleAt: -9999,
    });
    this.updateVisual(id, x, y, size, 0, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const visualSize = getVisualSize(size);

    const speed = Math.max(1, Math.hypot(vx, vy));
    const dirX = vx / speed;
    const dirY = vy / speed;
    const heading = Math.atan2(vy, vx);
    const angleDeg = Phaser.Math.RadToDeg(heading);
    const now = this.scene.time.now;
    if (this.terrainColorSampler && now - visual.lastTerrainSampleAt >= TERRAIN_SAMPLE_INTERVAL_MS) {
      visual.sampledColor = this.terrainColorSampler(x, y);
      visual.lastTerrainSampleAt = now;
    }

    const sourceRadius = Math.max(visualSize * 0.06, 1.25);
    const debrisRadius = Math.max(visualSize * 0.12, 2.4);
    const terrainBase = visual.sampledColor;
    const leafMain = mixColors(terrainBase, 0x6f9340, 0.22);
    const leafAlt = mixColors(terrainBase, 0x9e7c45, 0.12);

    visual.leafEmitter.setPosition(x - dirX * sourceRadius * 1.15, y - dirY * sourceRadius * 1.15);
    visual.leafEmitter.setAngle(angleDeg + 180);
    visual.leafEmitter.setParticleSpeed(Math.max(speed * 0.08, 18), Math.max(speed * 0.28, 48));
    visual.leafEmitter.setParticleScale(Math.max(visualSize / 102, 0.11), 0.04);
    setEmitterTintArray(visual.leafEmitter, [terrainBase, leafMain, leafAlt, mixColors(terrainBase, 0x597637, 0.16)]);
    setCircleEmitZone(visual.leafEmitter, Math.max(debrisRadius * 1.45, 4.4), 1, true);
  }

  destroyVisual(id: number, immediate = false): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    this.visuals.delete(id);

    if (immediate) {
      destroyEmitter(visual.leafEmitter);
      return;
    }

    stopEmitterWithLinger(this.scene, visual.leafEmitter, LEAF_PARTICLE_LINGER_MS);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const [id] of this.visuals) {
      this.destroyVisual(id, true);
    }
  }
}

function getVisualSize(size: number): number {
  return Math.max(size * LEAF_BLOWER_VISUAL_SIZE_SCALE + LEAF_BLOWER_VISUAL_SIZE_OFFSET, size);
}

function stopEmitterWithLinger(
  scene: Phaser.Scene,
  emitter: Phaser.GameObjects.Particles.ParticleEmitter,
  lingerMs: number,
): void {
  emitter.stop();
  scene.time.delayedCall(lingerMs, () => {
    if (!emitter.active) return;
    emitter.destroy();
  });
}