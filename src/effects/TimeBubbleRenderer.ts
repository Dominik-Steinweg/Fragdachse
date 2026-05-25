import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedTimeBubble } from '../types';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';
import { addExternalGlow, addInternalGlow, removeExternalFx, removeInternalFx, type GlowHandle } from '../utils/phaserFx';

const TEX_TIME_BUBBLE_FILL = '__time_bubble_fill';
const TEX_TIME_BUBBLE_SHELL = '__time_bubble_shell';
const TEX_TIME_BUBBLE_RIPPLE = '__time_bubble_ripple';
const TEX_TIME_BUBBLE_RIM = '__time_bubble_rim';

interface TimeBubbleVisual {
  fill: Phaser.GameObjects.Image;
  shell: Phaser.GameObjects.Image;
  rippleA: Phaser.GameObjects.Image;
  rippleB: Phaser.GameObjects.Image;
  rim: Phaser.GameObjects.Image;
  outerGlow: GlowHandle | null;
  rimGlow: GlowHandle | null;
  snapshot: SyncedTimeBubble;
  seed: number;
}

export class TimeBubbleRenderer {
  private readonly visuals = new Map<number, TimeBubbleVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    fillRadialGradientTexture(this.scene.textures, TEX_TIME_BUBBLE_FILL, 256, [
      [0, 'rgba(255,255,255,0.24)'],
      [0.34, 'rgba(180,244,255,0.18)'],
      [0.74, 'rgba(86,196,255,0.08)'],
      [1, 'rgba(40,120,180,0.0)'],
    ]);

    ensureCanvasTexture(this.scene.textures, TEX_TIME_BUBBLE_SHELL, 256, 256, (ctx) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(128, 128, 112, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 18;
      ctx.beginPath();
      ctx.arc(128, 128, 100, 0.15, Math.PI * 1.72);
      ctx.stroke();
    });

    ensureCanvasTexture(this.scene.textures, TEX_TIME_BUBBLE_RIPPLE, 256, 256, (ctx) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 4;
      for (let index = 0; index < 5; index++) {
        const radius = 30 + index * 22;
        ctx.beginPath();
        ctx.arc(128, 128, radius, index * 0.35, index * 0.35 + Math.PI * 1.36);
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 2;
      for (let index = 0; index < 7; index++) {
        const radius = 22 + index * 16;
        ctx.beginPath();
        ctx.arc(128, 128, radius, index * 0.52, index * 0.52 + Math.PI * 0.82);
        ctx.stroke();
      }
    });

    ensureCanvasTexture(this.scene.textures, TEX_TIME_BUBBLE_RIM, 256, 256, (ctx) => {
      const gradient = ctx.createRadialGradient(128, 128, 86, 128, 128, 122);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.78, 'rgba(255,255,255,0)');
      gradient.addColorStop(0.9, 'rgba(255,255,255,0.46)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
    });
  }

  syncVisuals(bubbles: readonly SyncedTimeBubble[]): void {
    const activeIds = new Set(bubbles.map((bubble) => bubble.id));
    for (const [id] of this.visuals) {
      if (!activeIds.has(id)) this.destroyVisual(id);
    }

    for (const bubble of bubbles) {
      let visual = this.visuals.get(bubble.id);
      if (!visual) {
        visual = this.createVisual(bubble);
        this.visuals.set(bubble.id, visual);
      }
      visual.snapshot = bubble;
      this.updateVisual(visual, this.scene.time.now);
    }
  }

  update(_deltaMs: number): void {
    const now = this.scene.time.now;
    for (const visual of this.visuals.values()) {
      this.updateVisual(visual, now);
    }
  }

  destroyAll(): void {
    for (const [id] of this.visuals) {
      this.destroyVisual(id);
    }
  }

  private createVisual(snapshot: SyncedTimeBubble): TimeBubbleVisual {
    const fill = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_FILL)
      .setDepth(DEPTH.FIRE + 0.3)
      .setBlendMode(Phaser.BlendModes.ADD);
    const shell = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_SHELL)
      .setDepth(DEPTH.FIRE + 0.45)
      .setBlendMode(Phaser.BlendModes.ADD);
    const rippleA = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_RIPPLE)
      .setDepth(DEPTH.FIRE + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD);
    const rippleB = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_RIPPLE)
      .setDepth(DEPTH.FIRE + 0.52)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setFlipX(true);
    const rim = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_RIM)
      .setDepth(DEPTH.FIRE + 0.6)
      .setBlendMode(Phaser.BlendModes.ADD);

    const outerGlow = addExternalGlow(fill, snapshot.color, 2.2, 0.35, false, 0.2, 10);
    const rimGlow = addInternalGlow(rim, 0xffffff, 1.4, 0.25, false, 0.2, 6);

    return {
      fill,
      shell,
      rippleA,
      rippleB,
      rim,
      outerGlow,
      rimGlow,
      snapshot,
      seed: snapshot.id * 0.731,
    };
  }

  private updateVisual(visual: TimeBubbleVisual, now: number): void {
    const bubble = visual.snapshot;
    const baseScale = Math.max(0.2, bubble.radius / 128);
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * (1.8 + bubble.distortion * 1.2) + visual.seed);
    const counterPulse = 0.5 + 0.5 * Math.cos(time * (1.35 + bubble.distortion) + visual.seed * 1.7);
    const shellScale = baseScale * (1 + (pulse - 0.5) * 0.05);
    const rippleScaleA = baseScale * (1.02 + pulse * 0.06);
    const rippleScaleB = baseScale * (0.98 + counterPulse * 0.08);

    visual.fill
      .setPosition(bubble.x, bubble.y)
      .setScale(baseScale * (1 + pulse * 0.04))
      .setAlpha(bubble.alpha * (0.12 + pulse * 0.06))
      .setTint(bubble.color);
    visual.shell
      .setPosition(bubble.x, bubble.y)
      .setScale(shellScale)
      .setRotation(time * (0.12 + bubble.distortion * 0.18) + visual.seed)
      .setAlpha(bubble.alpha * (0.18 + pulse * 0.10))
      .setTint(bubble.color);
    visual.rippleA
      .setPosition(bubble.x, bubble.y)
      .setScale(rippleScaleA)
      .setRotation(-time * (0.28 + bubble.distortion * 0.34) - visual.seed * 0.7)
      .setAlpha(bubble.alpha * (0.16 + counterPulse * 0.08))
      .setTint(bubble.color);
    visual.rippleB
      .setPosition(bubble.x, bubble.y)
      .setScale(rippleScaleB)
      .setRotation(time * (0.36 + bubble.distortion * 0.26) + visual.seed * 1.2)
      .setAlpha(bubble.alpha * (0.10 + pulse * 0.07))
      .setTint(0xe8fbff);
    visual.rim
      .setPosition(bubble.x, bubble.y)
      .setScale(baseScale * 1.04)
      .setRotation(time * 0.08)
      .setAlpha(bubble.alpha * (0.26 + pulse * 0.12))
      .setTint(0xffffff);

    if (visual.outerGlow) {
      visual.outerGlow.color = bubble.color;
      visual.outerGlow.outerStrength = 2.2 + bubble.distortion * 1.8 + pulse * 0.9;
      visual.outerGlow.innerStrength = 0.3 + counterPulse * 0.16;
    }
    if (visual.rimGlow) {
      visual.rimGlow.outerStrength = 1.2 + bubble.distortion * 0.9 + pulse * 0.7;
      visual.rimGlow.innerStrength = 0.18 + counterPulse * 0.14;
    }
  }

  private destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    removeExternalFx(visual.fill, visual.outerGlow);
    removeInternalFx(visual.rim, visual.rimGlow);
    visual.fill.destroy();
    visual.shell.destroy();
    visual.rippleA.destroy();
    visual.rippleB.destroy();
    visual.rim.destroy();
    this.visuals.delete(id);
  }
}