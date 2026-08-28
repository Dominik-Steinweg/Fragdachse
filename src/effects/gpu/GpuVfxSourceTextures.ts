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
export const TEX_DEATH_MORPH_COMPACT = '__death_morph_compact';
export const TEX_DEATH_MORPH_FRAYED = '__death_morph_frayed';
export const TEX_DEATH_MORPH_POROUS = '__death_morph_porous';
export const TEX_DEATH_MORPH_FRAGMENTED = '__death_morph_fragmented';
export const TEX_DEATH_MORPH_DUST = '__death_morph_dust';
export const TEX_DEATH_MORPH_FINE_DUST = '__death_morph_fine_dust';
export const TEX_DEATH_DUST_MOTE_A = '__death_dust_mote_a';
export const TEX_DEATH_DUST_MOTE_B = '__death_dust_mote_b';
export const TEX_DEATH_DUST_MOTE_C = '__death_dust_mote_c';
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

/**
 * Sechs gleich grosse Alpha-Motive fuer den GPU-seitigen Death-Morph. Der gemeinsame 24px-Rahmen
 * verhindert Groessen-/Pivot-Spruenge beim Framewechsel; nur die belegte Materialform waechst von
 * einem kompakten 8px-Kern zu locker verteiltem Staub. Die Motive bleiben weiss, damit der pro
 * Sprite-Chunk analysierte Member-Tint ueber die gesamte Aufloesung erhalten bleibt.
 */
export function ensureDeathMorphTextures(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_COMPACT, 24, 24, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.moveTo(8, 7.5);
    ctx.lineTo(16.5, 8);
    ctx.lineTo(16, 16.5);
    ctx.lineTo(7.5, 16);
    ctx.closePath();
    ctx.fill();
  });

  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_FRAYED, 24, 24, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(8, 7);
    ctx.lineTo(14.5, 7.5);
    ctx.lineTo(17.2, 10.2);
    ctx.lineTo(16, 16.4);
    ctx.lineTo(10.4, 17);
    ctx.lineTo(7, 14.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillRect(17, 12.2, 2.2, 1.6);
    ctx.fillRect(6, 8.8, 1.6, 2.6);
    ctx.fillRect(10.4, 5.4, 2.4, 1.4);
  });

  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_POROUS, 24, 24, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(6.4, 7.2, 4.8, 4.2);
    ctx.fillRect(11.8, 6.2, 5.2, 4.6);
    ctx.fillRect(8, 12.2, 4.2, 5.2);
    ctx.fillRect(13, 11.6, 4.8, 4.2);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillRect(17.8, 9.6, 2.4, 2.2);
    ctx.fillRect(4.4, 13.4, 2.6, 1.8);
    ctx.fillRect(12.2, 17, 1.8, 2.2);
  });

  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_FRAGMENTED, 24, 24, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(5, 6.2, 4.6, 3.6);
    ctx.fillRect(11, 4.4, 3.6, 4.8);
    ctx.fillRect(15.2, 9, 4.2, 3.4);
    ctx.fillRect(8.4, 10.6, 4.4, 4.4);
    ctx.fillRect(13.4, 14, 3.6, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(3, 12.6, 2.4, 2.2);
    ctx.fillRect(8, 17, 2.2, 2.4);
    ctx.fillRect(19, 14.2, 1.8, 2.6);
  });

  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_DUST, [
    [3.7, 6.3, 1.45, 1.05, -0.3, 0.76],
    [7.4, 3.9, 1.05, 1.42, 0.5, 0.63],
    [11.9, 5.8, 1.4, 0.92, -0.4, 0.69],
    [16.8, 4.3, 0.86, 1.12, 0.2, 0.54],
    [20.2, 7.2, 1.08, 0.82, -0.5, 0.48],
    [5.6, 11.4, 1.22, 0.92, 0.3, 0.62],
    [9.6, 10.1, 0.78, 1.2, -0.6, 0.45],
    [14.2, 9.5, 1.04, 0.74, 0.2, 0.57],
    [18.2, 11.8, 1.25, 0.86, 0.55, 0.46],
    [3.4, 16.5, 0.88, 1.08, -0.2, 0.44],
    [7.3, 15.3, 1.16, 0.74, 0.5, 0.61],
    [12.1, 14.9, 0.86, 1.12, -0.5, 0.39],
    [16.1, 16.5, 1.08, 0.8, 0.3, 0.52],
    [20.9, 15.5, 0.68, 0.98, -0.2, 0.34],
    [9.6, 19.3, 0.92, 0.62, -0.3, 0.42],
    [14.5, 19.6, 1.22, 0.7, 0.6, 0.47],
    [18.7, 19.1, 0.62, 0.62, 0, 0.28],
  ]);

  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_FINE_DUST, [
    [2.6, 4.4, 0.38, 0.52, -0.3, 0.47],
    [5.5, 2.2, 0.3, 0.34, 0.1, 0.38],
    [8.2, 5.1, 0.46, 0.3, 0.5, 0.31],
    [11.7, 2.9, 0.34, 0.48, -0.5, 0.43],
    [15.4, 4.1, 0.48, 0.3, 0.2, 0.34],
    [19.3, 2.7, 0.3, 0.42, -0.1, 0.39],
    [21.4, 6.5, 0.44, 0.32, 0.6, 0.26],
    [4.4, 8.5, 0.42, 0.3, -0.2, 0.33],
    [7.1, 10.5, 0.3, 0.5, 0.4, 0.42],
    [10.2, 8.2, 0.48, 0.32, -0.6, 0.3],
    [13.7, 10.9, 0.34, 0.46, 0.2, 0.37],
    [17.2, 8.6, 0.46, 0.3, -0.4, 0.29],
    [20.7, 11.3, 0.3, 0.42, 0.1, 0.35],
    [2.8, 15.2, 0.34, 0.3, 0.2, 0.24],
    [5.7, 18.3, 0.48, 0.32, -0.5, 0.34],
    [9.3, 14.9, 0.3, 0.44, 0.6, 0.29],
    [12.8, 17.4, 0.44, 0.3, -0.2, 0.36],
    [16.3, 14.8, 0.3, 0.48, 0.4, 0.28],
    [19.2, 18.7, 0.42, 0.3, -0.6, 0.31],
    [22, 16.1, 0.28, 0.38, 0.1, 0.23],
    [7.8, 21.2, 0.34, 0.28, 0.5, 0.22],
    [14.5, 21.3, 0.3, 0.4, -0.3, 0.26],
    [18.1, 21.1, 0.4, 0.26, 0.2, 0.2],
  ]);
}

/** Kleine Einzelmoten fuer die letzten, statischen Micro-Fragmente. */
export function ensureDeathDustMoteTextures(scene: Phaser.Scene): void {
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_A, [
    [12.1, 11.8, 2.1, 1.34, -0.28, 0.7],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_B, [
    [8.8, 12.3, 1.28, 0.78, 0.34, 0.62],
    [15.9, 10.1, 0.62, 1.05, -0.45, 0.42],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_C, [
    [7.2, 8.4, 0.82, 0.56, -0.2, 0.5],
    [12.8, 15.2, 0.58, 0.76, 0.5, 0.36],
    [17.1, 7.6, 0.46, 0.46, -0.1, 0.3],
  ]);
}

type DeathDustMoteSpec = readonly [
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  alpha: number,
];

function drawDeathMorphDustTexture(
  scene: Phaser.Scene,
  key: string,
  motes: readonly DeathDustMoteSpec[],
): void {
  ensureCanvasTexture(scene.textures, key, 24, 24, (ctx) => {
    for (const [x, y, radiusX, radiusY, rotation, alpha] of motes) {
      drawSoftDeathMote(ctx, x, y, radiusX, radiusY, rotation, alpha);
    }
  });
}

function drawSoftDeathMote(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
  alpha: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(radiusX, radiusY);

  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.34, `rgba(255,255,255,${alpha * 0.72})`);
  gradient.addColorStop(0.74, `rgba(255,255,255,${alpha * 0.22})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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

/** Bestehendes Muzzle-Flash-Motiv mit etwas dichterem, weiterhin weich auslaufendem Mittelbereich. */
export function ensureMuzzleFlashTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_MUZZLE_FLASH, 32, 18, (ctx) => {
    const grad = ctx.createRadialGradient(10, 9, 0, 10, 9, 14);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.27, 'rgba(255,238,190,0.98)');
    grad.addColorStop(0.52, 'rgba(255,188,102,0.62)');
    grad.addColorStop(0.78, 'rgba(255,138,50,0.18)');
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

/** Bestehendes Energy-Core-Motiv mit analog verdichtetem, weich auslaufendem Mittelbereich. */
export function ensureMuzzleEnergyTexture(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_MUZZLE_ENERGY, 36, 24, (ctx) => {
    const grad = ctx.createRadialGradient(11, 12, 0, 11, 12, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.32, 'rgba(218,250,255,0.96)');
    grad.addColorStop(0.58, 'rgba(115,196,220,0.46)');
    grad.addColorStop(0.82, 'rgba(105,177,204,0.12)');
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
