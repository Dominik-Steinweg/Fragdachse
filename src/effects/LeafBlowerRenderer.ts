import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { createEmitter, destroyEmitter, ensureCanvasTexture, fillRadialGradientTexture, mixColors, setCircleEmitZone, setEmitterTintArray } from './EffectUtils';
import type { TerrainColorSampler } from '../arena/ArenaTerrainColorSampler';

const TEX_AIR = '__leaf_blower_air';
const TEX_CORE = '__leaf_blower_core';
const TEX_DUST = '__leaf_blower_dust';
const TEX_LEAF = '__leaf_blower_leaf';
const TERRAIN_SAMPLE_INTERVAL_MS = 200;

const DEPTH_STREAM = DEPTH.FIRE - 0.05;
const DEPTH_DEBRIS = DEPTH.FIRE + 0.05;

interface LeafBlowerVisual {
  coreMarker: Phaser.GameObjects.Image;
  airflowEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  leafEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sampledColor: number;
  lastTerrainSampleAt: number;
}

function ensureLeafBlowerTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;
  refreshLeafTexture(textures, TEX_CORE);
  refreshLeafTexture(textures, TEX_DUST);
  refreshLeafTexture(textures, TEX_AIR);
  refreshLeafTexture(textures, TEX_LEAF);

  fillRadialGradientTexture(textures, TEX_CORE, 28, [
    [0, 'rgba(242,248,245,0.86)'],
    [0.18, 'rgba(236,243,239,0.58)'],
    [0.46, 'rgba(212,223,217,0.24)'],
    [1, 'rgba(225,239,224,0)'],
  ]);

  ensureCanvasTexture(textures, TEX_DUST, 28, 28, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.ellipse(14, 14, 4.4, 3.2, -0.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.ellipse(9, 10, 1.8, 1.4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(18, 17, 1.7, 1.2, -0.45, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const [px, py, radius] of [[6, 18, 0.95], [12, 6, 0.8], [20, 9, 0.85], [22, 20, 0.72], [8, 8, 0.62], [15, 22, 0.68], [4, 12, 0.58]] as const) {
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  ensureCanvasTexture(textures, TEX_AIR, 96, 28, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 14, 96, 14);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.18, 'rgba(232,245,235,0.04)');
    gradient.addColorStop(0.5, 'rgba(232,245,235,0.18)');
    gradient.addColorStop(0.78, 'rgba(214,236,219,0.58)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(10, 14);
    ctx.quadraticCurveTo(28, 6, 76, 11);
    ctx.quadraticCurveTo(58, 14, 76, 17);
    ctx.quadraticCurveTo(28, 22, 10, 14);
    ctx.closePath();
    ctx.fill();
  });

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

    const coreMarker = this.scene.add.image(x, y, TEX_CORE)
      .setDepth(DEPTH_DEBRIS + 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.42)
      .setTint(0xf2f7ec);

    const airflowEmitter = createEmitter(this.scene, x, y, TEX_AIR, {
      lifespan: { min: 52, max: 82 },
      frequency: 18,
      quantity: 20,
      angle: 0,
      speed: { min: 72, max: 138 },
      scale: { start: 0.12 + size * 0.0022, end: 0.01 },
      alpha: { start: 0.08, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      rotate: { min: -4, max: 4 },
      emitting: true,
    }, DEPTH_STREAM);

    const dustEmitter = createEmitter(this.scene, x, y, TEX_DUST, {
      lifespan: { min: 130, max: 220 },
      frequency: 5,
      quantity: 40,
      angle: 0,
      speed: { min: 12, max: 44 },
      scale: { start: 0.13 + size * 0.0024, end: 0.03 },
      alpha: { start: 0.72, end: 0 },
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: true,
    }, DEPTH_STREAM - 0.05);

    const leafEmitter = createEmitter(this.scene, x, y, TEX_LEAF, {
      lifespan: { min: 160, max: 860 },
      frequency: 20,
      quantity: 20,
      angle: 0,
      speed: { min: 34, max: 162 },
      scale: { start: 0.16 + size * 0.0028, end: 0.01 },
      alpha: { start: 0.96, end: 0 },
      rotate: { min: 0, max: 360 },
      gravityY: 0,
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: true,
    }, DEPTH_DEBRIS);

    this.visuals.set(id, {
      coreMarker,
      airflowEmitter,
      dustEmitter,
      leafEmitter,
      sampledColor: 0xb7c8a7,
      lastTerrainSampleAt: -9999,
    });
    this.updateVisual(id, x, y, size, 0, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const speed = Math.max(1, Math.hypot(vx, vy));
    const dirX = vx / speed;
    const dirY = vy / speed;
    const heading = Math.atan2(vy, vx);
    const angleDeg = Phaser.Math.RadToDeg(heading);
    const pulse = Math.sin(this.scene.time.now * 0.015 + id * 0.37);
    const intensity = Phaser.Math.Clamp(speed / 420, 0.2, 1.2);
    const now = this.scene.time.now;
    if (this.terrainColorSampler && now - visual.lastTerrainSampleAt >= TERRAIN_SAMPLE_INTERVAL_MS) {
      visual.sampledColor = this.terrainColorSampler(x, y);
      visual.lastTerrainSampleAt = now;
    }

    const sourceRadius = Math.max(size * 0.06, 1.25);
    const debrisRadius = Math.max(size * 0.12, 2.4);
    const terrainBase = visual.sampledColor;
    const coreTint = mixColors(terrainBase, 0xf3f7f4, 0.62);
    const streamTint = mixColors(terrainBase, 0xe6f7e8, 0.54);
    const dustBright = mixColors(terrainBase, 0xe6e0d0, 0.08);
    const dustDark = mixColors(terrainBase, 0x645846, 0.1);
    const dustDeep = mixColors(terrainBase, 0x4f4638, 0.14);
    const leafMain = mixColors(terrainBase, 0x6f9340, 0.22);
    const leafAlt = mixColors(terrainBase, 0x9e7c45, 0.12);

    visual.coreMarker.setPosition(x, y);
    visual.coreMarker.setScale(Math.max(size / 48, 0.24) * (1 + pulse * 0.03));
    visual.coreMarker.setAlpha(0.28 + intensity * 0.06);
    visual.coreMarker.setTint(coreTint);

    visual.airflowEmitter.setPosition(x, y);
    visual.airflowEmitter.setAngle(angleDeg);
    visual.airflowEmitter.setParticleSpeed(Math.max(speed * 0.28, 90), Math.max(speed * 0.72, 170));
    visual.airflowEmitter.setParticleScale(Math.max(size / 112, 0.08), 0.01);
    setEmitterTintArray(visual.airflowEmitter, [0xfafffa, streamTint, coreTint]);
    setCircleEmitZone(visual.airflowEmitter, sourceRadius, 1, true);

    visual.dustEmitter.setPosition(x - dirX * sourceRadius * 0.45, y - dirY * sourceRadius * 0.45);
    visual.dustEmitter.setAngle(angleDeg + 180);
    visual.dustEmitter.setParticleSpeed(Math.max(size * 0.1, 8), Math.max(speed * 0.24, 38));
    visual.dustEmitter.setParticleScale(Math.max(size / 92, 0.1), 0.024);
    setEmitterTintArray(visual.dustEmitter, [terrainBase, dustBright, dustDark, dustDeep, terrainBase]);
    setCircleEmitZone(visual.dustEmitter, Math.max(sourceRadius * 1.1, 2.6), 1, true);

    visual.leafEmitter.setPosition(x + dirX * sourceRadius * 0.1, y + dirY * sourceRadius * 0.1);
    visual.leafEmitter.setAngle(angleDeg + Phaser.Math.Linear(-18, 18, (pulse + 1) * 0.5));
    visual.leafEmitter.setParticleSpeed(Math.max(speed * 0.4, 82), Math.max(speed * 0.92, 176));
    visual.leafEmitter.setParticleScale(Math.max(size / 102, 0.11), 0.04);
    setEmitterTintArray(visual.leafEmitter, [terrainBase, leafMain, leafAlt, mixColors(terrainBase, 0x597637, 0.16)]);
    setCircleEmitZone(visual.leafEmitter, Math.max(debrisRadius * 1.2, 3.2), 1, true);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    visual.coreMarker.destroy();
    destroyEmitter(visual.airflowEmitter);
    destroyEmitter(visual.dustEmitter);
    destroyEmitter(visual.leafEmitter);
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const [id] of this.visuals) {
      this.destroyVisual(id);
    }
  }
}