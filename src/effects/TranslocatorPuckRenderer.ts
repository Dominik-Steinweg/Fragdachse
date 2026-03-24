import Phaser from 'phaser';
import { DEPTH } from '../config';
import {
  configureAdditiveImage,
  ensureCanvasTexture,
  fillRadialGradientTexture,
} from './EffectUtils';

const TEX_PUCK_BASE = '__translocator_puck_base';
const TEX_PUCK_GLOW = '__translocator_puck_glow';

interface PuckVisual {
  baseImage: Phaser.GameObjects.Image;
  glowImage: Phaser.GameObjects.Image;
}

export class TranslocatorPuckRenderer {
  private visuals = new Map<number, PuckVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    ensureCanvasTexture(textures, TEX_PUCK_BASE, 16, 16, (ctx) => {
      ctx.fillStyle = '#444444';
      ctx.beginPath();
      ctx.arc(8, 8, 6, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(8, 8, 6, 0, Math.PI * 2);
      ctx.stroke();
      
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(8, 8, 2, 0, Math.PI * 2);
      ctx.fill();
    });

    fillRadialGradientTexture(textures, TEX_PUCK_GLOW, 32, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.4, 'rgba(255,255,255,0.6)'],
      [1, 'rgba(255,255,255,0.0)'],
    ]);
  }

  createVisual(id: number, x: number, y: number, color: number): void {
    if (this.visuals.has(id)) return;

    const baseImage = this.scene.add.image(x, y, TEX_PUCK_BASE);
    baseImage.setDepth(DEPTH.PROJECTILES);

    const glowImage = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_PUCK_GLOW),
      DEPTH.PROJECTILES + 0.1,
      0.8,
      color
    );

    this.visuals.set(id, { baseImage, glowImage });
    this.updateVisual(id, x, y, color);
  }

  updateVisual(id: number, x: number, y: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    // Pulsierender Effekt basierend auf der Zeit
    const pulse = Math.abs(Math.sin(this.scene.time.now * 0.005 + id));
    const glowScale = 0.8 + pulse * 0.6;
    const glowAlpha = 0.4 + pulse * 0.4;

    visual.baseImage.setPosition(x, y);
    visual.baseImage.setRotation(this.scene.time.now * 0.01);
    
    visual.glowImage.setPosition(x, y);
    visual.glowImage.setScale(glowScale);
    visual.glowImage.setAlpha(glowAlpha);
    visual.glowImage.setTint(color);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    visual.baseImage.destroy();
    visual.glowImage.destroy();
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return Array.from(this.visuals.keys());
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) {
      visual.baseImage.destroy();
      visual.glowImage.destroy();
    }
    this.visuals.clear();
  }
}
