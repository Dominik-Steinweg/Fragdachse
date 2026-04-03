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

const TEX_SHIELD_GLOW     = '__energy_shield_glow';
const TEX_SHIELD_PARTICLE = '__energy_shield_particle';
const TEX_SHIELD_FLARE    = '__energy_shield_flare';

/** Brighter tint of a hex color, used for highlight accents. */
function lightenColor(hex: number, t = 0.55): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >>  8) & 0xff;
  const b =  hex        & 0xff;
  return (
    (Math.min(255, r + (((255 - r) * t) | 0)) << 16) |
    (Math.min(255, g + (((255 - g) * t) | 0)) <<  8) |
     Math.min(255, b + (((255 - b) * t) | 0))
  );
}

interface ShieldVisual {
  halo:         Phaser.GameObjects.Image;
  outerGlow:    Phaser.GameObjects.Graphics;
  glow:         Phaser.GameObjects.Graphics;
  core:         Phaser.GameObjects.Graphics;
  rimEmitter:   Phaser.GameObjects.Particles.ParticleEmitter;
  flowEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  sparkEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  currentX:          number;
  currentY:          number;
  targetX:           number;
  targetY:           number;
  currentAngle:      number;
  targetAngle:       number;
  anchorDistance:    number;
  currentRadius:     number;
  targetRadius:      number;
  currentThickness:  number;
  targetThickness:   number;
  currentAlpha:      number;
  targetAlpha:       number;
  currentFlashAlpha: number;
  targetFlashAlpha:  number;
  lastBurstAt:       number;
  arcDegrees:        number;
  color:             number;
}

const SHIELD_SMOOTH_TIME_MS = 46;

export class EnergyShieldRenderer {
  private readonly visuals = new Map<string, ShieldVisual>();
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setOwnerPositionProvider(provider: ((ownerId: string) => { x: number; y: number } | null) | null): void {
    this.ownerPositionProvider = provider;
  }

  generateTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_SHIELD_GLOW, 128, [
      [0,    'rgba(255,255,255,0.52)'],
      [0.22, 'rgba(255,255,255,0.2)'],
      [0.54, 'rgba(255,255,255,0.08)'],
      [1,    'rgba(255,255,255,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_SHIELD_PARTICLE, 10, 10, (ctx) => {
      const g = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      g.addColorStop(0,    'rgba(255,255,255,1.0)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.52)');
      g.addColorStop(1,    'rgba(255,255,255,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 10, 10);
    });

    ensureCanvasTexture(textures, TEX_SHIELD_FLARE, 16, 16, (ctx) => {
      const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
      g.addColorStop(0,   'rgba(255,255,255,1.0)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.2)');
      g.addColorStop(1,   'rgba(255,255,255,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 16, 16);
    });
  }

  syncVisuals(shields: SyncedEnergyShield[]): void {
    const activeIds = new Set(shields.map(shield => shield.ownerId));

    for (const [ownerId, visual] of this.visuals) {
      if (activeIds.has(ownerId)) continue;
      visual.halo.destroy();
      visual.outerGlow.destroy();
      visual.glow.destroy();
      visual.core.destroy();
      destroyEmitter(visual.rimEmitter);
      destroyEmitter(visual.flowEmitter);
      destroyEmitter(visual.sparkEmitter);
      this.visuals.delete(ownerId);
    }

    for (const shield of shields) {
      let visual = this.visuals.get(shield.ownerId);
      if (!visual) {
        visual = this.createVisual(shield);
        this.visuals.set(shield.ownerId, visual);
      }
      visual.targetX           = shield.x;
      visual.targetY           = shield.y;
      visual.targetAngle       = shield.angle;
      visual.anchorDistance    = shield.anchorDistance;
      visual.targetRadius      = shield.radius;
      visual.targetThickness   = shield.thickness;
      visual.targetAlpha       = shield.alpha;
      visual.targetFlashAlpha  = shield.flashAlpha;
      visual.arcDegrees        = shield.arcDegrees;
      visual.color             = shield.color;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-delta / SHIELD_SMOOTH_TIME_MS);
    const now  = this.scene.time.now;

    for (const [ownerId, visual] of this.visuals) {
      const ownerPos = this.ownerPositionProvider?.(ownerId) ?? null;
      if (ownerPos) {
        visual.currentX = ownerPos.x + Math.cos(visual.targetAngle) * visual.anchorDistance;
        visual.currentY = ownerPos.y + Math.sin(visual.targetAngle) * visual.anchorDistance;
      } else {
        visual.currentX = visual.targetX;
        visual.currentY = visual.targetY;
      }
      visual.currentAngle      = Phaser.Math.Angle.RotateTo(visual.currentAngle, visual.targetAngle, lerp * Math.PI);
      visual.currentRadius     = Phaser.Math.Linear(visual.currentRadius,     visual.targetRadius,     lerp);
      visual.currentThickness  = Phaser.Math.Linear(visual.currentThickness,  visual.targetThickness,  lerp);
      visual.currentAlpha      = Phaser.Math.Linear(visual.currentAlpha,      visual.targetAlpha,      lerp);
      visual.currentFlashAlpha = Phaser.Math.Linear(visual.currentFlashAlpha, visual.targetFlashAlpha, lerp);
      if (visual.currentFlashAlpha > 0.12 && now - visual.lastBurstAt > 70) {
        this.burstFlashParticles(visual);
        visual.lastBurstAt = now;
      }
      this.redrawVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      visual.halo.destroy();
      visual.outerGlow.destroy();
      visual.glow.destroy();
      visual.core.destroy();
      destroyEmitter(visual.rimEmitter);
      destroyEmitter(visual.flowEmitter);
      destroyEmitter(visual.sparkEmitter);
    }
    this.visuals.clear();
  }

  private createVisual(shield: SyncedEnergyShield): ShieldVisual {
    const lightColor = lightenColor(shield.color);

    const halo = configureAdditiveImage(
      this.scene.add.image(shield.x, shield.y, TEX_SHIELD_GLOW),
      DEPTH.FIRE + 0.20,
      0.24,
      shield.color,
    );
    const outerGlow = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.19);
    const glow      = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.22);
    const core      = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.24);

    // Burst rim particles on hit – player color only.
    const rimEmitter = createEmitter(this.scene, shield.x, shield.y, TEX_SHIELD_PARTICLE, {
      lifespan:  { min: 60,  max: 110 },
      frequency: 18,
      quantity:  2,
      speed:     { min: 0,   max: 4 },
      angle:     { min: 0,   max: 360 },
      scale:     { start: 0.5, end: 0 },
      alpha:     { start: 0.5, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint:      [shield.color, shield.color, lightColor],
      emitting:  false,
    }, DEPTH.FIRE + 0.21);

    // Continuous energy flow – sweeps along the arc to give life.
    const flowEmitter = createEmitter(this.scene, shield.x, shield.y, TEX_SHIELD_FLARE, {
      lifespan:  { min: 260, max: 520 },
      frequency: 55,
      quantity:  1,
      speed:     { min: 1,   max: 5 },
      angle:     { min: 0,   max: 360 },
      scale:     { start: 0.32, end: 0 },
      alpha:     { start: 0.42, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint:      [shield.color, lightColor],
      emitting:  true,
    }, DEPTH.FIRE + 0.23);

    // Burst sparks on hit – player color throughout.
    const sparkEmitter = createEmitter(this.scene, shield.x, shield.y, TEX_SHIELD_PARTICLE, {
      lifespan:  { min: 70,  max: 130 },
      frequency: 16,
      quantity:  3,
      speed:     { min: 14,  max: 38 },
      angle:     { min: 0,   max: 360 },
      scale:     { start: 0.32, end: 0 },
      alpha:     { start: 0.75, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      tint:      [shield.color, lightColor, 0xffffff],
      emitting:  false,
    }, DEPTH.FIRE + 0.25);

    return {
      halo, outerGlow, glow, core,
      rimEmitter, flowEmitter, sparkEmitter,
      currentX:          shield.x,
      currentY:          shield.y,
      targetX:           shield.x,
      targetY:           shield.y,
      currentAngle:      shield.angle,
      targetAngle:       shield.angle,
      anchorDistance:    shield.anchorDistance,
      currentRadius:     shield.radius,
      targetRadius:      shield.radius,
      currentThickness:  shield.thickness,
      targetThickness:   shield.thickness,
      currentAlpha:      shield.alpha,
      targetAlpha:       shield.alpha,
      currentFlashAlpha: shield.flashAlpha,
      targetFlashAlpha:  shield.flashAlpha,
      lastBurstAt:       -Infinity,
      arcDegrees:        shield.arcDegrees,
      color:             shield.color,
    };
  }

  private redrawVisual(visual: ShieldVisual, now: number): void {
    const start  = visual.currentAngle - Phaser.Math.DegToRad(visual.arcDegrees) * 0.5;
    const end    = visual.currentAngle + Phaser.Math.DegToRad(visual.arcDegrees) * 0.5;
    const radius    = Math.max(4, visual.currentRadius);
    const thickness = Math.max(1.5, visual.currentThickness);
    const flash       = Phaser.Math.Clamp(visual.currentFlashAlpha, 0, 1);
    const shieldAlpha = Phaser.Math.Clamp(visual.currentAlpha, 0, 1);
    const pulse    = 0.5 + 0.5 * Math.sin(now * 0.008);
    const pulse2   = 0.5 + 0.5 * Math.sin(now * 0.013 + 2.4);
    const flickerA = 0.5 + 0.5 * Math.sin(now * 0.012 + visual.color * 0.0003);
    const flickerB = 0.5 + 0.5 * Math.sin(now * 0.018 + 1.7);
    const haloScaleX = Math.max(0.82, (radius * 1.8) / 128);
    const haloScaleY = Math.max(0.62, (radius * 1.02) / 128);

    const lightColor = lightenColor(visual.color);

    // --- Flow emitter: sweeps along arc ---
    const flowFrac = ((now * 0.00038) % 1);
    const flowAngle = start + flowFrac * (end - start);
    const flowX = visual.currentX + Math.cos(flowAngle) * radius;
    const flowY = visual.currentY + Math.sin(flowAngle) * radius;
    visual.flowEmitter.setPosition(flowX, flowY);
    visual.flowEmitter.emitting = shieldAlpha > 0.05;

    visual.rimEmitter.emitting   = false;
    visual.sparkEmitter.emitting = false;

    // --- Halo ---
    visual.halo
      .setPosition(visual.currentX, visual.currentY)
      .setRotation(visual.currentAngle)
      .setScale(haloScaleX, haloScaleY)
      .setTint(visual.color)
      .setAlpha(0.22 + shieldAlpha * 0.42 + pulse * 0.08 + flash * 0.24);

    // --- Outer soft bloom (extra wide, very transparent) ---
    visual.outerGlow.clear();
    visual.outerGlow.lineStyle(
      thickness + 5,
      visual.color,
      Math.max(0.05, shieldAlpha * 0.16 + pulse * 0.04 + flash * 0.12),
    );
    visual.outerGlow.beginPath();
    visual.outerGlow.arc(visual.currentX, visual.currentY, radius + 1, start, end, false);
    visual.outerGlow.strokePath();

    // --- Main glow ring ---
    visual.glow.clear();
    visual.glow.lineStyle(
      thickness + 8,
      visual.color,
      Math.max(0.24, shieldAlpha * 0.5 + pulse * 0.08 + flash * 0.28),
    );
    visual.glow.beginPath();
    visual.glow.arc(visual.currentX, visual.currentY, radius + 0.5, start, end, false);
    visual.glow.strokePath();

    // Secondary inner glow using lighter player color
    visual.glow.lineStyle(
      thickness + 3,
      lightColor,
      Math.max(0.10, shieldAlpha * 0.26 + pulse2 * 0.06 + flash * 0.16),
    );
    visual.glow.beginPath();
    visual.glow.arc(visual.currentX, visual.currentY, radius, start, end, false);
    visual.glow.strokePath();

    // --- Core arc – sharp bright line ---
    visual.core.clear();
    visual.core.lineStyle(thickness + 1.2, visual.color, Math.max(0.34, shieldAlpha * 0.74 + pulse * 0.08 + flash * 0.18));
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, radius, start, end, false);
    visual.core.strokePath();

    // --- Energy nodes: 5 hot-spot segments that flicker independently ---
    const nodeCount = 5;
    for (let i = 0; i < nodeCount; i++) {
      const t     = (i + 0.5) / nodeCount;
      const phase = i * 1.3 + visual.color * 0.00008;
      const nodeFlicker = 0.5 + 0.5 * Math.sin(now * (0.009 + i * 0.003) + phase);
      const nodeLen = Phaser.Math.DegToRad(Math.max(8, visual.arcDegrees * 0.12)) * (0.55 + nodeFlicker * 0.45);
      const nodeCenter = start + (end - start) * (t + (nodeFlicker - 0.5) * 0.04);
      const nodeAlpha  = 0.22 + nodeFlicker * 0.38 + flash * 0.22;

      visual.core.lineStyle(Math.max(1.2, thickness * 0.7), 0xffffff, Math.min(0.95, nodeAlpha));
      visual.core.beginPath();
      visual.core.arc(visual.currentX, visual.currentY, radius - 0.1, nodeCenter - nodeLen * 0.5, nodeCenter + nodeLen * 0.5, false);
      visual.core.strokePath();

      // Bright dot at peak flicker
      if (nodeFlicker > 0.62) {
        const nx = visual.currentX + Math.cos(nodeCenter) * radius;
        const ny = visual.currentY + Math.sin(nodeCenter) * radius;
        visual.core.fillStyle(lightColor, (nodeFlicker - 0.62) * 1.6 * (0.35 + flash * 0.3));
        visual.core.fillCircle(nx, ny, Math.max(1, thickness * 0.3));
      }
    }

    // --- Dual scan lines sweeping in opposite directions ---
    const scanLen = Phaser.Math.DegToRad(10 + pulse * 8);

    const scan1 = start + (((now * 0.00055) % 1) * (end - start));
    visual.core.lineStyle(Math.max(1.8, thickness * 0.92), 0xffffff, 0.30 + flash * 0.32);
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, radius + 0.3, scan1 - scanLen * 0.5, scan1 + scanLen * 0.5, false);
    visual.core.strokePath();

    const scan2 = end - (((now * 0.00038) % 1) * (end - start));
    visual.core.lineStyle(Math.max(1.4, thickness * 0.72), lightColor, 0.20 + pulse2 * 0.14 + flash * 0.18);
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, radius - 0.4, scan2 - scanLen * 0.4, scan2 + scanLen * 0.4, false);
    visual.core.strokePath();

    // --- Edge caps with corona rings ---
    const capRadius = Math.max(1.8, thickness * 0.5 + flash * 1.0);
    const capAlpha  = Math.max(0.28, shieldAlpha * 0.5 + flash * 0.3);
    const startX = visual.currentX + Math.cos(start) * radius;
    const startY = visual.currentY + Math.sin(start) * radius;
    const endX   = visual.currentX + Math.cos(end)   * radius;
    const endY   = visual.currentY + Math.sin(end)   * radius;

    // Soft corona halo behind cap
    visual.core.fillStyle(lightColor, capAlpha * 0.45);
    visual.core.fillCircle(startX, startY, capRadius * 2.4);
    visual.core.fillCircle(endX,   endY,   capRadius * 2.4);

    // Corona ring outline
    visual.core.lineStyle(1.4, lightColor, capAlpha * 0.55);
    visual.core.strokeCircle(startX, startY, capRadius * 1.9);
    visual.core.strokeCircle(endX,   endY,   capRadius * 1.9);

    // Bright white core dot
    visual.core.fillStyle(0xffffff, capAlpha);
    visual.core.fillCircle(startX, startY, capRadius);
    visual.core.fillCircle(endX,   endY,   capRadius);

    // --- Inner ring – depth cue ---
    const innerRadius = Math.max(2, radius - thickness * 0.95);
    visual.core.lineStyle(1, visual.color, Math.max(0.15, shieldAlpha * 0.4 + flickerA * 0.08));
    visual.core.beginPath();
    visual.core.arc(visual.currentX, visual.currentY, innerRadius, start + 0.08, end - 0.08, false);
    visual.core.strokePath();
  }

  private burstFlashParticles(visual: ShieldVisual): void {
    const midAngle = visual.currentAngle;
    const burstX = visual.currentX + Math.cos(midAngle) * visual.currentRadius;
    const burstY = visual.currentY + Math.sin(midAngle) * visual.currentRadius;
    visual.rimEmitter.setParticleSpeed(0, 8 + visual.currentFlashAlpha * 12);
    visual.sparkEmitter.setParticleSpeed(12, 24 + visual.currentFlashAlpha * 24);
    visual.rimEmitter.setPosition(burstX, burstY);
    visual.rimEmitter.explode(6, 0, 0);
    visual.sparkEmitter.setPosition(burstX, burstY);
    visual.sparkEmitter.explode(10, 0, 0);
  }
}
