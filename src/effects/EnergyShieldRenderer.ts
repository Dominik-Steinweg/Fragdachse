import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedEnergyShield } from '../types';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
} from './EffectUtils';

const TEX_SHIELD_GLOW = '__energy_shield_glow';
const TEX_SHIELD_PARTICLE = '__energy_shield_particle';

interface ShieldVisual {
  halo: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Graphics;
  core: Phaser.GameObjects.Graphics;
  rimEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  currentAngle: number;
  targetAngle: number;
  currentRadius: number;
  targetRadius: number;
  currentThickness: number;
  targetThickness: number;
  currentAlpha: number;
  targetAlpha: number;
  currentFlashAlpha: number;
  targetFlashAlpha: number;
  arcDegrees: number;
  color: number;
}

const SHIELD_SMOOTH_TIME_MS = 46;

export class EnergyShieldRenderer {
  private readonly visuals = new Map<string, ShieldVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_SHIELD_GLOW, 128, [
      [0, 'rgba(255,255,255,0.34)'],
      [0.28, 'rgba(180,244,255,0.18)'],
      [0.66, 'rgba(90,200,255,0.06)'],
      [1, 'rgba(20,60,90,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_SHIELD_PARTICLE, 10, 10, (ctx) => {
      const g = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      g.addColorStop(0, 'rgba(255,255,255,1.0)');
      g.addColorStop(0.45, 'rgba(170,240,255,0.65)');
      g.addColorStop(1, 'rgba(60,160,220,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 10, 10);
    });
  }

  syncVisuals(shields: SyncedEnergyShield[]): void {
    const activeIds = new Set(shields.map(shield => shield.ownerId));

    for (const [ownerId, visual] of this.visuals) {
      if (activeIds.has(ownerId)) continue;
      visual.halo.destroy();
      visual.glow.destroy();
      visual.core.destroy();
      destroyEmitter(visual.rimEmitter);
      destroyEmitter(visual.sparkEmitter);
      this.visuals.delete(ownerId);
    }

    for (const shield of shields) {
      let visual = this.visuals.get(shield.ownerId);
      if (!visual) {
        visual = this.createVisual(shield);
        this.visuals.set(shield.ownerId, visual);
      }
      visual.targetX = shield.x;
      visual.targetY = shield.y;
      visual.targetAngle = shield.angle;
      visual.targetRadius = shield.radius;
      visual.targetThickness = shield.thickness;
      visual.targetAlpha = shield.alpha;
      visual.targetFlashAlpha = shield.flashAlpha;
      visual.arcDegrees = shield.arcDegrees;
      visual.color = shield.color;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-delta / SHIELD_SMOOTH_TIME_MS);

    for (const visual of this.visuals.values()) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);
      visual.currentAngle = Phaser.Math.Angle.RotateTo(visual.currentAngle, visual.targetAngle, lerp * Math.PI);
      visual.currentRadius = Phaser.Math.Linear(visual.currentRadius, visual.targetRadius, lerp);
      visual.currentThickness = Phaser.Math.Linear(visual.currentThickness, visual.targetThickness, lerp);
      visual.currentAlpha = Phaser.Math.Linear(visual.currentAlpha, visual.targetAlpha, lerp);
      visual.currentFlashAlpha = Phaser.Math.Linear(visual.currentFlashAlpha, visual.targetFlashAlpha, lerp);
      this.redrawVisual(visual);
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      visual.halo.destroy();
      visual.glow.destroy();
      visual.core.destroy();
      destroyEmitter(visual.rimEmitter);
      destroyEmitter(visual.sparkEmitter);
    }
    this.visuals.clear();
  }

  private createVisual(shield: SyncedEnergyShield): ShieldVisual {
    const halo = configureAdditiveImage(
      this.scene.add.image(shield.x, shield.y, TEX_SHIELD_GLOW),
      DEPTH.FIRE + 0.2,
      0.24,
      shield.color,
    );
    const glow = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.22);
    const core = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.24);
    const rimEmitter = createEmitter(this.scene, shield.x, shield.y, TEX_SHIELD_PARTICLE, {
      lifespan:  { min: 60, max: 110 },
      frequency: 18,
      quantity:  2,
      speed:     { min: 0, max: 4 },
      angle:     { min: 0, max: 360 },
      scale:     { start: 0.5, end: 0 },
      alpha:     { start: 0.5, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint:      [shield.color, shield.color, 0xffffff],
      emitting:  false,
    }, DEPTH.FIRE + 0.21);
    const sparkEmitter = createEmitter(this.scene, shield.x, shield.y, TEX_SHIELD_PARTICLE, {
      lifespan:  { min: 70, max: 130 },
      frequency: 16,
      quantity:  3,
      speed:     { min: 14, max: 38 },
      angle:     { min: 0, max: 360 },
      scale:     { start: 0.32, end: 0 },
      alpha:     { start: 0.75, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint:      [shield.color, 0xb8ffff, 0xffffff],
      emitting:  false,
    }, DEPTH.FIRE + 0.23);
    return {
      halo,
      glow,
      core,
      rimEmitter,
      sparkEmitter,
      currentX: shield.x,
      currentY: shield.y,
      targetX: shield.x,
      targetY: shield.y,
      currentAngle: shield.angle,
      targetAngle: shield.angle,
      currentRadius: shield.radius,
      targetRadius: shield.radius,
      currentThickness: shield.thickness,
      targetThickness: shield.thickness,
      currentAlpha: shield.alpha,
      targetAlpha: shield.alpha,
      currentFlashAlpha: shield.flashAlpha,
      targetFlashAlpha: shield.flashAlpha,
      arcDegrees: shield.arcDegrees,
      color: shield.color,
    };
  }

  private redrawVisual(visual: ShieldVisual): void {
    const start = visual.currentAngle - Phaser.Math.DegToRad(visual.arcDegrees) * 0.5;
    const end = visual.currentAngle + Phaser.Math.DegToRad(visual.arcDegrees) * 0.5;
    const radius = Math.max(4, visual.currentRadius);
    const thickness = Math.max(1.5, visual.currentThickness);
    const flash = Phaser.Math.Clamp(visual.currentFlashAlpha, 0, 1);
    const shieldAlpha = Phaser.Math.Clamp(visual.currentAlpha, 0, 1);
    const midAngle = (start + end) * 0.5;
    const haloScaleX = Math.max(0.82, (radius * 1.8) / 128);
    const haloScaleY = Math.max(0.62, (radius * 1.02) / 128);

    visual.halo
      .setPosition(visual.currentX + Math.cos(midAngle) * 1.5, visual.currentY + Math.sin(midAngle) * 1.5)
      .setRotation(visual.currentAngle)
      .setScale(haloScaleX, haloScaleY)
      .setTint(visual.color)
      .setAlpha(0.24 + shieldAlpha * 0.34 + flash * 0.3);

    visual.rimEmitter.setPosition(visual.currentX, visual.currentY);
    visual.sparkEmitter.setPosition(
      visual.currentX + Math.cos(midAngle) * radius,
      visual.currentY + Math.sin(midAngle) * radius,
    );
    const emitFlashParticles = flash > 0.06;
    visual.rimEmitter.emitting = emitFlashParticles;
    visual.sparkEmitter.emitting = emitFlashParticles;
    if (emitFlashParticles) {
      visual.rimEmitter.setParticleSpeed(0, 5 + flash * 10);
      visual.sparkEmitter.setParticleSpeed(12, 24 + flash * 20);
    }

    visual.glow.clear();
    visual.glow.lineStyle(thickness + 7, visual.color, Math.max(0.18, shieldAlpha * 0.44 + flash * 0.36));
    visual.glow.beginPath();
    visual.glow.arc(visual.currentX, visual.currentY, radius + 0.5, start, end, false);
    visual.glow.strokePath();

    visual.core.clear();
    visual.core.lineStyle(thickness + 0.9, 0x8ef3ff, Math.max(0.14, shieldAlpha * 0.82 + flash * 0.42));
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, radius, start, end, false);
    visual.core.strokePath();

    visual.core.lineStyle(Math.max(1.2, thickness * 0.7), visual.color, Math.max(0.4, shieldAlpha * 1.12 + flash * 0.26));
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, Math.max(2, radius - thickness * 0.8), start + 0.05, end - 0.05, false);
    visual.core.strokePath();

    const capRadius = Math.max(1.6, thickness * 0.45 + flash * 0.8);
    const startX = visual.currentX + Math.cos(start) * radius;
    const startY = visual.currentY + Math.sin(start) * radius;
    const endX = visual.currentX + Math.cos(end) * radius;
    const endY = visual.currentY + Math.sin(end) * radius;
    visual.core.fillStyle(0x8ef3ff, Math.max(0.28, shieldAlpha * 0.85 + flash * 0.15));
    visual.core.fillCircle(startX, startY, capRadius);
    visual.core.fillCircle(endX, endY, capRadius);
  }
}