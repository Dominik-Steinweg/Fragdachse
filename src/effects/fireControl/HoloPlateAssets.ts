import type * as Phaser from 'phaser';
import { ensureCanvasTexture } from '../EffectUtils';

/**
 * Dunkle Emitterscheibe unter einer Holo-Kopie (Auswahl PLATE_v06): ein abgeflachtes Achteck knapp
 * größer als der Turmfuß mit ruhigem Kern. Leuchtende Rand-Ticks zeichnet der Fire-Control-GPU-Batch
 * darüber; die Scheibe selbst bleibt matt, damit der Turm dominant bleibt.
 */
export const HOLO_PLATE_TEXTURE = '__fire_control_holo_plate';
/** Dargestellte Kantenlänge der Scheibe; der Turm-Sprite ist 40 px groß. */
export const HOLO_PLATE_SIZE = 52;
/** Mittelpunktsabstand der Rand-Ticks in Weltpixeln (knapp innerhalb der Achteckkante). */
export const HOLO_PLATE_TICK_RADIUS = 21.5;
/** Deckkraft der Scheibe; der Boden bleibt erkennbar. */
export const HOLO_PLATE_ALPHA = 0.82;

const TEXTURE_SIZE = 64;

export function ensureHoloPlateTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, HOLO_PLATE_TEXTURE, TEXTURE_SIZE, TEXTURE_SIZE, ctx => {
    const c = TEXTURE_SIZE / 2;
    // Flache Ober-, Unter- und Seitenkanten: Ecken bei 22,5° + k · 45°.
    const octagon = (radius: number) => {
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + k * Math.PI / 4;
        const x = c + Math.cos(a) * radius, y = c + Math.sin(a) * radius;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    const body = ctx.createRadialGradient(c, c, 2, c, c, 30);
    body.addColorStop(0, '#1d2d2c');
    body.addColorStop(1, '#111b1b');
    octagon(30.5);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#2f4746';
    ctx.stroke();
    octagon(27.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(8,14,14,0.85)';
    ctx.stroke();
    // Ruhiger Kern: zwei feine Ringe und ein schwaches Zentrumskreuz.
    ctx.strokeStyle = 'rgba(52,78,76,0.75)';
    for (const radius of [19, 9]) {
      ctx.beginPath();
      ctx.arc(c, c, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(61,255,208,0.32)';
    ctx.beginPath();
    ctx.moveTo(c - 3, c); ctx.lineTo(c + 3, c);
    ctx.moveTo(c, c - 3); ctx.lineTo(c, c + 3);
    ctx.stroke();
  });
}
