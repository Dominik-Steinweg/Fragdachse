import * as Phaser from 'phaser';
import { ensureCanvasTexture } from '../EffectUtils';

/**
 * Die prozeduralen Quelltexturen der GPU-VFX-Partikel – an einer Stelle, damit sowohl die
 * Effektrenderer als auch der Atlas-Builder sie erzeugen koennen, ohne sich gegenseitig zu
 * importieren.
 *
 * Die Zeichenoperationen sind unveraendert aus den Renderern uebernommen; der Atlas kopiert die
 * fertigen Texturen anschliessend pixelgenau in ein gemeinsames Bild. Die Einzeltexturen bleiben
 * bestehen: `stink_puff` wird weiterhin vom klassischen Spawn-Burst-Emitter benutzt, und der
 * Blit braucht ohnehin eine Quelle.
 */

export const TEX_AIRSTRIKE_BOMB  = '__airstrike_bomb';
export const TEX_AIRSTRIKE_SPARK = '__airstrike_warn';
export const TEX_ROCKET_SMOKE    = '__rocket_smoke';
export const TEX_ROCKET_EXHAUST  = '__rocket_exhaust';
export const TEX_STINK_PUFF      = 'stink_puff';
export const TEX_GROUND_FIRE_SMOKE = '__ground_fire_smoke';
export const TEX_LEAF_DEBRIS     = '__leaf_blower_leaf';
export const TEX_LEAF_BLOWER_DUST = '__leaf_blower_dust';

/** Bestehendes Leaf-Motiv als Atlas-Quelltextur. */
export function ensureLeafDebrisTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_LEAF_DEBRIS, 24, 18, (ctx) => {
    ctx.translate(12, 9);
    ctx.rotate(-0.28);
    ctx.fillStyle = '#8aa357';
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.quadraticCurveTo(-2, -8, 8, -2);
    ctx.quadraticCurveTo(10, 0, 8, 2);
    ctx.quadraticCurveTo(-2, 8, -9, 0);
    ctx.fill();
    ctx.strokeStyle = '#d8c97a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-7, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  });
}

/** Kleine weiche, bewusst farbneutrale Staubwolke fuer den LeafBlower. */
export function ensureLeafBlowerDustTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_LEAF_BLOWER_DUST, 18, 18, (ctx) => {
    const gradient = ctx.createRadialGradient(9, 9, 1, 9, 9, 9);
    gradient.addColorStop(0, 'rgba(148,148,148,0.92)');
    gradient.addColorStop(0.62, 'rgba(184,184,184,0.72)');
    gradient.addColorStop(0.82, 'rgba(216,216,216,0.30)');
    gradient.addColorStop(1, 'rgba(216,216,216,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(3, 8);
    ctx.quadraticCurveTo(5, 3, 9, 4);
    ctx.quadraticCurveTo(14, 2, 15, 8);
    ctx.quadraticCurveTo(17, 12, 12, 14);
    ctx.quadraticCurveTo(7, 17, 4, 13);
    ctx.quadraticCurveTo(1, 11, 3, 8);
    ctx.closePath();
    ctx.fill();
  });
}

/** Kantenlaenge der Wolkenpartikel-Textur und ihre Rasterweite. */
const PUFF_SIZE = 40;
const PUFF_PX   = 2;

/** Bomben-Silhouette (8x20 px). */
export function ensureAirstrikeBombTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_AIRSTRIKE_BOMB, 8, 20, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 20);
    g.addColorStop(0,   'rgba(255,255,255,0.0)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.65)');
    g.addColorStop(1,   'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 20);
  });
}

/** Warnsignal-Partikel am Boden (8x8 px). */
export function ensureAirstrikeSparkTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_AIRSTRIKE_SPARK, 8, 8, (ctx) => {
    const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
    grad.addColorStop(0,   'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 8);
  });
}

/** Rauchschwade der Rakete (24x24 px). */
export function ensureRocketSmokeTexture(scene: Phaser.Scene): void {
  const s = 24;
  ensureCanvasTexture(scene.textures, TEX_ROCKET_SMOKE, s, s, (ctx) => {
    const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(190, 198, 202, 0.45)');
    grad.addColorStop(0.55, 'rgba(120, 136, 145, 0.22)');
    grad.addColorStop(1, 'rgba(70, 80, 88, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Rauchschwade des Bodenfeuers (48x48 px). */
export function ensureGroundFireSmokeTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_GROUND_FIRE_SMOKE, 48, 48, (ctx) => {
    const gradient = ctx.createRadialGradient(24, 24, 2, 24, 24, 24);
    gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(0.45, 'rgba(230,230,230,0.23)');
    gradient.addColorStop(1, 'rgba(200,200,200,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 48, 48);
  });
}

/** Triebwerksfunke der Rakete (18x18 px). */
export function ensureRocketExhaustTexture(scene: Phaser.Scene): void {
  const s = 18;
  ensureCanvasTexture(scene.textures, TEX_ROCKET_EXHAUST, s, s, (ctx) => {
    const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.25, 'rgba(255,224,132,0.95)');
    grad.addColorStop(0.6, 'rgba(255,129,48,0.4)');
    grad.addColorStop(1, 'rgba(255,90,0,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Wolkenpartikel (40x40 px, 2-px-Raster mit wobbeligem Rand). */
export function ensureStinkPuffTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_STINK_PUFF, PUFF_SIZE, PUFF_SIZE, (ctx) => {
    const half = PUFF_SIZE / 2;
    const maxR = half - PUFF_PX * 2;

    ctx.clearRect(0, 0, PUFF_SIZE, PUFF_SIZE);

    for (let py = 0; py < PUFF_SIZE; py += PUFF_PX) {
      for (let px = 0; px < PUFF_SIZE; px += PUFF_PX) {
        const sx = px + PUFF_PX / 2 - half;
        const sy = py + PUFF_PX / 2 - half;
        const angle = Math.atan2(sy, sx);
        const wobble = Math.sin(angle * 5.1 + 0.8) * 0.08 + Math.cos(angle * 2.7 - 0.5) * 0.04;
        const d = Math.hypot(sx, sy) / maxR;
        if (d > 1.05 + wobble) continue;
        const a = d < 0.24 ? 0.74
                : d < 0.48 ? 0.46
                : d < 0.72 ? 0.22
                :            0.07;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(px, py, PUFF_PX, PUFF_PX);
      }
    }
  });
}
