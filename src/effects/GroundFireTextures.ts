import type Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

/** Organische, gemeinsam ueberlagerte Grundmaske fuer alle GroundFire-Schichten. */
export const TEX_GROUND_FIRE_SURFACE = '__ground_fire_surface';

/**
 * Zeichnet kein einzelnes Flammenmotiv, sondern ein niedrigfrequentes Feld aus weichen Wolken.
 * Die Maske reicht bis fast an den Rand, damit additive Spawns zu einer Flaeche verschmelzen.
 */
export function ensureGroundFireTextures(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_GROUND_FIRE_SURFACE, 32, 32, (ctx) => {
    const base = ctx.createRadialGradient(16, 16, 1, 16, 16, 21);
    base.addColorStop(0, 'rgba(255,255,255,0.46)');
    base.addColorStop(0.34, 'rgba(255,255,255,0.38)');
    base.addColorStop(0.68, 'rgba(255,255,255,0.2)');
    base.addColorStop(0.9, 'rgba(255,255,255,0.06)');
    base.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 32, 32);

    const clouds: readonly (readonly [number, number, number, number, number, number])[] = [
      [7, 11, 11, 5, 0.18, -0.35],
      [17, 7, 10, 5, 0.2, 0.18],
      [26, 12, 8, 6, 0.16, 0.55],
      [8, 20, 11, 6, 0.17, 0.2],
      [20, 19, 12, 6, 0.2, -0.3],
      [27, 24, 7, 5, 0.14, 0.42],
      [15, 27, 9, 4, 0.12, -0.12],
    ];
    for (const [x, y, radiusX, radiusY, alpha, rotation] of clouds) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.scale(1, radiusY / radiusX);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.62})`);
      gradient.addColorStop(0.82, `rgba(255,255,255,${alpha * 0.18})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
      ctx.restore();
    }
  });
}
