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
export const TEX_EXPLOSION_SPARK = '__explosion_spark';
export const TEX_EXPLOSION_EMBER = '__explosion_ember';
export const TEX_EXPLOSION_FIREBALL_A = '__explosion_fireball_a';
export const TEX_EXPLOSION_FIREBALL_B = '__explosion_fireball_b';
export const TEX_EXPLOSION_CORE = '__explosion_core';
export const TEX_EXPLOSION_SMOKE = '__explosion_smoke';
export const TEX_EXPLOSION_STREAK = '__explosion_streak';
export const TEX_EXPLOSION_CHUNK = '__explosion_chunk';
export const TEX_EXPLOSION_RING = '__explosion_ring';
export const TEX_DEATH_FRAGMENT = '__death_fragment';
export const TEX_DEATH_GLOW = '__death_glow';
export const TEX_MUZZLE_FLASH = '__muzzle_flash';
export const TEX_MUZZLE_ENERGY = '__muzzle_energy';
export const TEX_MUZZLE_SPARK = '__muzzle_spark';

/** Weisses Fragmentquadrat: Farbe, Groesse und Streckung kommen aus dem GPU-Member. */
export function ensureDeathFragmentTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_DEATH_FRAGMENT, 4, 4, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, 4, 4);
  });
}

/** Weicher Additive-Glow fuer wenige helle Disintegrationssplitter. */
export function ensureDeathGlowTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_DEATH_GLOW, 24, 24, (ctx) => {
    const gradient = ctx.createRadialGradient(12, 12, 1, 12, 12, 12);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.52)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 24, 24);
  });
}

/** Bestehendes Muzzle-Flash-Motiv; die Zeichenwerte bleiben pixelgleich zum alten Renderer. */
export function ensureMuzzleFlashTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_MUZZLE_FLASH, 32, 18, (ctx) => {
    const grad = ctx.createRadialGradient(10, 9, 0, 10, 9, 14);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.28, 'rgba(255,236,180,0.96)');
    grad.addColorStop(0.6, 'rgba(255,170,88,0.44)');
    grad.addColorStop(1, 'rgba(255,128,48,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(2, 9);
    ctx.lineTo(29, 2);
    ctx.lineTo(23, 9);
    ctx.lineTo(29, 16);
    ctx.closePath();
    ctx.fill();
  });
}

/** Bestehendes Muzzle-Spark-Motiv; die Zeichenwerte bleiben pixelgleich zum alten Renderer. */
export function ensureMuzzleSparkTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_MUZZLE_SPARK, 8, 8, (ctx) => {
    const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.45, 'rgba(255,220,160,0.72)');
    grad.addColorStop(1, 'rgba(255,120,40,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 8, 8);
  });
}

/** Bestehendes Energy-Core-Motiv; die Zeichenwerte bleiben pixelgleich zum alten Renderer. */
export function ensureMuzzleEnergyTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_MUZZLE_ENERGY, 36, 24, (ctx) => {
    const grad = ctx.createRadialGradient(11, 12, 0, 11, 12, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.35, 'rgba(212,248,255,0.92)');
    grad.addColorStop(0.68, 'rgba(115,190,211,0.32)');
    grad.addColorStop(1, 'rgba(115,190,211,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(3, 12);
    ctx.lineTo(33, 4);
    ctx.lineTo(25, 12);
    ctx.lineTo(33, 20);
    ctx.closePath();
    ctx.fill();
  });
}

/** Erzeugt alle Muzzle-Quellen gemeinsam, damit der Atlas sie vor den Lanes vorfindet. */
export function ensureMuzzleFlashTextures(scene: Phaser.Scene): void {
  ensureMuzzleFlashTexture(scene);
  ensureMuzzleEnergyTexture(scene);
  ensureMuzzleSparkTexture(scene);
}

/** Weicher Funkenpunkt fuer die Explosionen. */
export function ensureExplosionSparkTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_SPARK, 6, 6, (ctx) => {
    const gradient = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 6, 6);
  });
}

/** Solider weisser Glutblock fuer die Explosionen. */
export function ensureExplosionEmberTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_EMBER, 4, 4, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, 4, 4);
  });
}

/**
 * Unregelmaessige, farbneutrale Feuerballen. Die zwei Varianten teilen Groesse und Mittelalpha,
 * unterscheiden sich aber in ihrer Silhouette, damit ein Burst nicht wie gestapelte Kreise liest.
 */
export function ensureExplosionFireballTextures(scene: Phaser.Scene): void {
  drawExplosionBlob(scene, TEX_EXPLOSION_FIREBALL_A, [
    0.82, 0.94, 0.78, 0.9, 0.76, 0.98, 0.8, 0.92, 0.74, 0.88, 0.79, 0.96,
  ]);
  drawExplosionBlob(scene, TEX_EXPLOSION_FIREBALL_B, [
    0.91, 0.75, 0.96, 0.8, 0.89, 0.72, 0.93, 0.81, 0.98, 0.77, 0.87, 0.74,
  ]);
}

/** Heisser, dichter Kern mit weichem Rand fuer den ersten Detonationsframe. */
export function ensureExplosionCoreTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_CORE, 32, 32, (ctx) => {
    const gradient = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.34, 'rgba(255,255,255,0.96)');
    gradient.addColorStop(0.7, 'rgba(255,255,255,0.46)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
  });
}

/** Weiche, leicht asymmetrische Rauchwolke ohne harte Frame-Kante. */
export function ensureExplosionSmokeTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_SMOKE, 56, 56, (ctx) => {
    const lobes = [
      [27, 29, 23], [19, 25, 16], [36, 23, 15], [34, 36, 14], [20, 38, 12],
    ] as const;
    for (const [x, y, radius] of lobes) {
      const gradient = ctx.createRadialGradient(x, y, 1, x, y, radius);
      gradient.addColorStop(0, 'rgba(255,255,255,0.34)');
      gradient.addColorStop(0.55, 'rgba(255,255,255,0.18)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  });
}

/** Horizontaler Funkenstrich; Rotation und Streckung richten ihn pro Member an der Flugbahn aus. */
export function ensureExplosionStreakTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_STREAK, 24, 8, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 4, 24, 4);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(0.72, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 2, 24, 4);
  });
}

/** Kantiger Glutbrocken mit transparenten Ecken statt des bisherigen Vollblocks. */
export function ensureExplosionChunkTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_CHUNK, 16, 16, (ctx) => {
    const gradient = ctx.createRadialGradient(8, 8, 1, 8, 8, 8);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.62, 'rgba(255,255,255,0.9)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(4, 2);
    ctx.lineTo(12, 3);
    ctx.lineTo(15, 8);
    ctx.lineTo(11, 14);
    ctx.lineTo(4, 13);
    ctx.lineTo(1, 7);
    ctx.closePath();
    ctx.fill();
  });
}

/** Weicher Druckwellenring; seine sichtbare Aussengrenze erreicht den uebergebenen Radius. */
export function ensureExplosionRingTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_EXPLOSION_RING, 64, 64, (ctx) => {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.82, 'rgba(255,255,255,0.78)');
    gradient.addColorStop(0.92, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  });
}

function drawExplosionBlob(scene: Phaser.Scene, key: string, radii: readonly number[]): void {
  const size = 48;
  const half = size / 2;
  const safeRadius = half - 3.5;

  ensureCanvasTexture(scene.textures, key, size, size, (ctx) => {
    // Eine breite Grundwolke hält die Mitte geschlossen. Sie läuft vor dem Sicherheitsrand
    // aus, damit die Frame-Kante auch beim additiven Stapeln unsichtbar bleibt.
    const body = ctx.createRadialGradient(half - 2.5, half - 3, 0, half - 1, half - 1.5, safeRadius * 0.72);
    body.addColorStop(0, 'rgba(255,255,255,0.78)');
    body.addColorStop(0.34, 'rgba(255,255,255,0.7)');
    body.addColorStop(0.68, 'rgba(255,255,255,0.42)');
    body.addColorStop(0.9, 'rgba(255,255,255,0.1)');
    body.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, size, size);

    // Die ueberlappenden, weich auslaufenden Lobes ersetzen die alte harte Polygon-Clipmaske.
    // Die leicht unterschiedlichen Radien bleiben die authored Silhouettenvariation von A/B.
    for (let index = 0; index < radii.length; index += 1) {
      const lobeScale = radii[index];
      const angle = (index / radii.length) * Math.PI * 2 + (lobeScale - 0.85) * 0.18;
      const centerRadius = safeRadius * (0.15 + (1 - lobeScale) * 0.12);
      const lobeRadius = safeRadius * (0.58 + lobeScale * 0.24);
      const x = half + Math.cos(angle) * centerRadius;
      const y = half + Math.sin(angle) * centerRadius;
      const lobe = ctx.createRadialGradient(x, y, 0, x, y, lobeRadius);
      lobe.addColorStop(0, 'rgba(255,255,255,0.5)');
      lobe.addColorStop(0.38, 'rgba(255,255,255,0.42)');
      lobe.addColorStop(0.72, 'rgba(255,255,255,0.2)');
      lobe.addColorStop(0.92, 'rgba(255,255,255,0.035)');
      lobe.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lobe;
      ctx.fillRect(x - lobeRadius, y - lobeRadius, lobeRadius * 2, lobeRadius * 2);
    }
  });
}

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
