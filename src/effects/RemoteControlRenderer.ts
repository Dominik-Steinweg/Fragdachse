import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedRemoteControlTurret } from '../types';
import { circleZone, ensureCanvasTexture, fillRadialGradientTexture, mixColors, registerParticleEmitter } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';

const TEX_REMOTE_HALO = '__remote_control_halo';
const TEX_REMOTE_RING = '__remote_control_ring';
const TEX_REMOTE_SPARK = '__remote_control_spark';
const VISUAL_RADIUS = 24;
const RING_SIZE = 96;

interface RemoteControlVisual {
  halo: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  snapshot: SyncedRemoteControlTurret;
  seed: number;
}

/** Spielerfarbenes, dezentes Partikel-Feedback fuer das aktuell fernverstaerkte Konstrukt. */
export class RemoteControlRenderer {
  private readonly visuals = new Map<string, RemoteControlVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_REMOTE_HALO, 96, [
      [0, 'rgba(255,255,255,0.56)'],
      [0.4, 'rgba(255,255,255,0.22)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_REMOTE_RING, RING_SIZE, RING_SIZE, (ctx) => {
      ctx.clearRect(0, 0, RING_SIZE, RING_SIZE);
      const center = RING_SIZE / 2;
      const radius = center - 8;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2.5;
      for (let index = 0; index < 4; index += 1) {
        const start = (Math.PI * 2 * index) / 4 + 0.08;
        ctx.beginPath();
        ctx.arc(center, center, radius, start, start + Math.PI * 0.32);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(center, center, radius - 5, 0, Math.PI * 2);
      ctx.stroke();
    });

    fillRadialGradientTexture(this.scene.textures, TEX_REMOTE_SPARK, 10, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.45, 'rgba(255,255,255,0.48)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);
  }

  syncVisuals(targets: readonly SyncedRemoteControlTurret[], now: number): void {
    const activeIds = new Set(targets.map((target) => target.turretId));
    for (const turretId of this.visuals.keys()) {
      if (!activeIds.has(turretId)) this.destroyVisual(turretId);
    }

    for (const target of targets) {
      let visual = this.visuals.get(target.turretId);
      if (!visual) {
        visual = this.createVisual(target);
        this.visuals.set(target.turretId, visual);
      }
      visual.snapshot = target;
      this.updateVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const turretId of this.visuals.keys()) this.destroyVisual(turretId);
  }

  private createVisual(target: SyncedRemoteControlTurret): RemoteControlVisual {
    const halo = this.scene.add.image(target.x, target.y, TEX_REMOTE_HALO)
      .setDepth(DEPTH.PROJECTILES - 0.24)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(target.color);
    const ring = this.scene.add.image(target.x, target.y, TEX_REMOTE_RING)
      .setDepth(DEPTH.PROJECTILES - 0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0)
      .setTint(mixColors(target.color, 0xffffff, 0.42));
    const sparks = this.scene.add.particles(target.x, target.y, TEX_REMOTE_SPARK, {
      lifespan: { min: 260, max: 520 },
      speed: { min: 8, max: 24 },
      scale: { start: 0.28, end: 0 },
      alpha: { start: emissiveAlpha(0.62), end: 0 },
      quantity: 1,
      frequency: 95,
      maxAliveParticles: 8,
      blendMode: Phaser.BlendModes.ADD,
      tint: mixColors(target.color, 0xffffff, 0.28),
      emitZone: circleZone(VISUAL_RADIUS * 0.8),
    }).setDepth(DEPTH.PROJECTILES - 0.12);
    registerParticleEmitter(this.scene, 'remoteControl', sparks);

    return { halo, ring, sparks, snapshot: target, seed: hashSeed(target.turretId) };
  }

  private updateVisual(visual: RemoteControlVisual, now: number): void {
    const target = visual.snapshot;
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * 4.2 + visual.seed);
    const ringPulse = 0.5 + 0.5 * Math.sin(time * 2.4 + visual.seed * 1.6);
    const color = target.color;

    visual.halo
      .setPosition(target.x, target.y)
      .setTint(color)
      .setScale((VISUAL_RADIUS * 2 * (0.95 + pulse * 0.08)) / 96)
      .setAlpha(emissiveAlpha(0.24 + pulse * 0.16));
    visual.ring
      .setPosition(target.x, target.y)
      .setTint(mixColors(color, 0xffffff, 0.42))
      .setScale((VISUAL_RADIUS * 2) / RING_SIZE)
      .setRotation(-time * 0.8 + visual.seed)
      .setAlpha(emissiveAlpha(0.3 + ringPulse * 0.2));
    visual.sparks
      .setPosition(target.x, target.y)
      .setAlpha(0.72 + pulse * 0.18);

    this.lighting?.setLight(lightKey(target.turretId), 'electricField', target.x, target.y, {
      radiusPx: VISUAL_RADIUS * 2.8,
      color: mixColors(color, 0xffffff, 0.35),
      intensity: 0.28 + pulse * 0.12,
    });
  }

  private destroyVisual(turretId: string): void {
    this.lighting?.releaseLight(lightKey(turretId));
    const visual = this.visuals.get(turretId);
    if (!visual) return;
    visual.halo.destroy();
    visual.ring.destroy();
    visual.sparks.stop();
    visual.sparks.destroy();
    this.visuals.delete(turretId);
  }
}

function lightKey(turretId: string): string {
  return `remotecontrol:${turretId}`;
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 1000;
  }
  return (hash / 1000) * Math.PI * 2;
}
