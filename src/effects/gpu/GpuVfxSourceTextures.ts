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
export const TEX_DEATH_MORPH_HAZE = '__death_morph_haze';
export const TEX_DEATH_MORPH_VAPOR = '__death_morph_vapor';
export const TEX_DEATH_DUST_MOTE_A = '__death_dust_mote_a';
export const TEX_DEATH_DUST_MOTE_B = '__death_dust_mote_b';
export const TEX_DEATH_DUST_MOTE_C = '__death_dust_mote_c';
export const TEX_DEATH_DUST_MOTE_D = '__death_dust_mote_d';
export const TEX_DEATH_DUST_MOTE_E = '__death_dust_mote_e';
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
 * Acht gleich grosse Alpha-Motive fuer den GPU-seitigen Death-Morph. Der gemeinsame 48px-Rahmen
 * verhindert Groessen-/Pivot-Spruenge beim Framewechsel; nur die belegte Materialform waechst von
 * einem kompakten Kern ueber Staub bis zum diffusen Auslauf. Die Motive bleiben weiss, damit der
 * pro Sprite-Chunk analysierte Member-Tint ueber die gesamte Aufloesung erhalten bleibt.
 *
 * Die Aufloesung ist bewusst doppelt so hoch wie der World-Space-Footprint des Fragments;
 * `DEATH_MORPH_SCALE_COMPENSATION` haelt den Footprint konstant. Der Grund steht in
 * `drawSoftDeathMote`: unterhalb von rund einem Texel rasterisiert der Canvas einen
 * Radialgradienten zu einem harten Einzelpixel, und genau der wird im Spiel wieder aufgezogen.
 */
export function ensureDeathMorphTextures(scene: Phaser.Scene): void {
  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_COMPACT, 48, 48, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath();
    ctx.moveTo(16, 15);
    ctx.lineTo(33, 16);
    ctx.lineTo(32, 33);
    ctx.lineTo(15, 32);
    ctx.closePath();
    ctx.fill();
  });

  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_FRAYED, 48, 48, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(16, 14);
    ctx.lineTo(29, 15);
    ctx.lineTo(34.4, 20.4);
    ctx.lineTo(32, 32.8);
    ctx.lineTo(20.8, 34);
    ctx.lineTo(14, 28.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.fillRect(34, 24.4, 4.4, 3.2);
    ctx.fillRect(12, 17.6, 3.2, 5.2);
    ctx.fillRect(20.8, 10.8, 4.8, 2.8);
  });

  // Ab hier mischen sich weiche Koerner unter die harten Massen. Die Framefolge kann nicht
  // ueberblenden, jeder Wechsel ist ein harter Schnitt - der Uebergang muss deshalb im Motiv
  // selbst liegen: aufeinanderfolgende Frames teilen sich ihr Vokabular, damit der Sprung
  // zwischen ihnen klein bleibt.
  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_POROUS, 48, 48, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(12.8, 14.4, 9.6, 8.4);
    ctx.fillRect(23.6, 12.4, 10.4, 9.2);
    ctx.fillRect(16, 24.4, 8.4, 10.4);
    ctx.fillRect(26, 23.2, 9.6, 8.4);
    ctx.fillStyle = 'rgba(255,255,255,0.58)';
    ctx.fillRect(35.6, 19.2, 4.8, 4.4);
    ctx.fillRect(8.8, 26.8, 5.2, 3.6);
    ctx.fillRect(24.4, 34, 3.6, 4.4);
    // Erste weiche Absplitterungen: sie kuendigen das Kornvokabular der spaeteren Frames an.
    drawSoftDeathMote(ctx, 10.6, 10.4, 1.9, 1.5, 0.3, 0.34);
    drawSoftDeathMote(ctx, 38.4, 30.6, 1.6, 2.0, -0.4, 0.3);
    drawSoftDeathMote(ctx, 19.2, 39.4, 2.0, 1.6, 0.5, 0.28);
  });

  ensureCanvasTexture(scene.textures, TEX_DEATH_MORPH_FRAGMENTED, 48, 48, (ctx) => {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(10, 12.4, 9.2, 7.2);
    ctx.fillRect(22, 8.8, 7.2, 9.6);
    ctx.fillRect(30.4, 18, 8.4, 6.8);
    ctx.fillRect(16.8, 21.2, 8.8, 8.8);
    ctx.fillRect(26.8, 28, 7.2, 8);
    // Die drei kleinen Randstuecke sind jetzt weich: dieselben Massen wie zuvor, aber schon im
    // Kornvokabular des naechsten Frames.
    drawSoftDeathMote(ctx, 8.4, 27.4, 2.4, 2.2, -0.25, 0.5);
    drawSoftDeathMote(ctx, 18.2, 36.4, 2.2, 2.4, 0.4, 0.5);
    drawSoftDeathMote(ctx, 39.8, 31, 1.8, 2.6, -0.5, 0.46);
    drawSoftDeathMote(ctx, 13.4, 8.6, 1.8, 1.5, 0.2, 0.4);
    drawSoftDeathMote(ctx, 34.2, 11.6, 1.6, 2.0, -0.35, 0.36);
    drawSoftDeathMote(ctx, 11.8, 32.4, 2.0, 1.6, 0.55, 0.34);
    drawSoftDeathMote(ctx, 30.4, 38.6, 1.7, 2.1, -0.15, 0.32);
  });

  // Ab hier traegt kein `fillRect` mehr. Die drei ersten Eintraege sind bewusst grosse, weiche
  // Ballen an den Massepositionen des Fragmented-Frames: sie halten die Erinnerung an die
  // Bruchstuecke, waehrend der Rest schon reines Korn ist.
  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_DUST, [
    [14.6, 16, 4.6, 3.6, -0.2, 0.34],
    [21.2, 25.6, 4.4, 4.4, 0.3, 0.3],
    [30.4, 32, 3.6, 4, -0.45, 0.28],
    [7.4, 12.6, 2.9, 2.1, -0.3, 0.76],
    [14.8, 7.8, 2.1, 2.84, 0.5, 0.63],
    [23.8, 11.6, 2.8, 1.84, -0.4, 0.69],
    [33.6, 8.6, 1.72, 2.24, 0.2, 0.54],
    [40.4, 14.4, 2.16, 1.64, -0.5, 0.48],
    [11.2, 22.8, 2.44, 1.84, 0.3, 0.62],
    [19.2, 20.2, 1.56, 2.4, -0.6, 0.45],
    [28.4, 19, 2.08, 1.48, 0.2, 0.57],
    [36.4, 23.6, 2.5, 1.72, 0.55, 0.46],
    [6.8, 33, 1.76, 2.16, -0.2, 0.44],
    [14.6, 30.6, 2.32, 1.48, 0.5, 0.61],
    [24.2, 29.8, 1.72, 2.24, -0.5, 0.39],
    [32.2, 33, 2.16, 1.6, 0.3, 0.52],
    [41.8, 31, 1.36, 1.96, -0.2, 0.34],
    [19.2, 38.6, 1.84, 1.24, -0.3, 0.42],
    [29, 39.2, 2.44, 1.4, 0.6, 0.47],
    [37.4, 38.2, 1.24, 1.24, 0, 0.28],
    [4.2, 19.4, 1.28, 1.02, 0.4, 0.34],
    [11, 4.6, 1.06, 1.34, -0.5, 0.3],
    [19.6, 14.2, 1.5, 1.1, 0.2, 0.41],
    [28.6, 5.4, 1.12, 1.44, 0.6, 0.28],
    [37, 4.2, 1.34, 1.06, -0.3, 0.25],
    [44, 20.6, 1.06, 1.5, 0.1, 0.29],
    [7.6, 27.4, 1.44, 1.08, -0.6, 0.37],
    [16.4, 26.2, 1.1, 1.38, 0.35, 0.33],
    [24, 24.4, 1.52, 1.12, -0.25, 0.4],
    [32.6, 27, 1.16, 1.46, 0.5, 0.31],
    [40.2, 28.2, 1.3, 1, -0.4, 0.27],
    [4.8, 38.4, 1.02, 1.28, 0.15, 0.24],
    [10.8, 36.2, 1.42, 1.06, -0.35, 0.35],
    [21.6, 34.2, 1.1, 1.4, 0.45, 0.3],
    [34.4, 35.6, 1.36, 1.04, -0.15, 0.32],
    [26.2, 43.6, 1.2, 1, 0.3, 0.22],
    [43.4, 40, 1.04, 1.3, -0.5, 0.2],
  ]);

  // Die beiden ersten Eintraege sind ein sehr schwacher Wolkenansatz an den Lappenpositionen des
  // Haze-Frames. Er ist hier kaum sichtbar, macht den anschliessenden Wechsel auf die volle
  // Staubwolke aber zu einer Verdichtung statt zu einem Motivwechsel.
  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_FINE_DUST, [
    [21, 23, 10, 8, -0.2, 0.08],
    [28, 28, 8, 9, 0.3, 0.07],
    [5.2, 8.8, 1.42, 1.06, -0.3, 0.42],
    [11, 4.4, 1.08, 1.32, 0.1, 0.34],
    [16.4, 10.2, 1.5, 1.04, 0.5, 0.29],
    [23.4, 5.8, 1.16, 1.48, -0.5, 0.39],
    [30.8, 8.2, 1.46, 1.02, 0.2, 0.31],
    [38.6, 5.4, 1.04, 1.36, -0.1, 0.35],
    [42.8, 13, 1.38, 1.08, 0.6, 0.24],
    [8.8, 17, 1.34, 1.02, -0.2, 0.3],
    [14.2, 21, 1.02, 1.52, 0.4, 0.38],
    [20.4, 16.4, 1.56, 1.06, -0.6, 0.27],
    [27.4, 21.8, 1.1, 1.44, 0.2, 0.33],
    [34.4, 17.2, 1.48, 1, -0.4, 0.26],
    [41.4, 22.6, 1, 1.34, 0.1, 0.32],
    [5.6, 30.4, 1.12, 1.02, 0.2, 0.22],
    [11.4, 36.6, 1.54, 1.06, -0.5, 0.31],
    [18.6, 29.8, 1.02, 1.4, 0.6, 0.26],
    [25.6, 34.8, 1.4, 1.02, -0.2, 0.33],
    [32.6, 29.6, 1.02, 1.5, 0.4, 0.25],
    [38.4, 37.4, 1.36, 1, -0.6, 0.28],
    [44, 32.2, 1, 1.24, 0.1, 0.21],
    [15.6, 42.4, 1.1, 1, 0.5, 0.2],
    [29, 42.6, 1.02, 1.3, -0.3, 0.24],
    [36.2, 42.2, 1.3, 1, 0.2, 0.19],
    [2.6, 14.6, 1.06, 1.3, -0.45, 0.23],
    [8, 12, 1.28, 1.02, 0.3, 0.28],
    [19.8, 2.8, 1.02, 1.22, 0.15, 0.2],
    [27, 12.4, 1.34, 1.06, -0.35, 0.3],
    [34.6, 11.6, 1.06, 1.4, 0.45, 0.26],
    [45.2, 8.4, 1.2, 1, -0.2, 0.18],
    [3.4, 22.4, 1.24, 1.04, 0.55, 0.22],
    [11.6, 25.6, 1.06, 1.36, -0.25, 0.29],
    [17.6, 24, 1.42, 1.02, 0.35, 0.24],
    [24, 26.4, 1.02, 1.28, -0.55, 0.31],
    [30.6, 25, 1.3, 1.04, 0.25, 0.23],
    [37.4, 26.2, 1.04, 1.44, -0.15, 0.27],
    [44.6, 26.8, 1.18, 1, 0.4, 0.17],
    [2.8, 35, 1, 1.26, -0.3, 0.19],
    [8.4, 41.2, 1.32, 1.02, 0.5, 0.22],
    [14.8, 33.4, 1.04, 1.38, -0.4, 0.28],
    [22, 38.6, 1.26, 1, 0.15, 0.21],
    [28.2, 31.2, 1.02, 1.32, 0.6, 0.26],
    [35, 34.6, 1.36, 1.04, -0.25, 0.24],
    [41, 44, 1, 1.2, 0.3, 0.16],
    [21.4, 45.6, 1.14, 1, -0.5, 0.17],
    [33.4, 45.8, 1, 1.24, 0.2, 0.18],
    [45, 38.6, 1.22, 1.02, -0.35, 0.16],
  ]);

  // Die tragende Staubwolke. Sieben stark ueberlappende Lappen um die Frame-Mitte ergeben eine
  // zusammenhaengende Flaeche statt einzelner Blasen; die restlichen Koerner sind bewusst gross
  // und schwach, damit sie als Textur innerhalb der Wolke lesen und nicht als Punkte davor.
  // Das Member-Alpha steht in dieser Phase nur noch bei rund 0,88 bis 0,33 (CubicIn), deshalb
  // liegen die Texturwerte deutlich hoeher als bei den kornigen Frames davor.
  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_HAZE, [
    [20, 21, 13, 10, -0.3, 0.34],
    [28, 24, 11, 13, 0.4, 0.3],
    [22, 30, 14, 10, 0.15, 0.28],
    [31, 31, 9, 8, -0.5, 0.24],
    [15, 28, 9, 10, 0.55, 0.26],
    [26, 16, 10, 7.5, -0.2, 0.22],
    [17, 17, 8, 9, 0.35, 0.2],
    [8.6, 15.4, 2.4, 1.8, 0.3, 0.13],
    [38.4, 18.2, 2, 2.6, -0.4, 0.12],
    [12.2, 36.8, 2.6, 1.9, 0.5, 0.12],
    [36.6, 35.4, 1.9, 2.4, -0.25, 0.11],
    [24.8, 8.4, 2.2, 1.7, 0.2, 0.1],
    [23.6, 40.2, 1.8, 2.3, -0.55, 0.1],
  ]);

  // Reiner Auslauf: vier sehr breite Lappen ohne jedes Korn. Das Member-Alpha faellt hier von
  // rund 0,33 auf 0, der Tail bleibt also duenn, obwohl die Texturwerte hoeher liegen als zuvor.
  drawDeathMorphDustTexture(scene, TEX_DEATH_MORPH_VAPOR, [
    [22, 24, 19, 16, -0.25, 0.26],
    [30, 27, 15, 18, 0.45, 0.22],
    [17, 29, 14, 13, 0.2, 0.2],
    [25, 18, 13, 11, 0.5, 0.16],
  ]);
}

/** Kleine Einzelmoten fuer die statischen Micro-Fragmente; fuenf Varianten gegen Wiederholung. */
export function ensureDeathDustMoteTextures(scene: Phaser.Scene): void {
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_A, [
    [24.2, 23.6, 4.2, 2.68, -0.28, 0.7],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_B, [
    [17.6, 24.6, 2.56, 1.56, 0.34, 0.62],
    [31.8, 20.2, 1.24, 2.1, -0.45, 0.42],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_C, [
    [14.4, 16.8, 1.64, 1.12, -0.2, 0.5],
    [25.6, 30.4, 1.16, 1.52, 0.5, 0.36],
    [34.2, 15.2, 1.05, 1.05, -0.1, 0.3],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_D, [
    [19.4, 21.2, 3.1, 1.5, 0.42, 0.58],
    [30.6, 27.8, 1.7, 2.6, -0.3, 0.44],
    [25, 14.6, 1.3, 1.1, 0.15, 0.3],
  ]);
  drawDeathMorphDustTexture(scene, TEX_DEATH_DUST_MOTE_E, [
    [15.8, 19.4, 1.5, 1.15, -0.35, 0.5],
    [24.6, 25.2, 1.25, 1.6, 0.28, 0.44],
    [32.4, 18.6, 1.35, 1.05, 0.55, 0.38],
    [21, 32.4, 1.1, 1.4, -0.15, 0.32],
    [33, 32, 1.2, 1.1, 0.4, 0.26],
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
  ensureCanvasTexture(scene.textures, key, 48, 48, (ctx) => {
    for (const [x, y, radiusX, radiusY, rotation, alpha] of motes) {
      drawSoftDeathMote(ctx, x, y, radiusX, radiusY, rotation, alpha);
    }
  });
}

/**
 * Ein weiches Staubkorn als rotierte, elliptisch skalierte Radialscheibe.
 *
 * `radiusX`/`radiusY` sind Texel im 48px-Rahmen und muessen ueber rund 1.0 bleiben: darunter
 * rasterisiert der Canvas den Gradienten zu ein bis zwei vollflaechigen Pixeln, und der
 * World-Space-Footprint des Fragments zieht genau diesen Pixel wieder auf. Das ist der Grund,
 * warum die Morph-Quellen doppelt so hoch aufgeloest sind wie ihr sichtbarer Footprint.
 */
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

  // Fuenf Stops statt vier: bei der hoeheren Aufloesung ist der Abfall gross genug, dass die
  // groebere Kurve als sichtbarer Ring gelesen wurde.
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.3, `rgba(255,255,255,${alpha * 0.78})`);
  gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.46})`);
  gradient.addColorStop(0.78, `rgba(255,255,255,${alpha * 0.18})`);
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
