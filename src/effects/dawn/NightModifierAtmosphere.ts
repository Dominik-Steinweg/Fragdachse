import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import type { DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';
import type { DawnPhaseId } from '../../config/dawn/dawnContent';
import { promoteToClarityCamera } from '../../scenes/arena/ClarityCameraRegistry';
import { registerGraphicsObject } from '../EffectUtils';

/** Temporary M3 presentation tuning. Final shader replacement has one owner and one parameter file. */
export const NIGHT_MODIFIER_ATMOSPHERE = {
  enabled: true,
  edgeFraction: 0.13,
  bands: 16,
  styles: {
    'blood-moon': { color: 0xa61b35, alpha: 0.19, pulseMs: 0 },
    fog: { color: 0x7277b6, alpha: 0.18, pulseMs: 0 },
    bombers: { color: 0xe02c26, alpha: 0.22, pulseMs: 2400 },
    fire: { color: 0xef762d, alpha: 0.2, pulseMs: 5200 },
  },
};

/** Screen-space colour only. No gameplay, fog authority, timers or shader assets. */
export class NightModifierAtmosphere {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private signature = '';
  constructor(private readonly scene: Phaser.Scene) {}

  sync(id: DawnNightModifierId | undefined, phase: DawnPhaseId, elapsedMs: number): void {
    const visible = NIGHT_MODIFIER_ATMOSPHERE.enabled && !!id && (phase === 'night' || (phase === 'dusk' && id === 'bombers'));
    if (!visible || !id) { this.graphics?.setVisible(false); return; }
    if (!this.graphics) {
      this.graphics = this.scene.add.graphics().setScrollFactor(0).setDepth(DEPTH.OVERLAY - 3);
      registerGraphicsObject(this.scene, 'gameplayHud', this.graphics);
      promoteToClarityCamera(this.scene, this.graphics);
    }
    const { width, height } = this.scene.scale;
    const style = NIGHT_MODIFIER_ATMOSPHERE.styles[id];
    const signature = `${id}:${width}:${height}:${style.color}:${NIGHT_MODIFIER_ATMOSPHERE.edgeFraction}:${NIGHT_MODIFIER_ATMOSPHERE.bands}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.graphics.clear();
      const count = NIGHT_MODIFIER_ATMOSPHERE.bands;
      const step = Math.min(width, height) * NIGHT_MODIFIER_ATMOSPHERE.edgeFraction / count;
      for (let band = 0; band < count; band++) {
        const inset = band * step;
        this.graphics.fillStyle(style.color, (1 - band / count) ** 2);
        this.graphics.fillRect(inset, inset, width - inset * 2, step);
        this.graphics.fillRect(inset, height - inset - step, width - inset * 2, step);
        this.graphics.fillRect(inset, inset + step, step, height - 2 * inset - 2 * step);
        this.graphics.fillRect(width - inset - step, inset + step, step, height - 2 * inset - 2 * step);
      }
    }
    const pulse = style.pulseMs ? (0.5 + 0.5 * Math.cos(elapsedMs / style.pulseMs * Math.PI * 2)) ** (id === 'bombers' ? 8 : 1) : 1;
    this.graphics.setVisible(true).setAlpha(style.alpha * (id === 'fire' ? 0.7 + pulse * 0.3 : pulse));
  }
  clear(): void { this.graphics?.setVisible(false); }
  destroy(): void { this.graphics?.destroy(); this.graphics = null; this.signature = ''; }
}
