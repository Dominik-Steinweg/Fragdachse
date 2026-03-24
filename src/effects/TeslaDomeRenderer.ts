import Phaser from 'phaser';
import { DEPTH } from '../config';
import { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { SyncedTeslaDome } from '../types';
import {
  configureAdditiveImage,
  ensureCanvasTexture,
  fillRadialGradientTexture,
} from './EffectUtils';

const TEX_DOME_GLOW = '__tesla_dome_glow';
const TEX_DOME_RING = '__tesla_dome_ring';
const TEX_DOME_SHELL = '__tesla_dome_shell';

interface TeslaDomeVisual {
  coreGlow: Phaser.GameObjects.Image;
  shellGlow: Phaser.GameObjects.Image;
  ring: Phaser.GameObjects.Image;
  boltGlow: Phaser.GameObjects.Graphics;
  boltCore: Phaser.GameObjects.Graphics;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  currentRadius: number;
  targetRadius: number;
  currentAlpha: number;
  targetAlpha: number;
  targets: TeslaBoltTargetState[];
}

interface TeslaBoltTargetState {
  type: string;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
}

const DOME_SMOOTH_TIME_MS = 52;
const TARGET_SMOOTH_TIME_MS = 38;

export class TeslaDomeRenderer {
  private readonly visuals = new Map<string, TeslaDomeVisual>();
  private readonly configs = new Map<string, WeaponConfig & { fire: TeslaDomeWeaponFireConfig }>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    fillRadialGradientTexture(textures, TEX_DOME_GLOW, 192, [
      [0, 'rgba(255,255,255,0.42)'],
      [0.22, 'rgba(159,236,255,0.28)'],
      [0.58, 'rgba(80,168,235,0.12)'],
      [1, 'rgba(16,38,70,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_DOME_RING, 256, 256, (ctx) => {
      const center = 128;
      ctx.strokeStyle = 'rgba(220,248,255,0.92)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(center, center, 112, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(134,224,255,0.34)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(center, center, 104, Math.PI * 0.2, Math.PI * 1.72);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center, center, 92, Math.PI * 0.88, Math.PI * 2.04);
      ctx.stroke();
    });

    ensureCanvasTexture(textures, TEX_DOME_SHELL, 320, 320, (ctx) => {
      const center = 160;
      const gradient = ctx.createRadialGradient(center, center, 28, center, center, 158);
      gradient.addColorStop(0, 'rgba(255,255,255,0.0)');
      gradient.addColorStop(0.56, 'rgba(132,224,255,0.06)');
      gradient.addColorStop(0.78, 'rgba(90,172,255,0.14)');
      gradient.addColorStop(1, 'rgba(30,64,118,0.0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 320, 320);
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
        visual = this.createVisual(dome);
        this.visuals.set(dome.ownerId, visual);
      }
      visual.targetX = dome.x;
      visual.targetY = dome.y;
      visual.targetRadius = dome.radius;
      visual.targetAlpha = dome.alpha;

      const nextTargets: TeslaBoltTargetState[] = dome.targets.map((target, index) => {
        const previous = visual.targets[index];
        return {
          type: target.type,
          currentX: previous?.currentX ?? visual.currentX,
          currentY: previous?.currentY ?? visual.currentY,
          targetX: target.x,
          targetY: target.y,
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

  private createVisual(dome: SyncedTeslaDome): TeslaDomeVisual {
    const coreGlow = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_GLOW),
      DEPTH.FIRE + 0.08,
      0.65,
      dome.color,
    );
    const shellGlow = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_SHELL),
      DEPTH.FIRE + 0.02,
      0.5,
      dome.color,
    );
    const ring = configureAdditiveImage(
      this.scene.add.image(dome.x, dome.y, TEX_DOME_RING),
      DEPTH.FIRE + 0.12,
      0.7,
      0xe8fbff,
    );
    const boltGlow = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.18);
    const boltCore = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.2);

    return {
      coreGlow,
      shellGlow,
      ring,
      boltGlow,
      boltCore,
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
      })),
    };
  }

  private updateVisual(
    ownerId: string,
    visual: TeslaDomeVisual,
    config?: WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
  ): void {
    const time = this.scene.time.now;
    const fallbackConfig = WEAPON_CONFIGS.TESLA_DOME as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
    const fire = (config ?? fallbackConfig).fire;
    const indicatorAlpha = fire.visualIndicatorAlpha;
    const fieldAlpha = fire.visualFieldAlpha;
    const minThickness = fire.visualBoltThicknessMin;
    const maxThickness = fire.visualBoltThicknessMax;
    const jitter = fire.visualJitter;
    const idleArcCount = fire.visualIdleArcCount;
    const idleArcLength = fire.visualIdleArcLength;
    const branchChance = fire.visualBranchChance;

    const baseScale = visual.currentRadius / 112;
    const pulse = 1 + Math.sin(time * 0.008 + visual.currentX * 0.01) * 0.03;
    const alphaScale = Math.max(0, Math.min(1, visual.currentAlpha));
    const ownerSeed = this.computeOwnerSeed(ownerId);

    visual.coreGlow.setPosition(visual.currentX, visual.currentY);
    visual.coreGlow.setScale(Math.max(baseScale * 1.75, 0.65) * pulse);
    visual.coreGlow.setAlpha(fieldAlpha * 2.2 * alphaScale);

    visual.shellGlow.setPosition(visual.currentX, visual.currentY);
    visual.shellGlow.setScale(Math.max(visual.currentRadius / 158, 0.55) * (1.02 + Math.cos(time * 0.004 + visual.currentY * 0.01) * 0.04));
    visual.shellGlow.setAlpha(fieldAlpha * alphaScale);

    visual.ring.setPosition(visual.currentX, visual.currentY);
    visual.ring.setScale(baseScale * pulse);
    visual.ring.setAlpha(indicatorAlpha * (0.92 + Math.sin(time * 0.006) * 0.08) * alphaScale);

    visual.boltGlow.clear();
    visual.boltCore.clear();

    if (visual.targets.length === 0) {
      for (let i = 0; i < idleArcCount; i++) {
        const angle = (Math.PI * 2 * i) / Math.max(1, idleArcCount) + time * 0.002 + ownerId.length * 0.3;
        const length = idleArcLength * (0.7 + ((Math.sin(time * 0.01 + i * 1.9) + 1) * 0.5) * 0.6);
        const endX = visual.currentX + Math.cos(angle) * length;
        const endY = visual.currentY + Math.sin(angle) * length;
        this.drawBolt(visual, visual.currentX, visual.currentY, endX, endY, ownerSeed + i * 17, minThickness, maxThickness, jitter, branchChance, 0.18 * alphaScale);
      }
      return;
    }

    for (let index = 0; index < visual.targets.length; index++) {
      const target = visual.targets[index];
      this.drawBolt(
        visual,
        visual.currentX,
        visual.currentY,
        target.currentX,
        target.currentY,
        ownerSeed + index * 31,
        minThickness,
        maxThickness,
        jitter,
        branchChance,
        0.34 * alphaScale,
      );
    }
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
  ): void {
    const points = this.buildBoltPoints(startX, startY, endX, endY, jitter, seed);
    const mainWidth = Phaser.Math.Clamp(minThickness + Phaser.Math.Distance.Between(startX, startY, endX, endY) / 90, minThickness, maxThickness);
    const glowColor = 0x7fdfff;

    visual.boltGlow.lineStyle(mainWidth + 4, glowColor, alphaScale);
    visual.boltGlow.beginPath();
    visual.boltGlow.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      visual.boltGlow.lineTo(points[i].x, points[i].y);
    }
    visual.boltGlow.strokePath();

    visual.boltCore.lineStyle(mainWidth, 0xf6fdff, Math.min(1, alphaScale + 0.45));
    visual.boltCore.beginPath();
    visual.boltCore.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      visual.boltCore.lineTo(points[i].x, points[i].y);
    }
    visual.boltCore.strokePath();

    const branchValue = (Math.sin(this.scene.time.now * 0.005 + seed * 0.73) + 1) * 0.5;
    if (branchValue < 1 - branchChance || points.length < 4) return;

    const pivot = points[Math.floor(points.length * 0.55)];
    const dir = Phaser.Math.Angle.Between(startX, startY, endX, endY) + Math.sin(this.scene.time.now * 0.004 + seed * 1.11) * 1.1;
    const branchLength = Phaser.Math.Distance.Between(startX, startY, endX, endY) * (0.18 + branchValue * 0.14);
    const bx = pivot.x + Math.cos(dir) * branchLength;
    const by = pivot.y + Math.sin(dir) * branchLength;
    const branchPoints = this.buildBoltPoints(pivot.x, pivot.y, bx, by, jitter * 0.6, seed + 97);

    visual.boltGlow.lineStyle(Math.max(1, mainWidth - 0.8) + 2.5, glowColor, alphaScale * 0.6);
    visual.boltGlow.beginPath();
    visual.boltGlow.moveTo(branchPoints[0].x, branchPoints[0].y);
    for (let i = 1; i < branchPoints.length; i++) {
      visual.boltGlow.lineTo(branchPoints[i].x, branchPoints[i].y);
    }
    visual.boltGlow.strokePath();

    visual.boltCore.lineStyle(Math.max(1, mainWidth - 1.2), 0xfafdff, alphaScale * 1.2);
    visual.boltCore.beginPath();
    visual.boltCore.moveTo(branchPoints[0].x, branchPoints[0].y);
    for (let i = 1; i < branchPoints.length; i++) {
      visual.boltCore.lineTo(branchPoints[i].x, branchPoints[i].y);
    }
    visual.boltCore.strokePath();
  }

  private buildBoltPoints(startX: number, startY: number, endX: number, endY: number, jitter: number, seed: number): Phaser.Math.Vector2[] {
    const distance = Phaser.Math.Distance.Between(startX, startY, endX, endY);
    const segments = Math.max(4, Math.ceil(distance / 28));
    const normalX = distance > 0.001 ? -(endY - startY) / distance : 0;
    const normalY = distance > 0.001 ? (endX - startX) / distance : 0;
    const points: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(startX, startY)];
    const time = this.scene.time.now;

    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const baseX = Phaser.Math.Linear(startX, endX, t);
      const baseY = Phaser.Math.Linear(startY, endY, t);
      const fade = 1 - Math.abs(t - 0.5) * 1.6;
      const wave = Math.sin(time * 0.009 + seed * 0.37 + i * 1.73 + t * 9.1);
      const wobble = Math.cos(time * 0.006 + seed * 0.19 + i * 0.91);
      const offset = (wave * 0.72 + wobble * 0.28) * jitter * Math.max(0.2, fade);
      points.push(new Phaser.Math.Vector2(baseX + normalX * offset, baseY + normalY * offset));
    }

    points.push(new Phaser.Math.Vector2(endX, endY));
    return points;
  }

  private destroyVisual(visual: TeslaDomeVisual): void {
    visual.coreGlow.destroy();
    visual.shellGlow.destroy();
    visual.ring.destroy();
    visual.boltGlow.destroy();
    visual.boltCore.destroy();
  }

  private computeOwnerSeed(ownerId: string): number {
    let hash = 0;
    for (let i = 0; i < ownerId.length; i++) {
      hash = ((hash << 5) - hash) + ownerId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) + 1;
  }
}
