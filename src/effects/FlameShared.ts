import type Phaser from 'phaser';
import { VOID_FIRE_COLOR } from '../config';
import { ensureCanvasTexture, fillRadialGradientTexture } from './EffectUtils';

export const TEX_FLAME_EMBER = '__flame_ember';
export const TEX_FLAME_CORE  = '__flame_core';
export const TEX_FLAME_SPARK = '__flame_spark';
export const TEX_FLAME_GLOW  = '__flame_glow';
export const TEX_VOID_FLAME_EMBER = '__void_flame_ember';
export const TEX_VOID_FLAME_CORE  = '__void_flame_core';
export const TEX_VOID_FLAME_SPARK = '__void_flame_spark';
export const TEX_VOID_FLAME_GLOW  = '__void_flame_glow';

export const FLAME_COLORS_CORE  = [0xffee88, 0xffcc44, 0xff9922, 0xffffff];
export const FLAME_COLORS_OUTER = [0xff6622, 0xff4400, 0xdd2200, 0xcc3300];
export const FLAME_COLORS_SPARK = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];
export const VOID_FLAME_COLORS_CORE = [0xffffff, 0xf2c8ff, 0xd887ff, VOID_FIRE_COLOR] as const;
export const VOID_FLAME_COLORS_OUTER = [0xe7b4ff, 0xc76cff, 0x9d35ee, 0x6717a8] as const;
export const VOID_FLAME_COLORS_SPARK = [0xffffff, 0xf4d4ff, 0xd477ff, 0xa83cff] as const;

export function ensureFlameTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  fillRadialGradientTexture(textures, TEX_FLAME_EMBER, 16, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.3, 'rgba(255,238,136,0.8)'],
    [0.7, 'rgba(255,153,34,0.4)'],
    [1, 'rgba(255,68,0,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_CORE, 24, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.4, 'rgba(255,255,200,0.7)'],
    [0.8, 'rgba(255,200,100,0.2)'],
    [1, 'rgba(255,100,0,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_SPARK, 6, [
    [0, 'rgba(255,255,255,1.0)'],
    [0.5, 'rgba(255,238,136,0.6)'],
    [1, 'rgba(255,170,68,0.0)'],
  ]);

  fillRadialGradientTexture(textures, TEX_FLAME_GLOW, 48, [
    [0, 'rgba(255,200,80,0.6)'],
    [0.4, 'rgba(255,140,30,0.3)'],
    [0.7, 'rgba(255,80,0,0.1)'],
    [1, 'rgba(255,40,0,0.0)'],
  ]);
}

export function ensureVoidFlameTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  fillRadialGradientTexture(textures, TEX_VOID_FLAME_EMBER, 16, [
    [0, 'rgba(255,255,255,1)'],
    [0.3, 'rgba(255,255,255,0.8)'],
    [0.7, 'rgba(255,255,255,0.4)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  fillRadialGradientTexture(textures, TEX_VOID_FLAME_CORE, 24, [
    [0, 'rgba(255,255,255,1)'],
    [0.4, 'rgba(255,255,255,0.7)'],
    [0.8, 'rgba(255,255,255,0.2)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  fillRadialGradientTexture(textures, TEX_VOID_FLAME_SPARK, 6, [
    [0, 'rgba(255,255,255,1)'],
    [0.5, 'rgba(255,255,255,0.6)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  fillRadialGradientTexture(textures, TEX_VOID_FLAME_GLOW, 48, [
    [0, 'rgba(255,255,255,0.72)'],
    [0.38, 'rgba(255,255,255,0.38)'],
    [0.72, 'rgba(255,255,255,0.12)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}

/* ── Flammenwerfer-Jet ─────────────────────────────────────────────────────
   Die Jet-Motive sind bewusst *weiss* und tragen keine Farbe in der Textur: erst dadurch
   ergibt der Multiply-Tint exakt die gewuenschte Temperaturfarbe, und dasselbe Frame traegt
   den normalen wie den Void-Stil. Die aelteren `TEX_FLAME_*`-Texturen behalten ihre
   eingebackenen Farben, weil EntityBurn und Fireball weiterhin auf ihnen stehen. ── */

export const TEX_FLAME_BILLOW = '__flame_billow';
export const TEX_FLAME_TONGUE = '__flame_tongue';

/**
 * Temperaturbaender des Jets. Ein Flammenwerfer liest sich als Verlauf entlang des Strahls:
 * goldgelb an der Duese, orange in der Mitte, glutrot am ausbrennenden Ende. Zufaellig aus
 * *einer* Palette gezogene Tints ergeben dagegen ein Farbrauschen, das wie Funkenflug wirkt.
 *
 * Kein Band enthaelt reines Weiss. Additiv summieren sich ueberlappende Partikel, und schon
 * wenige weisse Beitraege heben *alle drei* Kanaele gemeinsam an – der Strahl kippt dann als
 * Ganzes ins Weisse, statt seine Farbe zu zeigen. Die Hitze traegt deshalb der Farbton (Gold
 * gegen Glutrot), nicht die Entsaettigung.
 */
export const FLAME_JET_TINTS_HOT  = [0xffe9a8, 0xffd979, 0xffc65a, 0xffb845] as const;
export const FLAME_JET_TINTS_MID  = [0xffa838, 0xff8a20, 0xff7412, 0xffbb52] as const;
export const FLAME_JET_TINTS_COOL = [0xe0450c, 0xb63108, 0xc93a0a, 0x8e2c0c] as const;
export const VOID_JET_TINTS_HOT   = [0xf2d3ff, 0xe6b6ff, 0xd79bff, 0xc98cff] as const;
export const VOID_JET_TINTS_MID   = [0xc76cff, 0xb14ef2, 0x9c37e4, 0xd486ff] as const;
export const VOID_JET_TINTS_COOL  = [0x7620b8, 0x571590, 0x3c0f68, 0x6a1aa4] as const;

/**
 * Waehlt den Tint nach Resthitze (1 = Duese, 0 = ausgebranntes Ende). Die Bandgrenzen werden
 * pro Partikel leicht verrauscht, sonst faellt die Farbe in zwei sichtbaren Ringen um.
 */
export function pickHeatTint(
  hot: readonly number[],
  mid: readonly number[],
  cool: readonly number[],
  heat: number,
): number {
  const jittered = heat + (Math.random() - 0.5) * 0.22;
  const band = jittered > 0.62 ? hot : jittered > 0.28 ? mid : cool;
  return band[(Math.random() * band.length) | 0];
}

/** Weiche, unregelmaessige Flammenwolke (32x32). Mehrere Lappen statt eines runden Verlaufs. */
const BILLOW_LOBES: readonly (readonly [number, number, number, number])[] = [
  [16, 16, 13, 0.5],
  [11.5, 12, 9, 0.34],
  [21, 13.5, 8, 0.3],
  [12, 21, 8.5, 0.28],
  [22, 20.5, 7.5, 0.26],
  [16, 9.5, 6.5, 0.24],
  [17, 24, 6, 0.22],
];

/** Flammenzunge (32x16), Spitze nach +X. Die Rotation richtet sie auf die Stroemung aus. */
const TONGUE_LOBES: readonly (readonly [number, number, number, number, number])[] = [
  [9, 8, 8, 7, 0.5],
  [10, 8, 3.6, 3.2, 0.42],
  [14.5, 8, 7, 5.4, 0.34],
  [19.5, 8, 6, 4, 0.28],
  [24, 8, 5, 2.8, 0.22],
  [28, 8, 3.6, 1.8, 0.16],
];

export function ensureFlameJetTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  ensureCanvasTexture(textures, TEX_FLAME_BILLOW, 32, 32, (ctx) => {
    for (const [x, y, radius, alpha] of BILLOW_LOBES) {
      drawSoftLobe(ctx, x, y, radius, radius, alpha);
    }
  });

  ensureCanvasTexture(textures, TEX_FLAME_TONGUE, 32, 16, (ctx) => {
    for (const [x, y, radiusX, radiusY, alpha] of TONGUE_LOBES) {
      drawSoftLobe(ctx, x, y, radiusX, radiusY, alpha);
    }
  });
}

/**
 * Ein weicher, elliptischer Lappen. Die Ellipse entsteht ueber die Transformation, nicht ueber
 * einen zweiten Verlauf: `createRadialGradient` kennt nur Kreise.
 */
function drawSoftLobe(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, radiusY / radiusX);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.55})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(-radiusX, -radiusX, radiusX * 2, radiusX * 2);
  ctx.restore();
}
