import * as Phaser from 'phaser';
import { DEPTH_AIM } from '../config';
import { ensureCanvasTexture } from '../effects/EffectUtils';
import type { PlasmaBurnerOverloadNetState } from '../combat/plasmaBurner/PlasmaBurnerContracts';

/** Quantized cached arcs keep cursor updates allocation-free. */
export class PlasmaBurnerOverloadIndicator {
  private readonly empty: Phaser.GameObjects.Image;
  private readonly fill: Phaser.GameObjects.Image;
  constructor(private readonly scene: Phaser.Scene) {
    this.empty = scene.add.image(0, 0, this.texture(64)).setDepth(DEPTH_AIM).setAlpha(0.2);
    this.fill = scene.add.image(0, 0, this.texture(1)).setDepth(DEPTH_AIM + 0.01);
  }
  hide(): void { this.empty.setVisible(false); this.fill.setVisible(false); }
  update(x: number, y: number, state: PlasmaBurnerOverloadNetState): void {
    const progress = Math.round(Math.max(0, Math.min(1, state.q / Math.max(1, state.qMax))) * 64);
    const tint = state.building ? 0x88ffdc : 0xe1b57a;
    this.empty.setPosition(x, y).setVisible(true).setTint(tint);
    this.fill.setPosition(x, y).setTexture(this.texture(Math.max(1, progress)))
      .setTint(tint).setVisible(progress > 0).setAlpha(state.building ? 1 : 0.7);
  }
  private texture(progress: number): string {
    const key = '__plasma_overload_' + progress;
    ensureCanvasTexture(this.scene.textures, key, 48, 48, ctx => {
      const end = -Math.PI / 2 + Math.PI * 2 * progress / 64;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(4,13,22,0.85)';
      ctx.beginPath(); ctx.arc(24, 24, 20, -Math.PI / 2, end); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(24, 24, 20, -Math.PI / 2, end); ctx.stroke();
    });
    return key;
  }
  destroy(): void { this.empty.destroy(); this.fill.destroy(); }
}
