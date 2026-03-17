import Phaser from 'phaser';
import type { SyncedNukeStrike } from '../types';
import { DEPTH, COLORS } from '../config';
import { NUKE_CONFIG } from './PowerUpConfig';

const TEX_NUKE_ICON = 'powerup_nuke';

interface NukeVisual {
  radius:        Phaser.GameObjects.Arc;
  ring:          Phaser.GameObjects.Arc;
  icon:          Phaser.GameObjects.Image;
  shadow:        Phaser.GameObjects.Ellipse;
  lastCountdown: number | null;
}

export class NukeRenderer {
  private visuals = new Map<number, NukeVisual>();

  constructor(private scene: Phaser.Scene) {}

  generateTextures(): void {
    if (this.scene.textures.exists(TEX_NUKE_ICON)) return;

    const size = 40;
    const canvas = this.scene.textures.createCanvas(TEX_NUKE_ICON, size, size);
    if (!canvas) return;

    const ctx = canvas.context;
    ctx.clearRect(0, 0, size, size);

    ctx.fillStyle = '#20140f';
    ctx.beginPath();
    ctx.arc(20, 24, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#cf573c';
    ctx.beginPath();
    ctx.arc(20, 20, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ebede9';
    ctx.fillRect(18, 6, 4, 7);
    ctx.fillRect(15, 9, 10, 4);

    ctx.fillStyle = '#241527';
    ctx.fillRect(18, 18, 4, 10);
    ctx.fillRect(14, 23, 12, 4);

    ctx.fillStyle = '#e8c170';
    ctx.beginPath();
    ctx.arc(20, 20, 4, 0, Math.PI * 2);
    ctx.fill();

    canvas.refresh();
  }

  sync(nukes: SyncedNukeStrike[]): void {
    const activeIds = new Set<number>();
    const now = Date.now();

    for (const nuke of nukes) {
      activeIds.add(nuke.id);

      let visual = this.visuals.get(nuke.id);
      if (!visual) {
        visual = this.createVisual(nuke);
        this.visuals.set(nuke.id, visual);
      }

      visual.radius.setPosition(nuke.x, nuke.y).setRadius(nuke.radius);
      visual.ring.setPosition(nuke.x, nuke.y).setRadius(nuke.radius);
      visual.icon.setPosition(nuke.x, nuke.y);
      visual.shadow.setPosition(nuke.x, nuke.y + 16);

      const remainingSeconds = Math.max(0, Math.ceil((nuke.explodeAt - now) / 1000));
      if (remainingSeconds > 0 && visual.lastCountdown !== remainingSeconds) {
        visual.lastCountdown = remainingSeconds;
        this.emitCountdownText(nuke.x, nuke.y, remainingSeconds);
      }

      const pulse = 1 + 0.06 * Math.sin(now / 120);
      visual.icon.setScale(pulse);
      visual.ring.setAlpha(NUKE_CONFIG.circleStrokeAlpha + 0.12 * Math.sin(now / 180));
    }

    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(id);
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) {
      this.destroyVisual(visual);
    }
    this.visuals.clear();
  }

  private createVisual(nuke: SyncedNukeStrike): NukeVisual {
    const radius = this.scene.add.circle(nuke.x, nuke.y, nuke.radius, NUKE_CONFIG.warningColor, NUKE_CONFIG.circleFillAlpha);
    radius.setDepth(DEPTH.CANOPY - 1);

    const ring = this.scene.add.circle(nuke.x, nuke.y, nuke.radius);
    ring.setStrokeStyle(4, COLORS.GOLD_1, NUKE_CONFIG.circleStrokeAlpha);
    ring.setDepth(DEPTH.CANOPY);

    const shadow = this.scene.add.ellipse(nuke.x, nuke.y + 16, 34, 12, COLORS.GREY_10, 0.28);
    shadow.setDepth(DEPTH.PLAYERS - 2);

    const icon = this.scene.add.image(nuke.x, nuke.y, TEX_NUKE_ICON);
    icon.setDisplaySize(36, 36);
    icon.setDepth(DEPTH.PLAYERS - 1);

    this.scene.tweens.add({
      targets:  radius,
      alpha:    { from: NUKE_CONFIG.circleFillAlpha * 0.8, to: NUKE_CONFIG.circleFillAlpha * 1.15 },
      duration: 550,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });

    return {
      radius,
      ring,
      icon,
      shadow,
      lastCountdown: null,
    };
  }

  private emitCountdownText(x: number, y: number, value: number): void {
    const label = this.scene.add.text(x, y - 20, String(value), {
      fontFamily: 'monospace',
      fontSize: '34px',
      color: '#ebede9',
      stroke: '#241527',
      strokeThickness: 5,
    });
    label.setOrigin(0.5);
    label.setDepth(DEPTH.OVERLAY - 5);

    this.scene.tweens.add({
      targets:    label,
      y:          y - 64,
      alpha:      0,
      duration:   850,
      ease:       'Quad.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private destroyVisual(visual: NukeVisual): void {
    visual.radius.destroy();
    visual.ring.destroy();
    visual.icon.destroy();
    visual.shadow.destroy();
  }
}