import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  setCircleEmitZone,
} from '../../effects/EffectUtils';

const TEX_TUNNEL_SHADOW = '__tunnel_shadow';
const TEX_TUNNEL_AURA = '__tunnel_aura';
const TEX_TUNNEL_SOIL = '__tunnel_soil';
const TEX_TUNNEL_RIM = '__tunnel_rim';
const TEX_TUNNEL_CORE = '__tunnel_core';
const TEX_TUNNEL_DUST = '__tunnel_dust';
const TEX_TUNNEL_MOTE = '__tunnel_mote';

export const TUNNEL_VISUAL_DEPTH = DEPTH.PLAYERS - 0.34;
export const TUNNEL_HOLE_DIAMETER = 32;

export interface TunnelEndpointState {
  x: number;
  y: number;
  ownerColor: number;
  alpha?: number;
  particleIntensity?: number;
  sizePx?: number;
}

export class TunnelEndpointVisual {
  private readonly phase: number;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly aura: Phaser.GameObjects.Image;
  private readonly soil: Phaser.GameObjects.Image;
  private readonly rim: Phaser.GameObjects.Image;
  private readonly core: Phaser.GameObjects.Image;
  private readonly dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly moteEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly emberEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private ownerColor: number;
  private visible = true;
  private lastDustZoneRadius = -1;
  private lastMoteZoneRadius = -1;
  private lastEmberZoneRadius = -1;

  constructor(
    private readonly scene: Phaser.Scene,
    key: string,
    initialState: TunnelEndpointState,
    private readonly depth = TUNNEL_VISUAL_DEPTH,
  ) {
    ensureTunnelTextures(scene);
    this.phase = hashPhase(key);
    this.ownerColor = initialState.ownerColor;

    this.shadow = scene.add.image(initialState.x, initialState.y, TEX_TUNNEL_SHADOW)
      .setDepth(depth)
      .setVisible(true);

    this.aura = configureAdditiveImage(
      scene.add.image(initialState.x, initialState.y, TEX_TUNNEL_AURA),
      depth + 0.01,
      0.12,
      mixColors(initialState.ownerColor, 0x8e6638, 0.82),
    );

    this.soil = scene.add.image(initialState.x, initialState.y, TEX_TUNNEL_SOIL)
      .setDepth(depth + 0.02)
      .setVisible(true);

    this.rim = scene.add.image(initialState.x, initialState.y, TEX_TUNNEL_RIM)
      .setDepth(depth + 0.03)
      .setVisible(true);

    this.core = scene.add.image(initialState.x, initialState.y, TEX_TUNNEL_CORE)
      .setDepth(depth + 0.04)
      .setVisible(true);

    this.dustEmitter = createEmitter(scene, initialState.x, initialState.y, TEX_TUNNEL_DUST, {
      lifespan: { min: 600, max: 1100 },
      frequency: 22,
      quantity: 2,
      speed: { min: 8, max: 28 },
      scale: { start: 1.38, end: 0.06 },
      alpha: { start: 0.72, end: 0 },
      angle: { min: 0, max: 360 },
      rotate: { min: -90, max: 90 },
      tint: [0x4d2f17, 0x734523, 0xa36a3c, 0xd8bf93],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, depth + 0.05);

    this.moteEmitter = createEmitter(scene, initialState.x, initialState.y, TEX_TUNNEL_MOTE, {
      lifespan: { min: 500, max: 900 },
      frequency: 30,
      quantity: 2,
      speed: { min: 4, max: 16 },
      scale: { start: 1.30, end: 0.04 },
      alpha: { start: 0.88, end: 0 },
      angle: { min: 0, max: 360 },
      tint: [mixColors(initialState.ownerColor, 0xffffff, 0.5), mixColors(initialState.ownerColor, 0xffffff, 0.2), 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, depth + 0.06);

    this.emberEmitter = createEmitter(scene, initialState.x, initialState.y, TEX_TUNNEL_DUST, {
      lifespan: { min: 800, max: 1400 },
      frequency: 45,
      quantity: 1,
      speedX: { min: -10, max: 10 },
      speedY: { min: -18, max: -4 },
      scale: { start: 1.22, end: 0.02 },
      alpha: { start: 0.55, end: 0 },
      tint: [0x5c3920, 0xa97e55, 0xd8bf93],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, depth + 0.07);

    this.sync(initialState, 0);
  }

  sync(state: TunnelEndpointState, now: number): void {
    const alpha = Phaser.Math.Clamp(state.alpha ?? 1, 0, 1);
    const particleIntensity = Phaser.Math.Clamp(state.particleIntensity ?? 1, 0, 2);
    const size = Math.max(8, state.sizePx ?? TUNNEL_HOLE_DIAMETER);
    const pulse = Math.sin(now * 0.0022 + this.phase);
    const shimmer = Math.cos(now * 0.0016 + this.phase * 0.73);

    if (!this.visible) {
      this.setVisible(true);
    }

    if (this.ownerColor !== state.ownerColor) {
      this.ownerColor = state.ownerColor;
      this.aura.setTint(mixColors(state.ownerColor, 0x8e6638, 0.82));
    }

    const ringSize = size * (1.08 + pulse * 0.012);
    const soilSize = size * (1.18 + shimmer * 0.015);
    const auraSize = size * (1.38 + pulse * 0.028);
    const shadowSize = size * (1.72 + shimmer * 0.03);
    const coreSize = size * (0.9 + pulse * 0.01);
    const zoneRadius = size * 0.52;

    this.shadow
      .setPosition(state.x, state.y)
      .setDisplaySize(shadowSize, shadowSize)
      .setAlpha(alpha * (0.42 + (shimmer + 1) * 0.04));

    this.aura
      .setPosition(state.x, state.y)
      .setDisplaySize(auraSize, auraSize)
      .setAlpha(alpha * (0.08 + (pulse + 1) * 0.025));

    this.soil
      .setPosition(state.x, state.y)
      .setDisplaySize(soilSize, soilSize)
      .setRotation(now * 0.00008 + this.phase * 0.05)
      .setAlpha(alpha * 0.94);

    this.rim
      .setPosition(state.x, state.y)
      .setDisplaySize(ringSize, ringSize)
      .setRotation(-now * 0.00011 + this.phase * 0.09)
      .setAlpha(alpha * (0.88 + pulse * 0.03));

    this.core
      .setPosition(state.x, state.y)
      .setDisplaySize(coreSize, coreSize)
      .setAlpha(alpha * 0.98);

    const dustZoneRadius = zoneRadius;
    const moteZoneRadius = size * 0.36;
    const emberZoneRadius = size * 0.46;

    this.dustEmitter.setPosition(state.x, state.y);
    this.dustEmitter.setFrequency(Math.max(12, Math.floor(50 / Math.max(0.35, particleIntensity))), 2);
    if (dustZoneRadius !== this.lastDustZoneRadius) {
      setCircleEmitZone(this.dustEmitter, dustZoneRadius, 1, true);
      this.lastDustZoneRadius = dustZoneRadius;
    }

    this.moteEmitter.setPosition(state.x, state.y);
    this.moteEmitter.setFrequency(Math.max(18, Math.floor(68 / Math.max(0.35, particleIntensity))), 2);
    if (moteZoneRadius !== this.lastMoteZoneRadius) {
      setCircleEmitZone(this.moteEmitter, moteZoneRadius, 1, true);
      this.lastMoteZoneRadius = moteZoneRadius;
    }

    this.emberEmitter.setPosition(state.x, state.y);
    this.emberEmitter.setFrequency(Math.max(28, Math.floor(100 / Math.max(0.35, particleIntensity))), 1);
    if (emberZoneRadius !== this.lastEmberZoneRadius) {
      setCircleEmitZone(this.emberEmitter, emberZoneRadius, 1, true);
      this.lastEmberZoneRadius = emberZoneRadius;
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.shadow.setVisible(visible);
    this.aura.setVisible(visible);
    this.soil.setVisible(visible);
    this.rim.setVisible(visible);
    this.core.setVisible(visible);
    this.dustEmitter.setVisible(visible);
    this.moteEmitter.setVisible(visible);
    this.emberEmitter.setVisible(visible);
    if (visible) {
      this.dustEmitter.start();
      this.moteEmitter.start();
      this.emberEmitter.start();
    } else {
      this.dustEmitter.stop();
      this.moteEmitter.stop();
      this.emberEmitter.stop();
    }
  }

  destroy(): void {
    this.shadow.destroy();
    this.aura.destroy();
    this.soil.destroy();
    this.rim.destroy();
    this.core.destroy();
    destroyEmitter(this.dustEmitter);
    destroyEmitter(this.moteEmitter);
    destroyEmitter(this.emberEmitter);
  }
}

function ensureTunnelTextures(scene: Phaser.Scene): void {
  fillRadialGradientTexture(scene.textures, TEX_TUNNEL_SHADOW, 96, [
    [0, 'rgba(0,0,0,0.86)'],
    [0.32, 'rgba(8,6,5,0.58)'],
    [0.68, 'rgba(12,9,6,0.18)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

  fillRadialGradientTexture(scene.textures, TEX_TUNNEL_AURA, 80, [
    [0, 'rgba(0,0,0,0)'],
    [0.44, 'rgba(141,103,56,0.16)'],
    [0.76, 'rgba(85,58,28,0.08)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

  fillRadialGradientTexture(scene.textures, TEX_TUNNEL_CORE, 64, [
    [0, 'rgba(0,0,0,1)'],
    [0.4, 'rgba(4,3,3,0.98)'],
    [0.74, 'rgba(20,13,8,0.78)'],
    [1, 'rgba(49,30,16,0.0)'],
  ]);

  fillRadialGradientTexture(scene.textures, TEX_TUNNEL_DUST, 18, [
    [0, 'rgba(240,220,186,0.92)'],
    [0.34, 'rgba(191,146,97,0.74)'],
    [0.72, 'rgba(112,73,42,0.28)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

  fillRadialGradientTexture(scene.textures, TEX_TUNNEL_MOTE, 14, [
    [0, 'rgba(255,255,255,1)'],
    [0.28, 'rgba(221,195,154,0.86)'],
    [0.72, 'rgba(111,78,42,0.18)'],
    [1, 'rgba(0,0,0,0)'],
  ]);

  ensureCanvasTexture(scene.textures, TEX_TUNNEL_SOIL, 96, 96, (ctx) => {
    const center = 48;
    ctx.save();
    ctx.translate(center, center);

    const soilGradient = ctx.createRadialGradient(0, 0, 10, 0, 0, 34);
    soilGradient.addColorStop(0, 'rgba(78,50,25,0)');
    soilGradient.addColorStop(0.56, 'rgba(82,52,28,0.88)');
    soilGradient.addColorStop(0.86, 'rgba(47,28,15,0.92)');
    soilGradient.addColorStop(1, 'rgba(19,11,7,0)');
    ctx.fillStyle = soilGradient;
    ctx.beginPath();
    ctx.arc(0, 0, 35, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    for (let index = 0; index < 14; index += 1) {
      const angle = (Math.PI * 2 * index) / 14;
      const radius = 24 + (index % 2) * 4;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      ctx.fillStyle = index % 3 === 0 ? 'rgba(171,117,73,0.28)' : 'rgba(63,39,20,0.24)';
      ctx.beginPath();
      ctx.arc(x, y, 4 + (index % 3), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  });

  ensureCanvasTexture(scene.textures, TEX_TUNNEL_RIM, 96, 96, (ctx) => {
    const center = 48;
    ctx.save();
    ctx.translate(center, center);

    const ringGradient = ctx.createRadialGradient(0, 0, 14, 0, 0, 24);
    ringGradient.addColorStop(0, 'rgba(118,83,49,0.0)');
    ringGradient.addColorStop(0.72, 'rgba(146,103,63,0.88)');
    ringGradient.addColorStop(1, 'rgba(72,46,24,0.62)');
    ctx.fillStyle = ringGradient;
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(0, 0, 15.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(214,175,126,0.34)';
    ctx.beginPath();
    ctx.arc(-1.6, -2.2, 17.8, Math.PI * 1.1, Math.PI * 1.92);
    ctx.stroke();

    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(56,34,16,0.54)';
    ctx.beginPath();
    ctx.arc(2.2, 2.6, 16.2, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();

    ctx.restore();
  });
}

function hashPhase(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash) + key.charCodeAt(index);
    hash |= 0;
  }
  return (Math.abs(hash) % 628) / 100;
}