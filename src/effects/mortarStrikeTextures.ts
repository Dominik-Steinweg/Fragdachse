import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

export const MORTAR_TEXTURE = 'mortar-strike-v3';
export const MORTAR_TILE = 192;
export const MORTAR_FRAME = { glow: 0, wave: 1, arrow: 2 } as const;

/** Neutral source-side and HUD motifs, baked once per scene; the renderer applies the palette.
 * Everything at the target point is procedural on the GPU (MortarGpuLayer). Motif radius is 80. */
export function ensureMortarStrikeTextures(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, MORTAR_TEXTURE, MORTAR_TILE * 3, MORTAR_TILE, (ctx, texture) => {
    for (let frame = 0; frame <= MORTAR_FRAME.arrow; frame++) {
      const x = frame * MORTAR_TILE;
      texture.add(frame, 0, x, 0, MORTAR_TILE, MORTAR_TILE);
      ctx.save(); ctx.translate(x + MORTAR_TILE / 2, MORTAR_TILE / 2);
      if (frame === MORTAR_FRAME.glow) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 80);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, 'rgba(255,255,255,0.65)');
        g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(-80, -80, 160, 160);
      } else if (frame === MORTAR_FRAME.wave) {
        // Launch pressure ring: soft leading edge, no telegraph ticks at the source.
        const g = ctx.createRadialGradient(0, 0, 58, 0, 0, 80);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.85, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(-80, -80, 160, 160);
      } else {
        ctx.fillStyle = '#ddd'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.shadowColor = '#fff'; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-11, -13); ctx.lineTo(-5, 0); ctx.lineTo(-11, 13); ctx.closePath();
        ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.fillRect(-2, -2, 12, 4);
      }
      ctx.restore();
    }
  });
}
