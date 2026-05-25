import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { SyncedTimeBubble } from '../types';
import { ensureCanvasTexture, mixColors } from './EffectUtils';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';

const TEX_TIME_BUBBLE_MEMBRANE = '__time_bubble_membrane';
const TEX_TIME_BUBBLE_INTERFERENCE = '__time_bubble_interference';

interface TimeBubbleVisual {
  membrane: Phaser.GameObjects.Image;
  interferenceA: Phaser.GameObjects.Image;
  interferenceB: Phaser.GameObjects.Image;
  shellGlow: GlowHandle | null;
  snapshot: SyncedTimeBubble;
  seed: number;
}

interface FeatheredRibbon {
  rx: number;
  ry: number;
  rotation: number;
  start: number;
  end: number;
  thickness: number;
  blur: number;
  opacity: number;
  colors: readonly [string, string, string];
}

interface SoftBlob {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  color: string;
  alpha: number;
}

interface RadiusRing {
  radius: number;
  innerFade: number;
  outerFeather: number;
  opacity: number;
  innerColor: string;
  edgeColor: string;
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/,1\)$/u, `,${alpha.toFixed(3)})`);
}

function drawFeatheredRibbon(ctx: CanvasRenderingContext2D, center: number, ribbon: FeatheredRibbon): void {
  const arcLength = ((ribbon.rx + ribbon.ry) * 0.5) * Math.abs(ribbon.end - ribbon.start);
  const sampleCount = Math.max(24, Math.ceil(arcLength / 9));

  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(ribbon.rotation);

  for (let index = 0; index < sampleCount; index += 1) {
    const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const angle = Phaser.Math.Linear(ribbon.start, ribbon.end, progress);
    const x = Math.cos(angle) * ribbon.rx;
    const y = Math.sin(angle) * ribbon.ry;
    const tangentFade = Math.sin(progress * Math.PI) ** 1.8;
    const radius = ribbon.thickness * (1.8 + tangentFade * 1.25);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius + ribbon.blur);
    gradient.addColorStop(0, withAlpha(ribbon.colors[1], ribbon.opacity * tangentFade * 0.34));
    gradient.addColorStop(0.32, withAlpha(ribbon.colors[1], ribbon.opacity * tangentFade * 0.18));
    gradient.addColorStop(0.68, withAlpha(ribbon.colors[2], ribbon.opacity * tangentFade * 0.08));
    gradient.addColorStop(1, ribbon.colors[0]);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius + ribbon.blur, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawSoftBlob(ctx: CanvasRenderingContext2D, blob: SoftBlob): void {
  ctx.save();
  ctx.translate(blob.x, blob.y);
  ctx.rotate(blob.rotation);
  ctx.scale(blob.radiusX / Math.max(1, blob.radiusY), 1);

  const radius = Math.max(blob.radiusX, blob.radiusY);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
  gradient.addColorStop(0, withAlpha(blob.color, blob.alpha));
  gradient.addColorStop(0.34, withAlpha(blob.color, blob.alpha * 0.38));
  gradient.addColorStop(0.68, withAlpha(blob.color, blob.alpha * 0.12));
  gradient.addColorStop(1, withAlpha(blob.color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRadiusRing(ctx: CanvasRenderingContext2D, center: number, ring: RadiusRing): void {
  const outerRadius = ring.radius + ring.outerFeather;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, outerRadius);
  const innerFadeStart = Math.max(0, (ring.radius - ring.innerFade) / outerRadius);
  const innerBandStart = Math.max(innerFadeStart, (ring.radius - ring.innerFade * 0.34) / outerRadius);
  const edgeHold = Math.min(0.996, ring.radius / outerRadius);
  const outerDrop = Math.min(0.999, (ring.radius + ring.outerFeather * 0.18) / outerRadius);

  gradient.addColorStop(0, withAlpha(ring.innerColor, 0));
  gradient.addColorStop(innerFadeStart, withAlpha(ring.innerColor, 0));
  gradient.addColorStop(innerBandStart, withAlpha(ring.innerColor, ring.opacity * 0.14));
  gradient.addColorStop(Math.max(innerBandStart, edgeHold - 0.016), withAlpha(ring.innerColor, ring.opacity * 0.62));
  gradient.addColorStop(edgeHold, withAlpha(ring.edgeColor, ring.opacity));
  gradient.addColorStop(outerDrop, withAlpha(ring.edgeColor, ring.opacity * 0.94));
  gradient.addColorStop(1, withAlpha(ring.edgeColor, 0));

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(center, center, outerRadius, 0, Math.PI * 2);
  ctx.fill();
}

export class TimeBubbleRenderer {
  private readonly visuals = new Map<number, TimeBubbleVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_TIME_BUBBLE_MEMBRANE, 320, 320, (ctx) => {
      const center = 160;
      ctx.clearRect(0, 0, 320, 320);
      ctx.globalCompositeOperation = 'screen';

      const membraneBlobs: SoftBlob[] = [
        { x: center - 34, y: center - 26, radiusX: 96, radiusY: 68, rotation: -0.34, color: 'rgba(255,128,210,1)', alpha: 0.12 },
        { x: center + 20, y: center + 12, radiusX: 86, radiusY: 112, rotation: 0.58, color: 'rgba(112,236,255,1)', alpha: 0.11 },
        { x: center + 10, y: center - 30, radiusX: 74, radiusY: 54, rotation: 0.16, color: 'rgba(246,255,148,1)', alpha: 0.08 },
        { x: center - 8, y: center + 34, radiusX: 72, radiusY: 48, rotation: -0.72, color: 'rgba(156,132,255,1)', alpha: 0.09 },
      ];

      for (const blob of membraneBlobs) {
        drawSoftBlob(ctx, blob);
      }

      const filaments: FeatheredRibbon[] = [
        { thickness: 8.2, blur: 18, opacity: 0.58, rx: 126, ry: 76, rotation: -0.36, start: 3.9, end: 5.5, colors: ['rgba(255,180,230,0.0)', 'rgba(255,180,230,1)', 'rgba(112,240,255,1)'] },
        { thickness: 7, blur: 17, opacity: 0.48, rx: 108, ry: 132, rotation: 0.48, start: 0.42, end: 1.78, colors: ['rgba(255,255,150,0.0)', 'rgba(255,255,150,1)', 'rgba(102,255,214,1)'] },
        { thickness: 6.4, blur: 16, opacity: 0.44, rx: 142, ry: 98, rotation: 0.98, start: 2.12, end: 3.32, colors: ['rgba(150,132,255,0.0)', 'rgba(150,132,255,1)', 'rgba(255,160,214,1)'] },
        { thickness: 5.8, blur: 15, opacity: 0.4, rx: 116, ry: 88, rotation: -1.04, start: 4.72, end: 5.84, colors: ['rgba(112,236,255,0.0)', 'rgba(112,236,255,1)', 'rgba(255,240,166,1)'] },
        { thickness: 5.2, blur: 14, opacity: 0.38, rx: 92, ry: 122, rotation: 0.08, start: 2.72, end: 3.84, colors: ['rgba(255,174,226,0.0)', 'rgba(255,174,226,1)', 'rgba(172,255,214,1)'] },
        { thickness: 4.8, blur: 14, opacity: 0.34, rx: 138, ry: 108, rotation: 0.62, start: 5.34, end: 6.18, colors: ['rgba(164,236,255,0.0)', 'rgba(164,236,255,1)', 'rgba(255,196,232,1)'] },
          { thickness: 4.4, blur: 13, opacity: 0.28, rx: 76, ry: 58, rotation: 0.34, start: 0.94, end: 2.18, colors: ['rgba(255,206,238,0.0)', 'rgba(255,206,238,1)', 'rgba(146,244,255,1)'] },
          { thickness: 3.9, blur: 12, opacity: 0.24, rx: 62, ry: 84, rotation: -0.58, start: 3.28, end: 4.46, colors: ['rgba(188,170,255,0.0)', 'rgba(188,170,255,1)', 'rgba(255,236,172,1)'] },
          { thickness: 3.6, blur: 11, opacity: 0.2, rx: 54, ry: 46, rotation: 1.12, start: 4.86, end: 5.86, colors: ['rgba(164,244,255,0.0)', 'rgba(164,244,255,1)', 'rgba(255,182,226,1)'] },
      ];

      for (const filament of filaments) {
        drawFeatheredRibbon(ctx, center, filament);
      }

      drawRadiusRing(ctx, center, {
        radius: 146,
        innerFade: 34,
        outerFeather: 5,
        opacity: 0.24,
        innerColor: 'rgba(168,246,255,1)',
        edgeColor: 'rgba(255,248,206,1)',
      });

      const halo = ctx.createRadialGradient(center - 36, center - 40, 24, center, center, 156);
      halo.addColorStop(0, 'rgba(255,224,246,0.12)');
      halo.addColorStop(0.26, 'rgba(152,236,255,0.07)');
      halo.addColorStop(0.52, 'rgba(244,255,166,0.03)');
      halo.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, 320, 320);
    });

    ensureCanvasTexture(this.scene.textures, TEX_TIME_BUBBLE_INTERFERENCE, 320, 320, (ctx) => {
      const center = 160;
      ctx.clearRect(0, 0, 320, 320);
      ctx.globalCompositeOperation = 'screen';

      const ribbons: FeatheredRibbon[] = [
        { thickness: 6.2, blur: 20, opacity: 0.48, rx: 118, ry: 74, rotation: -0.36, start: -0.82, end: 1.18, colors: ['rgba(255,255,255,0.0)', 'rgba(255,255,255,1)', 'rgba(255,198,236,1)'] },
        { thickness: 6.8, blur: 22, opacity: 0.5, rx: 102, ry: 126, rotation: 0.28, start: 0.18, end: 2.18, colors: ['rgba(161,240,255,0.0)', 'rgba(161,240,255,1)', 'rgba(255,255,190,1)'] },
        { thickness: 5.8, blur: 20, opacity: 0.44, rx: 126, ry: 94, rotation: 0.92, start: 2.64, end: 4.46, colors: ['rgba(255,196,228,0.0)', 'rgba(255,196,228,1)', 'rgba(196,255,216,1)'] },
        { thickness: 5.4, blur: 18, opacity: 0.4, rx: 86, ry: 114, rotation: -0.96, start: 1.98, end: 3.42, colors: ['rgba(176,150,255,0.0)', 'rgba(176,150,255,1)', 'rgba(110,236,255,1)'] },
        { thickness: 4.8, blur: 17, opacity: 0.34, rx: 134, ry: 82, rotation: 0.42, start: 4.98, end: 5.98, colors: ['rgba(255,220,164,0.0)', 'rgba(255,220,164,1)', 'rgba(255,164,226,1)'] },
        { thickness: 6.6, blur: 36, opacity: 0.32, rx: 94, ry: 136, rotation: -0.18, start: -0.18, end: 0.92, colors: ['rgba(146,250,255,0.0)', 'rgba(146,250,255,1)', 'rgba(186,164,255,1)'] },
        { thickness: 8.4, blur: 40, opacity: 0.3, rx: 122, ry: 108, rotation: 1.12, start: 3.84, end: 4.72, colors: ['rgba(255,188,226,0.0)', 'rgba(255,188,226,1)', 'rgba(148,244,255,1)'] },
          { thickness: 7.9, blur: 28, opacity: 0.14, rx: 98, ry: 52, rotation: -0.24, start: 0.76, end: 2.42, colors: ['rgba(255,232,255,0.0)', 'rgba(255,232,255,1)', 'rgba(186,244,255,1)'] },
          { thickness: 7.4, blur: 36, opacity: 0.1, rx: 58, ry: 78, rotation: 0.74, start: 2.82, end: 4.04, colors: ['rgba(202,186,255,0.0)', 'rgba(202,186,255,1)', 'rgba(255,226,170,1)'] },
          { thickness: 6.8, blur: 35, opacity: 0.08, rx: 48, ry: 60, rotation: -1.12, start: 4.88, end: 5.9, colors: ['rgba(255,206,232,0.0)', 'rgba(255,206,232,1)', 'rgba(146,236,255,1)'] },
      ];

      for (const ribbon of ribbons) {
        drawFeatheredRibbon(ctx, center, ribbon);
      }
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
    const membrane = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_MEMBRANE)
      .setDepth(DEPTH.FIRE + 0.42)
      .setBlendMode(Phaser.BlendModes.SCREEN);
    const interferenceA = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_INTERFERENCE)
      .setDepth(DEPTH.FIRE + 0.48)
      .setBlendMode(Phaser.BlendModes.SCREEN);
    const interferenceB = this.scene.add.image(snapshot.x, snapshot.y, TEX_TIME_BUBBLE_INTERFERENCE)
      .setDepth(DEPTH.FIRE + 0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setFlipX(true);

    const shellGlow = addExternalGlow(membrane, mixColors(snapshot.color, 0xffffff, 0.58), 3.1, 0.22, false, 0.28, 14);

    return {
      membrane,
      interferenceA,
      interferenceB,
      shellGlow,
      snapshot,
      seed: snapshot.id * 0.731,
    };
  }

  private updateVisual(visual: TimeBubbleVisual, now: number): void {
    const bubble = visual.snapshot;
    const baseScale = Math.max(0.24, bubble.radius / 160);
    const time = now * 0.001;
    const pulse = 0.5 + 0.5 * Math.sin(time * (1.8 + bubble.distortion * 1.2) + visual.seed);
    const counterPulse = 0.5 + 0.5 * Math.cos(time * (1.35 + bubble.distortion) + visual.seed * 1.7);
    const shimmer = 0.5 + 0.5 * Math.sin(time * (0.92 + bubble.distortion * 0.4) + visual.seed * 2.3);
    const membraneScale = baseScale * (1 + (pulse - 0.5) * 0.035);
    const interferenceScaleA = baseScale * (1.01 + pulse * 0.05);
    const interferenceScaleB = baseScale * (0.98 + counterPulse * 0.07);
    const accentColor = mixColors(bubble.color, 0xffffff, 0.28);
    const coolAccent = mixColors(0x58f0ff, accentColor, 0.14);
    const warmAccent = mixColors(0xff5abf, accentColor, 0.1);

    visual.membrane
      .setPosition(bubble.x, bubble.y)
      .setScale(membraneScale)
      .setRotation(time * (0.09 + bubble.distortion * 0.12) + visual.seed)
      .setAlpha(bubble.alpha * (0.34 + pulse * 0.14))
      .setTint(accentColor);
    visual.interferenceA
      .setPosition(bubble.x, bubble.y)
      .setScale(interferenceScaleA)
      .setRotation(-time * (0.24 + bubble.distortion * 0.28) - visual.seed * 0.7)
      .setAlpha(bubble.alpha * (0.72 + shimmer * 0.24))
      .setTint(coolAccent);
    visual.interferenceB
      .setPosition(bubble.x, bubble.y)
      .setScale(interferenceScaleB)
      .setRotation(time * (0.34 + bubble.distortion * 0.22) + visual.seed * 1.2)
      .setAlpha(bubble.alpha * (0.68 + counterPulse * 0.22))
      .setTint(warmAccent);

    if (visual.shellGlow) {
      visual.shellGlow.color = mixColors(0xf4ff95, accentColor, 0.08);
      visual.shellGlow.outerStrength = 0.56 + bubble.distortion * 0.24 + pulse * 0.18;
      visual.shellGlow.innerStrength = 0.04 + counterPulse * 0.03;
    }
  }

  private destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    removeExternalFx(visual.membrane, visual.shellGlow);
    visual.membrane.destroy();
    visual.interferenceA.destroy();
    visual.interferenceB.destroy();
    this.visuals.delete(id);
  }
}