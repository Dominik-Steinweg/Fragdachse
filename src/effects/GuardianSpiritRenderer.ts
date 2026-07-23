import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { GuardianSpiritPhase, SyncedGuardianSpirit } from '../types';
import {
  configureAdditiveImage,
  createEmitter,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
} from './EffectUtils';
import type { LightingSystem } from './LightingSystem';

const TEX_GUARDIAN_HALO = '__guardian_spirit_halo';
const TEX_GUARDIAN_CORE = '__guardian_spirit_core';
const TEX_GUARDIAN_PARTICLE = '__guardian_spirit_particle';
const SPIRIT_DEPTH = DEPTH.PROJECTILES + 0.35;
const SMOOTH_TIME_MS = 42;

interface GuardianSpiritVisual {
  halo: Phaser.GameObjects.Image;
  core: Phaser.GameObjects.Image;
  wingLeft: Phaser.GameObjects.Image;
  wingRight: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  motes: Phaser.GameObjects.Particles.ParticleEmitter;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  phase: GuardianSpiritPhase;
  color: number;
}

/** Kleine, additive Glühwürmchen-Visuals mit lebendigem Schweif und Funkenstaub. */
export class GuardianSpiritRenderer {
  private readonly visuals = new Map<number, GuardianSpiritVisual>();
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_GUARDIAN_HALO, 64, [
      [0, 'rgba(255,255,255,0.72)'],
      [0.18, 'rgba(218,255,246,0.42)'],
      [0.5, 'rgba(105,223,255,0.16)'],
      [1, 'rgba(70,170,255,0)'],
    ]);
    fillRadialGradientTexture(this.scene.textures, TEX_GUARDIAN_PARTICLE, 12, [
      [0, 'rgba(255,255,255,1)'],
      [0.32, 'rgba(222,255,246,0.82)'],
      [1, 'rgba(100,210,255,0)'],
    ]);
    ensureCanvasTexture(this.scene.textures, TEX_GUARDIAN_CORE, 24, 24, (ctx) => {
      const glow = ctx.createRadialGradient(12, 12, 0, 12, 12, 11);
      glow.addColorStop(0, 'rgba(255,255,255,1)');
      glow.addColorStop(0.28, 'rgba(239,255,225,1)');
      glow.addColorStop(0.62, 'rgba(102,235,255,0.72)');
      glow.addColorStop(1, 'rgba(50,150,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 24, 24);
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(12, 3);
      ctx.lineTo(14.3, 9.7);
      ctx.lineTo(21, 12);
      ctx.lineTo(14.3, 14.3);
      ctx.lineTo(12, 21);
      ctx.lineTo(9.7, 14.3);
      ctx.lineTo(3, 12);
      ctx.lineTo(9.7, 9.7);
      ctx.closePath();
      ctx.stroke();
    });
  }

  syncVisuals(snapshots: readonly SyncedGuardianSpirit[]): void {
    const activeIds = new Set(snapshots.map(snapshot => snapshot.id));
    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      this.lighting?.releaseLight(lightKey(id));
      this.destroyVisual(visual);
      this.visuals.delete(id);
    }

    for (const snapshot of snapshots) {
      let visual = this.visuals.get(snapshot.id);
      if (!visual) {
        visual = this.createVisual(snapshot);
        this.visuals.set(snapshot.id, visual);
        this.playBurst(snapshot.x, snapshot.y, snapshot.ownerColor, 14, 72);
      } else if (snapshot.phase === 'impact' && visual.phase !== 'impact') {
        this.playImpact(snapshot.x, snapshot.y, snapshot.ownerColor);
      }
      visual.targetX = snapshot.x;
      visual.targetY = snapshot.y;
      visual.phase = snapshot.phase;
      visual.color = snapshot.ownerColor;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-Math.max(0, delta) / SMOOTH_TIME_MS);
    const now = this.scene.time.now;
    for (const [id, visual] of this.visuals) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);

      const flutter = Math.sin(now * 0.026 + id * 1.7);
      const pulse = 1 + Math.sin(now * 0.008 + id) * 0.12;
      const phaseAlpha = visual.phase === 'impact' ? 0.12 : 1;
      visual.halo.setPosition(visual.currentX, visual.currentY).setScale(0.72 * pulse).setAlpha(0.62 * phaseAlpha);
      visual.core.setPosition(visual.currentX, visual.currentY).setScale(0.72 * pulse).setAlpha(phaseAlpha);
      visual.wingLeft
        .setPosition(visual.currentX - 5.5, visual.currentY + flutter * 1.8)
        .setRotation(-0.5 + flutter * 0.22)
        .setScale(0.65, 0.24 + Math.abs(flutter) * 0.08)
        .setAlpha(0.58 * phaseAlpha);
      visual.wingRight
        .setPosition(visual.currentX + 5.5, visual.currentY - flutter * 1.8)
        .setRotation(0.5 - flutter * 0.22)
        .setScale(0.65, 0.24 + Math.abs(flutter) * 0.08)
        .setAlpha(0.58 * phaseAlpha);
      visual.trail.setPosition(visual.currentX, visual.currentY);
      visual.motes.setPosition(visual.currentX, visual.currentY);
      if (visual.phase === 'impact') {
        visual.trail.stop();
        visual.motes.stop();
      }

      // `phaseAlpha` blendet das Visual beim Aufschlag aus; das Licht folgt derselben
      // Kurve, damit der Geist nicht als körperloses Leuchten stehen bleibt.
      this.lighting?.setLight(lightKey(id), 'arcaneField', visual.currentX, visual.currentY, {
        radiusPx: 110,
        color: mixColors(visual.color, 0xffffff, 0.66),
        intensity: 0.42 * phaseAlpha,
      });
    }
  }

  destroyAll(): void {
    for (const [id, visual] of this.visuals) {
      this.lighting?.releaseLight(lightKey(id));
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(snapshot: SyncedGuardianSpirit): GuardianSpiritVisual {
    const bright = mixColors(snapshot.ownerColor, 0xcffff1, 0.72);
    const halo = configureAdditiveImage(
      this.scene.add.image(snapshot.x, snapshot.y, TEX_GUARDIAN_HALO),
      SPIRIT_DEPTH - 0.03,
      0.62,
      bright,
    );
    const core = configureAdditiveImage(
      this.scene.add.image(snapshot.x, snapshot.y, TEX_GUARDIAN_CORE),
      SPIRIT_DEPTH + 0.03,
      1,
      0xffffff,
    );
    const wingLeft = configureAdditiveImage(
      this.scene.add.image(snapshot.x - 5, snapshot.y, TEX_GUARDIAN_HALO),
      SPIRIT_DEPTH,
      0.58,
      bright,
    );
    const wingRight = configureAdditiveImage(
      this.scene.add.image(snapshot.x + 5, snapshot.y, TEX_GUARDIAN_HALO),
      SPIRIT_DEPTH,
      0.58,
      bright,
    );
    const tints = [0xffffff, 0xd9fff1, bright, snapshot.ownerColor];
    const trail = createEmitter(this.scene, snapshot.x, snapshot.y, TEX_GUARDIAN_PARTICLE, {
      lifespan: { min: 280, max: 520 },
      frequency: 34,
      quantity: 1,
      speed: { min: 4, max: 15 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.72, end: 0 },
      alpha: { start: 0.76, end: 0 },
      tint: tints,
      blendMode: Phaser.BlendModes.ADD,
    }, SPIRIT_DEPTH - 0.08);
    const motes = createEmitter(this.scene, snapshot.x, snapshot.y, TEX_GUARDIAN_PARTICLE, {
      lifespan: { min: 420, max: 760 },
      frequency: 105,
      quantity: 1,
      speed: { min: 18, max: 34 },
      angle: { min: 0, max: 360 },
      gravityY: -8,
      scale: { start: 0.46, end: 0 },
      alpha: { start: 0.7, end: 0 },
      tint: tints,
      blendMode: Phaser.BlendModes.ADD,
    }, SPIRIT_DEPTH - 0.05);
    return {
      halo,
      core,
      wingLeft,
      wingRight,
      trail,
      motes,
      currentX: snapshot.x,
      currentY: snapshot.y,
      targetX: snapshot.x,
      targetY: snapshot.y,
      phase: snapshot.phase,
      color: snapshot.ownerColor,
    };
  }

  private playImpact(x: number, y: number, color: number): void {
    this.playBurst(x, y, color, 26, 145);
    const ring = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_GUARDIAN_HALO),
      SPIRIT_DEPTH + 0.1,
      0.95,
      mixColors(color, 0xffffff, 0.78),
    ).setScale(0.22);
    this.scene.tweens.add({
      targets: ring,
      scaleX: 1.25,
      scaleY: 1.25,
      alpha: 0,
      duration: 260,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private playBurst(x: number, y: number, color: number, count: number, speed: number): void {
    const emitter = createEmitter(this.scene, x, y, TEX_GUARDIAN_PARTICLE, {
      lifespan: { min: 280, max: 620 },
      frequency: -1,
      quantity: 1,
      speed: { min: speed * 0.45, max: speed },
      angle: { min: 0, max: 360 },
      scale: { start: 1.05, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: [0xffffff, 0xd9fff1, color],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, SPIRIT_DEPTH + 0.12);
    emitter.explode(count);
    this.scene.time.delayedCall(700, () => destroyEmitter(emitter));
  }

  private destroyVisual(visual: GuardianSpiritVisual): void {
    visual.halo.destroy();
    visual.core.destroy();
    visual.wingLeft.destroy();
    visual.wingRight.destroy();
    destroyEmitter(visual.trail);
    destroyEmitter(visual.motes);
  }
}

function lightKey(id: number): string {
  return `spirit:${id}`;
}
