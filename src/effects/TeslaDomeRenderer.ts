import Phaser from 'phaser';
import { DEPTH } from '../config';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome, TeslaDomeTargetType } from '../types';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  edgeZone,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  setCircleEmitZone,
} from './EffectUtils';

const TEX_DOME_CORE = '__tesla_dome_core';
const TEX_DOME_FIELD = '__tesla_dome_field';
const TEX_DOME_RING = '__tesla_dome_ring';
const TEX_DOME_MEMBRANE = '__tesla_dome_membrane';
const TEX_DOME_SPARK = '__tesla_dome_spark';
const TEX_DOME_WISP = '__tesla_dome_wisp';

interface TeslaDomeVisual {
  ownerColor: number;
  coreGlow: Phaser.GameObjects.Image;
  fieldGlow: Phaser.GameObjects.Image;
  membrane: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  fieldFilaments: Phaser.GameObjects.Graphics;
  boltGlow: Phaser.GameObjects.Graphics;
  boltCore: Phaser.GameObjects.Graphics;
  coreEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  fieldEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  rimEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  wispEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  impactEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  idleEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  boltEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  currentRadius: number;
  targetRadius: number;
  currentAlpha: number;
  targetAlpha: number;
  targets: TeslaBoltTargetState[];
  lastIdleBurstAt: number;
}

interface TeslaBoltTargetState {
  type: TeslaDomeTargetType;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  lastPulseAt: number;
  lastSurgeAt: number;
}

interface TargetImpactProfile {
  burstCount: number;
  burstSpeedMin: number;
  burstSpeedMax: number;
  haloAlpha: number;
}

const DOME_SMOOTH_TIME_MS = 52;
const TARGET_SMOOTH_TIME_MS = 38;
const IDLE_BURST_INTERVAL_MS = 64;
const ACTIVE_PULSE_INTERVAL_MS = 92;
const ACTIVE_SURGE_INTERVAL_MS = 70;

export class TeslaDomeRenderer {
  private readonly visuals = new Map<string, TeslaDomeVisual>();
  private readonly configs = new Map<string, WeaponConfig & { fire: TeslaDomeWeaponFireConfig }>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_DOME_CORE, 160, [
      [0, 'rgba(255,255,255,0.98)'],
      [0.16, 'rgba(219,250,255,0.9)'],
      [0.38, 'rgba(134,224,255,0.42)'],
      [0.72, 'rgba(70,148,255,0.08)'],
      [1, 'rgba(16,32,60,0.0)'],
    ]);

    fillRadialGradientTexture(textures, TEX_DOME_FIELD, 256, [
      [0, 'rgba(255,255,255,0.0)'],
      [0.18, 'rgba(132,224,255,0.08)'],
      [0.52, 'rgba(109,196,255,0.22)'],
      [0.82, 'rgba(60,132,238,0.18)'],
      [1, 'rgba(10,18,40,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_DOME_RING, 320, 320, (ctx) => {
      const center = 160;
      ctx.clearRect(0, 0, 320, 320);

      ctx.strokeStyle = 'rgba(226,250,255,0.94)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(center, center, 142, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(142,228,255,0.42)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.arc(center, center, 134, Math.PI * 0.1, Math.PI * 0.78);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(center, center, 134, Math.PI * 1.06, Math.PI * 1.76);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(center, center, 120, Math.PI * 0.54, Math.PI * 1.42);
      ctx.stroke();
    });

    ensureCanvasTexture(textures, TEX_DOME_MEMBRANE, 360, 360, (ctx) => {
      const center = 180;
      ctx.clearRect(0, 0, 360, 360);

      const shell = ctx.createRadialGradient(center, center, 82, center, center, 178);
      shell.addColorStop(0, 'rgba(255,255,255,0.0)');
      shell.addColorStop(0.52, 'rgba(146,228,255,0.0)');
      shell.addColorStop(0.72, 'rgba(112,210,255,0.16)');
      shell.addColorStop(0.86, 'rgba(96,168,255,0.22)');
      shell.addColorStop(1, 'rgba(32,56,114,0.0)');
      ctx.fillStyle = shell;
      ctx.fillRect(0, 0, 360, 360);

      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 1.4;
      for (let index = 0; index < 5; index++) {
        const radius = 104 + index * 12;
        ctx.beginPath();
        ctx.arc(center, center, radius, Math.PI * (0.16 + index * 0.11), Math.PI * (0.84 + index * 0.16));
        ctx.stroke();
      }
    });

    fillRadialGradientTexture(textures, TEX_DOME_SPARK, 14, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.22, 'rgba(250,254,255,0.96)'],
      [0.64, 'rgba(140,224,255,0.4)'],
      [1, 'rgba(80,160,255,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_DOME_WISP, 72, 22, (ctx) => {
      ctx.clearRect(0, 0, 72, 22);
      const gradient = ctx.createLinearGradient(4, 11, 68, 11);
      gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
      gradient.addColorStop(0.16, 'rgba(255,255,255,0.16)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.58)');
      gradient.addColorStop(0.78, 'rgba(255,255,255,0.24)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(4, 11);
      ctx.quadraticCurveTo(18, 4, 40, 6);
      ctx.quadraticCurveTo(60, 8, 68, 11);
      ctx.quadraticCurveTo(61, 14, 42, 16);
      ctx.quadraticCurveTo(18, 18, 4, 11);
      ctx.closePath();
      ctx.fill();
    });
  }

  setWeaponConfig(ownerId: string, config: WeaponConfig & { fire: TeslaDomeWeaponFireConfig }): void {
    this.configs.set(ownerId, config);
  }

  clearWeaponConfig(ownerId: string): void {
    this.configs.delete(ownerId);
  }

  syncVisuals(domes: SyncedTeslaDome[]): void {
    const activeIds = new Set(domes.map(dome => dome.ownerId));

    for (const [ownerId, visual] of this.visuals) {
      if (activeIds.has(ownerId)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(ownerId);
    }

    for (const dome of domes) {
      let visual = this.visuals.get(dome.ownerId);
      if (!visual) {
        visual = this.createVisual(dome, this.configs.get(dome.ownerId));
        this.visuals.set(dome.ownerId, visual);
      }

      visual.targetX = dome.x;
      visual.targetY = dome.y;
      visual.targetRadius = dome.radius;
      visual.targetAlpha = dome.alpha;
      visual.ownerColor = dome.color;

      const nextTargets: TeslaBoltTargetState[] = dome.targets.map((target, index) => {
        const previous = visual.targets[index];
        return {
          type: target.type,
          currentX: previous?.currentX ?? visual.currentX,
          currentY: previous?.currentY ?? visual.currentY,
          targetX: target.x,
          targetY: target.y,
          lastPulseAt: previous?.type === target.type ? previous.lastPulseAt : 0,
          lastSurgeAt: previous?.type === target.type ? previous.lastSurgeAt : 0,
        };
      });
      visual.targets = nextTargets;
    }
  }

  update(delta: number): void {
    const domeLerp = 1 - Math.exp(-delta / DOME_SMOOTH_TIME_MS);
    const targetLerp = 1 - Math.exp(-delta / TARGET_SMOOTH_TIME_MS);

    for (const [ownerId, visual] of this.visuals) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, domeLerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, domeLerp);
      visual.currentRadius = Phaser.Math.Linear(visual.currentRadius, visual.targetRadius, domeLerp);
      visual.currentAlpha = Phaser.Math.Linear(visual.currentAlpha, visual.targetAlpha, domeLerp);

      for (const target of visual.targets) {
        target.currentX = Phaser.Math.Linear(target.currentX, target.targetX, targetLerp);
        target.currentY = Phaser.Math.Linear(target.currentY, target.targetY, targetLerp);
      }

      this.updateVisual(ownerId, visual, this.configs.get(ownerId));
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(
    dome: SyncedTeslaDome,
    config?: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
  ): TeslaDomeVisual {
    const fire = this.getFireConfig(config);
    const coreColor = this.resolveHotColor(dome.color, fire.visualWhiteness);
    const accentColor = this.resolveAccentColor(dome.color, fire.visualWhiteness);
    const deepColor = mixColors(dome.color, 0x081224, 0.18);

    const coreGlow = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_CORE),
      DEPTH.FIRE + 0.1,
      0.84,
      coreColor,
    );
    const fieldGlow = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_FIELD),
      DEPTH.FIRE + 0.03,
      0.76,
      accentColor,
    );
    const membrane = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_MEMBRANE),
      DEPTH.FIRE + 0.05,
      0.74,
      mixColors(accentColor, deepColor, 0.18),
    );
    const ring = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_RING),
      DEPTH.FIRE + 0.14,
      0.82,
      mixColors(accentColor, 0xffffff, 0.22),
    );

    const fieldFilaments = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.16).setBlendMode(Phaser.BlendModes.ADD);
    const boltGlow = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.2).setBlendMode(Phaser.BlendModes.ADD);
    const boltCore = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.22).setBlendMode(Phaser.BlendModes.ADD);

    const coreEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 180, max: 320 },
      frequency: fire.visualCoreParticleFrequency,
      quantity: 1,
      speedX: { min: -12, max: 12 },
      speedY: { min: -12, max: 12 },
      scale: { start: 0.52, end: 0.03 },
      alpha: { start: 0.24, end: 0 },
      tint: [0xffffff, coreColor, accentColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE + 0.17);

    const fieldEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 320, max: 560 },
      frequency: fire.visualFieldParticleFrequency,
      quantity: 4,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.56, end: 0.05 },
      alpha: { start: 0.24, end: 0 },
      tint: [accentColor, coreColor, dome.color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE + 0.09);

    const rimEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 340, max: 560 },
      frequency: fire.visualRimParticleFrequency,
      quantity: 2,
      speed: { min: 8, max: 18 },
      scale: { start: 0.42, end: 0.05 },
      alpha: { start: 0.28, end: 0 },
      tint: [0xffffff, accentColor, dome.color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE + 0.18);
    rimEmitter.addEmitZone(edgeZone(Math.max(dome.radius * 0.92, 8), 24));

    const wispEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_WISP, {
      lifespan: { min: 240, max: 420 },
      frequency: Math.max(12, Math.round(fire.visualFieldParticleFrequency * 1.15)),
      quantity: 1,
      speedX: { min: -10, max: 10 },
      speedY: { min: -10, max: 10 },
      scaleX: { start: 0.42, end: 0.12 },
      scaleY: { start: 0.18, end: 0.05 },
      rotate: { min: -10, max: 10 },
      alpha: { start: 0.09, end: 0 },
      tint: [mixColors(accentColor, 0xffffff, 0.16), accentColor, dome.color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.FIRE + 0.04);

    const impactEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 90, max: 180 },
      frequency: -1,
      quantity: 1,
      speed: { min: 70, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.24, end: 0 },
      alpha: { start: 0.96, end: 0 },
      tint: [0xffffff, coreColor, accentColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.FIRE + 0.24);

    const idleEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 220, max: 380 },
      frequency: -1,
      quantity: 1,
      speed: { min: 10, max: 22 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.42, end: 0.04 },
      alpha: { start: 0.09, end: 0 },
      tint: [0xffffff, accentColor, dome.color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.FIRE + 0.23);

    const boltEmitter = createEmitter(this.scene, dome.x, dome.y, TEX_DOME_SPARK, {
      lifespan: { min: 160, max: 280 },
      frequency: -1,
      quantity: 1,
      speed: { min: 54, max: 132 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.38, end: 0.05 },
      alpha: { start: 0.28, end: 0 },
      tint: [0xffffff, coreColor, accentColor],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.FIRE + 0.23);

    return {
      ownerColor: dome.color,
      coreGlow,
      fieldGlow,
      membrane,
      ring,
      fieldFilaments,
      boltGlow,
      boltCore,
      coreEmitter,
      fieldEmitter,
      rimEmitter,
      wispEmitter,
      impactEmitter,
      idleEmitter,
      boltEmitter,
      currentX: dome.x,
      currentY: dome.y,
      targetX: dome.x,
      targetY: dome.y,
      currentRadius: dome.radius,
      targetRadius: dome.radius,
      currentAlpha: dome.alpha,
      targetAlpha: dome.alpha,
      targets: dome.targets.map(target => ({
        type: target.type,
        currentX: target.x,
        currentY: target.y,
        targetX: target.x,
        targetY: target.y,
        lastPulseAt: 0,
        lastSurgeAt: 0,
      })),
      lastIdleBurstAt: 0,
    };
  }

  private updateVisual(
    ownerId: string,
    visual: TeslaDomeVisual,
    config?: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
  ): void {
    const time = this.scene.time.now;
    const fire = this.getFireConfig(config);
    const alphaScale = Phaser.Math.Clamp(visual.currentAlpha, 0, 1);
    const ownerSeed = this.computeOwnerSeed(ownerId);
    const baseScale = visual.currentRadius / 128;
    const pulse = Math.sin(time * fire.visualPulseSpeed + ownerSeed * 0.17);
    const secondaryPulse = Math.cos(time * (fire.visualPulseSpeed * 0.54) + ownerSeed * 0.11);
    const ringPulse = 1 + pulse * 0.01;
    const ownerColor = this.resolveOwnerColor(visual, config);
    const coreColor = this.resolveHotColor(ownerColor, fire.visualWhiteness);
    const accentColor = this.resolveAccentColor(ownerColor, fire.visualWhiteness);
    const membraneColor = mixColors(accentColor, 0x73d9ff, 0.2 + fire.visualWhiteness * 0.18);

    visual.coreGlow.setPosition(visual.currentX, visual.currentY);
    visual.coreGlow.setScale(Math.max(baseScale * 1.12, 0.68) * (1.015 + pulse * 0.015));
    visual.coreGlow.setAlpha((fire.visualFieldAlpha * 1.45) * alphaScale);
    visual.coreGlow.setTint(coreColor);

    visual.fieldGlow.setPosition(visual.currentX, visual.currentY);
    visual.fieldGlow.setScale(Math.max(visual.currentRadius / 128, 0.74) * (1.01 + secondaryPulse * 0.018));
    visual.fieldGlow.setAlpha((fire.visualFieldAlpha * 0.9) * alphaScale);
    visual.fieldGlow.setTint(accentColor);

    visual.membrane.setPosition(visual.currentX, visual.currentY);
    visual.membrane.setScale(Math.max(visual.currentRadius / 178, 0.64) * ringPulse);
    visual.membrane.setRotation(Math.sin(time * 0.00022 + ownerSeed * 0.13) * 0.014);
    visual.membrane.setAlpha((fire.visualFieldAlpha * 0.88) * alphaScale);
    visual.membrane.setTint(membraneColor);

    visual.ring.setPosition(visual.currentX, visual.currentY);
    visual.ring.setScale(Math.max(visual.currentRadius / 142, 0.72) * (1.004 + pulse * 0.01));
    visual.ring.setRotation(Math.sin(time * 0.00018 + ownerSeed * 0.07) * 0.01);
    visual.ring.setAlpha((fire.visualIndicatorAlpha * 1.55) * (0.96 + secondaryPulse * 0.03) * alphaScale);
    visual.ring.setTint(mixColors(accentColor, 0xffffff, 0.22));

    this.updateEmitters(visual, fire, accentColor, coreColor, alphaScale, pulse, secondaryPulse);

    visual.fieldFilaments.clear();
    visual.boltGlow.clear();
    visual.boltCore.clear();

    this.drawFieldFilaments(visual, ownerSeed, fire, accentColor, coreColor, alphaScale, visual.targets.length > 0 ? 1 : 0.28);

    if (visual.targets.length === 0) {
      this.drawIdleArcs(visual, ownerSeed, fire, accentColor, coreColor);
      return;
    }

    for (let index = 0; index < visual.targets.length; index++) {
      const target = visual.targets[index];
      const intensity = this.getTargetIntensity(target.type);
      this.drawBolt(
        visual,
        visual.currentX,
        visual.currentY,
        target.currentX,
        target.currentY,
        ownerSeed + index * 37,
        fire.visualBoltThicknessMin,
        fire.visualBoltThicknessMax,
        fire.visualJitter * intensity,
        Phaser.Math.Clamp(fire.visualBranchChance * (0.72 + intensity * 0.16), 0, 0.72),
        (0.28 + intensity * 0.08) * alphaScale,
        accentColor,
        coreColor,
      );
      this.maybeEmitBoltSurge(visual, target, accentColor, coreColor, alphaScale, intensity);
      this.maybePulseTargetImpact(visual, target, fire, accentColor, coreColor, alphaScale, intensity);
    }
  }

  private updateEmitters(
    visual: TeslaDomeVisual,
    fire: TeslaDomeWeaponFireConfig,
    accentColor: number,
    coreColor: number,
    alphaScale: number,
    pulse: number,
    secondaryPulse: number,
  ): void {
    const radius = Math.max(visual.currentRadius, 8);

    visual.coreEmitter.setPosition(visual.currentX, visual.currentY);
    setCircleEmitZone(visual.coreEmitter, radius * 0.16, 5, true);
    visual.coreEmitter.setParticleScale(Math.max(radius / 340, 0.2), 0.03);
    visual.coreEmitter.setAlpha(Phaser.Math.Clamp(alphaScale * (0.22 + pulse * 0.02), 0, 1));
    visual.coreEmitter.setParticleTint([0xffffff, coreColor, accentColor]);

    visual.fieldEmitter.setPosition(visual.currentX, visual.currentY);
    setCircleEmitZone(visual.fieldEmitter, radius * 0.94, 16, true);
    visual.fieldEmitter.setParticleScale(Math.max(radius / 260, 0.28), 0.05);
    visual.fieldEmitter.setAlpha(Phaser.Math.Clamp(alphaScale * (0.26 + secondaryPulse * 0.02), 0, 1));
    visual.fieldEmitter.setParticleTint([accentColor, coreColor, mixColors(accentColor, 0x6fdcff, 0.18)]);

    visual.rimEmitter.setPosition(visual.currentX, visual.currentY);
    const rimZoneRadius = radius * 0.992;
    if (visual.rimEmitter.emitZones.length > 0) {
      // Radius des bestehenden Kreises aktualisieren ohne den Zyklus-Counter zurückzusetzen.
      // clearEmitZones() + addEmitZone() würde den EdgeZone-Zähler auf Punkt 0 (= rechts, Winkel 0°)
      // zurücksetzen, sodass alle Partikel am rechten Rand clustern.
      (visual.rimEmitter.emitZones[0] as any).source.radius = rimZoneRadius;
    } else {
      visual.rimEmitter.addEmitZone(edgeZone(rimZoneRadius, Phaser.Math.Clamp(Math.round(radius / 2.2), 74, 120)));
    }
    visual.rimEmitter.setParticleScale(Math.max(radius / 260, 0.28), 0.05);
    visual.rimEmitter.setAlpha(Phaser.Math.Clamp(alphaScale * (0.28 + pulse * 0.02), 0, 1));
    visual.rimEmitter.setParticleTint([0xffffff, accentColor, coreColor]);

    visual.wispEmitter.setPosition(visual.currentX, visual.currentY);
    setCircleEmitZone(visual.wispEmitter, radius * 0.82, 8, true);
    visual.wispEmitter.setParticleScale(Math.max(radius / 330, 0.2), 0.05);
    visual.wispEmitter.setAlpha(Phaser.Math.Clamp(alphaScale * 0.08, 0, 1));
    visual.wispEmitter.setParticleTint([mixColors(accentColor, 0xffffff, 0.16), accentColor, mixColors(accentColor, 0x7bdcff, 0.1)]);
  }

  private drawFieldFilaments(
    visual: TeslaDomeVisual,
    ownerSeed: number,
    fire: TeslaDomeWeaponFireConfig,
    accentColor: number,
    coreColor: number,
    alphaScale: number,
    activity: number,
  ): void {
    const time = this.scene.time.now;
    const radius = Math.max(visual.currentRadius, 10);
    const filamentCount = Phaser.Math.Clamp(Math.round(radius / 52), 3, 5);

    for (let index = 0; index < filamentCount; index++) {
      const baseAngle = (Math.PI * 2 * index) / filamentCount + time * 0.00042 + ownerSeed * 0.03;
      const arcSpan = Math.PI * (0.12 + ((Math.sin(time * 0.0013 + index * 1.4 + ownerSeed) + 1) * 0.5) * 0.035);
      const radiusMul = 0.8 + ((Math.cos(time * 0.0011 + index * 0.91 + ownerSeed * 0.2) + 1) * 0.5) * 0.08;
      const arcRadius = radius * radiusMul;
      const outerAlpha = alphaScale * fire.visualFieldAlpha * (0.018 + activity * 0.04);
      const innerAlpha = alphaScale * fire.visualFieldAlpha * (0.05 + activity * 0.08);

      visual.fieldFilaments.lineStyle(2.6, accentColor, outerAlpha);
      visual.fieldFilaments.beginPath();
      visual.fieldFilaments.arc(visual.currentX, visual.currentY, arcRadius, baseAngle - arcSpan, baseAngle + arcSpan, false);
      visual.fieldFilaments.strokePath();

      visual.fieldFilaments.lineStyle(1.1, index % 3 === 0 ? coreColor : accentColor, innerAlpha);
      visual.fieldFilaments.beginPath();
      visual.fieldFilaments.arc(visual.currentX, visual.currentY, arcRadius, baseAngle - arcSpan * 0.76, baseAngle + arcSpan * 0.76, false);
      visual.fieldFilaments.strokePath();
    }
  }

  private drawIdleArcs(
    visual: TeslaDomeVisual,
    ownerSeed: number,
    fire: TeslaDomeWeaponFireConfig,
    accentColor: number,
    coreColor: number,
  ): void {
    const time = this.scene.time.now;
    if (time - visual.lastIdleBurstAt < IDLE_BURST_INTERVAL_MS) return;

    const sampleBursts = 4;
    const particlesPerBurst = Phaser.Math.Clamp(Math.round(visual.currentRadius / 68), 2, 4);
    visual.idleEmitter.setParticleTint([mixColors(accentColor, 0xffffff, 0.14), accentColor, coreColor]);
    visual.idleEmitter.setParticleSpeed(6, 16);

    for (let index = 0; index < sampleBursts; index++) {
      const angle = ownerSeed * 0.013 + time * fire.visualPulseSpeed * 0.12 + index * ((Math.PI * 2) / sampleBursts) + Math.sin(time * 0.0012 + index) * 0.16;
      const distance = visual.currentRadius * (0.18 + 0.22 * index);
      const offsetX = Math.cos(angle) * distance;
      const offsetY = Math.sin(angle) * distance;
      visual.idleEmitter.setPosition(visual.currentX + offsetX, visual.currentY + offsetY);
      visual.idleEmitter.explode(particlesPerBurst);
    }

    visual.lastIdleBurstAt = time;
  }

  private maybePulseTargetImpact(
    visual: TeslaDomeVisual,
    target: TeslaBoltTargetState,
    fire: TeslaDomeWeaponFireConfig,
    accentColor: number,
    coreColor: number,
    alphaScale: number,
    intensity: number,
  ): void {
    const time = this.scene.time.now;
    if (time - target.lastPulseAt < ACTIVE_PULSE_INTERVAL_MS) return;

    const profile = this.getImpactProfile(target.type, fire.visualImpactBurstScale * intensity);
    const radius = Math.max(visual.currentRadius * 0.06 * intensity, 7);
    const halo = this.scene.add.circle(target.currentX, target.currentY, radius, accentColor, profile.haloAlpha * alphaScale);
    halo.setDepth(DEPTH.FIRE + 0.21);
    halo.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: halo,
      alpha: 0,
      scaleX: 1.7 + intensity * 0.18,
      scaleY: 1.7 + intensity * 0.18,
      duration: 120,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });

    visual.impactEmitter.setPosition(target.currentX, target.currentY);
    visual.impactEmitter.setParticleTint([0xffffff, coreColor, accentColor]);
    visual.impactEmitter.setParticleSpeed(profile.burstSpeedMin, profile.burstSpeedMax);
    visual.impactEmitter.explode(profile.burstCount);
    target.lastPulseAt = time;
  }

  private maybeEmitBoltSurge(
    visual: TeslaDomeVisual,
    target: TeslaBoltTargetState,
    accentColor: number,
    coreColor: number,
    alphaScale: number,
    intensity: number,
  ): void {
    const time = this.scene.time.now;
    if (time - target.lastSurgeAt < ACTIVE_SURGE_INTERVAL_MS) return;

    const angle = Phaser.Math.Angle.Between(visual.currentX, visual.currentY, target.currentX, target.currentY);
    const angleDeg = Phaser.Math.RadToDeg(angle);
    const distance = Phaser.Math.Distance.Between(visual.currentX, visual.currentY, target.currentX, target.currentY);
    const samples = Phaser.Math.Clamp(Math.round(distance / 22), 6, 14);
    const burstCount = Math.max(2, Math.round(2 + intensity * 2));
    const normalX = distance > 0.001 ? -(target.currentY - visual.currentY) / distance : 0;
    const normalY = distance > 0.001 ? (target.currentX - visual.currentX) / distance : 0;
    const spread = Phaser.Math.Clamp(distance * 0.05, 4, 12);

    visual.boltEmitter.setAngle(angleDeg);
    visual.boltEmitter.setParticleTint([mixColors(accentColor, 0xffffff, 0.14), coreColor, accentColor]);
    visual.boltEmitter.setParticleSpeed(40 + intensity * 18, 96 + intensity * 30);
    visual.boltEmitter.setAlpha(Phaser.Math.Clamp(alphaScale * 0.3, 0, 1));

    for (let index = 0; index < samples; index++) {
      const t = (index + 1) / (samples + 1);
      const wave = Math.sin(time * 0.014 + index * 1.37 + angle) * spread;
      const jitter = Math.cos(time * 0.011 + index * 0.81 + angle * 0.7) * (spread * 0.45);
      const px = Phaser.Math.Linear(visual.currentX, target.currentX, t) + normalX * (wave + jitter);
      const py = Phaser.Math.Linear(visual.currentY, target.currentY, t) + normalY * (wave + jitter);
      visual.boltEmitter.setPosition(px, py);
      visual.boltEmitter.explode(burstCount, 0, 0);
    }

    target.lastSurgeAt = time;
  }

  private drawBolt(
    visual: TeslaDomeVisual,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    seed: number,
    minThickness: number,
    maxThickness: number,
    jitter: number,
    branchChance: number,
    alphaScale: number,
    glowColor: number,
    coreColor: number,
  ): void {
    const points = this.buildBoltPoints(startX, startY, endX, endY, jitter, seed);
    const distance = Phaser.Math.Distance.Between(startX, startY, endX, endY);
    const mainWidth = Phaser.Math.Clamp(minThickness + distance / 240, minThickness, maxThickness);

    visual.boltGlow.lineStyle(mainWidth + 2.4, glowColor, alphaScale * 0.12);
    visual.boltGlow.beginPath();
    visual.boltGlow.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      visual.boltGlow.lineTo(points[index].x, points[index].y);
    }
    visual.boltGlow.strokePath();

    visual.boltGlow.lineStyle(mainWidth + 0.9, mixColors(glowColor, 0xffffff, 0.3), alphaScale * 0.22);
    visual.boltGlow.beginPath();
    visual.boltGlow.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      visual.boltGlow.lineTo(points[index].x, points[index].y);
    }
    visual.boltGlow.strokePath();

    visual.boltCore.lineStyle(Math.max(0.8, mainWidth * 0.82), coreColor, Math.min(1, alphaScale + 0.38));
    visual.boltCore.beginPath();
    visual.boltCore.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      visual.boltCore.lineTo(points[index].x, points[index].y);
    }
    visual.boltCore.strokePath();

    const branchValue = (Math.sin(this.scene.time.now * 0.007 + seed * 0.73) + 1) * 0.5;
    if (branchValue < 1 - branchChance || points.length < 4) return;

    const pivot = points[Math.floor(points.length * 0.56)];
    const branchAngle = Phaser.Math.Angle.Between(startX, startY, endX, endY) + Math.sin(this.scene.time.now * 0.005 + seed * 1.11) * 1.28;
    const branchLength = distance * (0.2 + branchValue * 0.16);
    const bx = pivot.x + Math.cos(branchAngle) * branchLength;
    const by = pivot.y + Math.sin(branchAngle) * branchLength;
    const branchPoints = this.buildBoltPoints(pivot.x, pivot.y, bx, by, jitter * 0.72, seed + 97);

    visual.boltGlow.lineStyle(Math.max(0.8, mainWidth - 0.4) + 1.4, glowColor, alphaScale * 0.1);
    visual.boltGlow.beginPath();
    visual.boltGlow.moveTo(branchPoints[0].x, branchPoints[0].y);
    for (let index = 1; index < branchPoints.length; index++) {
      visual.boltGlow.lineTo(branchPoints[index].x, branchPoints[index].y);
    }
    visual.boltGlow.strokePath();

    visual.boltCore.lineStyle(Math.max(0.7, (mainWidth - 1.25) * 0.82), coreColor, alphaScale * 0.82);
    visual.boltCore.beginPath();
    visual.boltCore.moveTo(branchPoints[0].x, branchPoints[0].y);
    for (let index = 1; index < branchPoints.length; index++) {
      visual.boltCore.lineTo(branchPoints[index].x, branchPoints[index].y);
    }
    visual.boltCore.strokePath();
  }

  private buildBoltPoints(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    jitter: number,
    seed: number,
  ): Phaser.Math.Vector2[] {
    const distance = Phaser.Math.Distance.Between(startX, startY, endX, endY);
    const segments = Math.max(5, Math.ceil(distance / 24));
    const normalX = distance > 0.001 ? -(endY - startY) / distance : 0;
    const normalY = distance > 0.001 ? (endX - startX) / distance : 0;
    const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(startX, startY)];
    const time = this.scene.time.now;

    for (let index = 1; index < segments; index++) {
      const t = index / segments;
      const baseX = Phaser.Math.Linear(startX, endX, t);
      const baseY = Phaser.Math.Linear(startY, endY, t);
      const centerBias = 1 - Math.abs(t - 0.5) * 1.7;
      const wave = Math.sin(time * 0.012 + seed * 0.41 + index * 1.91 + t * 10.6);
      const wobble = Math.cos(time * 0.008 + seed * 0.19 + index * 1.07);
      const snap = Math.sin(time * 0.019 + seed * 0.09 + t * 22.4);
      const offset = (wave * 0.62 + wobble * 0.24 + snap * 0.14) * jitter * Math.max(0.18, centerBias);
      points.push(new Phaser.Math.Vector2(baseX + normalX * offset, baseY + normalY * offset));
    }

    points.push(new Phaser.Math.Vector2(endX, endY));
    return points;
  }

  private getImpactProfile(type: TeslaDomeTargetType, scale: number): TargetImpactProfile {
    const strength = Math.max(0.7, scale);
    switch (type) {
      case 'players':
        return {
          burstCount: Math.round(10 * strength),
          burstSpeedMin: 90,
          burstSpeedMax: 250,
          haloAlpha: 0.34,
        };
      case 'turrets':
        return {
          burstCount: Math.round(8 * strength),
          burstSpeedMin: 80,
          burstSpeedMax: 210,
          haloAlpha: 0.28,
        };
      case 'train':
        return {
          burstCount: Math.round(11 * strength),
          burstSpeedMin: 95,
          burstSpeedMax: 260,
          haloAlpha: 0.32,
        };
      case 'rocks':
      default:
        return {
          burstCount: Math.round(5 * strength),
          burstSpeedMin: 60,
          burstSpeedMax: 150,
          haloAlpha: 0.18,
        };
    }
  }

  private getTargetIntensity(type: TeslaDomeTargetType): number {
    switch (type) {
      case 'players':
        return 1.18;
      case 'turrets':
        return 1.02;
      case 'train':
        return 1.14;
      case 'rocks':
      default:
        return 0.82;
    }
  }

  private destroyVisual(visual: TeslaDomeVisual): void {
    destroyEmitter(visual.coreEmitter);
    destroyEmitter(visual.fieldEmitter);
    destroyEmitter(visual.rimEmitter);
    destroyEmitter(visual.wispEmitter);
    destroyEmitter(visual.impactEmitter);
    destroyEmitter(visual.idleEmitter);
    destroyEmitter(visual.boltEmitter);
    visual.coreGlow.destroy();
    visual.fieldGlow.destroy();
    visual.membrane.destroy();
    visual.ring.destroy();
    visual.fieldFilaments.destroy();
    visual.boltGlow.destroy();
    visual.boltCore.destroy();
  }

  private getFireConfig(config?: WeaponConfig & { fire: TeslaDomeWeaponFireConfig }): TeslaDomeWeaponFireConfig {
    const fallbackConfig = WEAPON_CONFIGS.TESLA_DOME as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
    return (config ?? fallbackConfig).fire;
  }

  private resolveOwnerColor(
    visual: TeslaDomeVisual,
    config?: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
  ): number {
    const domeConfig = config ?? (WEAPON_CONFIGS.TESLA_DOME as WeaponConfig & { fire: TeslaDomeWeaponFireConfig });
    return domeConfig.projectileColor ?? visual.ownerColor;
  }

  private resolveAccentColor(baseColor: number, whiteness: number): number {
    return mixColors(mixColors(baseColor, 0x6fdcff, 0.22), 0xffffff, 0.16 + whiteness * 0.24);
  }

  private resolveHotColor(baseColor: number, whiteness: number): number {
    return mixColors(baseColor, 0xffffff, 0.54 + whiteness * 0.3);
  }

  private computeOwnerSeed(ownerId: string): number {
    let hash = 0;
    for (let index = 0; index < ownerId.length; index++) {
      hash = ((hash << 5) - hash) + ownerId.charCodeAt(index);
      hash |= 0;
    }
    return Math.abs(hash) + 1;
  }
}
