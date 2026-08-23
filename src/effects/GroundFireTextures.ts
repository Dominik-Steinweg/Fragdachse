import type Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

/**
 * Die Motivfamilien des Bodenfeuers. Alle sind **weiss**: die Farbe kommt erst aus dem
 * Multiply-Tint, damit dieselben Frames den normalen wie den Void-Stil tragen.
 *
 * - `surface` – drei organische Wolkenfelder, die *alle* Flammenschichten benutzen.
 * - `bed` – zwei breite, asymmetrische Formen fuer die flaechige Grundglut.
 *
 * ## Warum ein Wolkenfeld und keine Flammensilhouette
 *
 * Ein Zwischenstand hat jeder Schicht eine eigene Form gegeben, unter anderem eine zur Spitze
 * verjuengte Zunge. Additiv gestapelt bleibt eine Silhouette ein erkennbarer Einzelkoerper: die
 * Flaeche zerfiel sichtbar in Keile und wirkte hektisch. Ein Motiv, das *verschmelzen* soll,
 * darf keine Kontur haben – Intensitaet kommt aus Alpha und Dichte, nicht aus Form.
 *
 * ## Warum die Alpha am Frame-Rand exakt 0 sein muss
 *
 * Das Vorgaengermotiv war 32 px gross und legte seinen Verlauf auf Radius 21 aus – an der
 * Bildkante stand damit noch rund 0.15 Alpha, die der Frame hart abschnitt. Additiv und
 * hochskaliert ergab das die eckigen Kanten einer grossen Brandflaeche. Beide Funktionen hier
 * multiplizieren deshalb ein Fenster auf, das vor der Frame-Kante auf 0 laeuft.
 */

export const TEX_GROUND_FIRE_SURFACE = '__ground_fire_surface';
export const TEX_GROUND_FIRE_SURFACE_B = '__ground_fire_surface_b';
export const TEX_GROUND_FIRE_SURFACE_C = '__ground_fire_surface_c';
export const TEX_GROUND_FIRE_BED     = '__ground_fire_bed';
export const TEX_GROUND_FIRE_BED_B   = '__ground_fire_bed_b';

export const GROUND_FIRE_SURFACE_TEXTURES = [
  TEX_GROUND_FIRE_SURFACE,
  TEX_GROUND_FIRE_SURFACE_B,
  TEX_GROUND_FIRE_SURFACE_C,
] as const;
export const GROUND_FIRE_BED_TEXTURES = [TEX_GROUND_FIRE_BED, TEX_GROUND_FIRE_BED_B] as const;

/**
 * Native Kantenlaengen. Der Atlas und der Renderer lesen sie hier, damit Frame-Groesse und
 * Motivgroesse nicht an zwei Stellen gepflegt werden muessen.
 *
 * 64 px statt der frueheren 32: die Motive werden auf 2.5 bis 2.7 Rasterzellen (40 bis 43 px)
 * gezogen, eine 32-px-Quelle wurde dabei hochskaliert und zeigte ihre Verlaufsstufen.
 */
export const GROUND_FIRE_SURFACE_SIZE = 64;
export const GROUND_FIRE_BED_SIZE     = 64;
export const GROUND_FIRE_SURFACE_VARIANT_COUNT = GROUND_FIRE_SURFACE_TEXTURES.length;
export const GROUND_FIRE_BED_VARIANT_COUNT = GROUND_FIRE_BED_TEXTURES.length;

/** Deterministischer Hash; die Motive muessen ueber Builds und Clients identisch sein. */
function hashUnit(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smoothStepUnit(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear interpoliertes Wertrauschen auf dem Einheitsgitter. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothStepUnit(x - ix);
  const fy = smoothStepUnit(y - iy);
  const top = hashUnit(ix, iy, seed) + (hashUnit(ix + 1, iy, seed) - hashUnit(ix, iy, seed)) * fx;
  const bottom = hashUnit(ix, iy + 1, seed)
    + (hashUnit(ix + 1, iy + 1, seed) - hashUnit(ix, iy + 1, seed)) * fx;
  return top + (bottom - top) * fy;
}

/** Summiertes Rauschen; erst mehrere Oktaven ergeben eine Struktur ohne erkennbares Gitter. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  let amplitude = 0.5;
  let sampleX = x;
  let sampleY = y;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(sampleX, sampleY, seed + octave * 1013) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    sampleX *= 2.03;
    sampleY *= 2.03;
  }
  return sum / norm;
}

/**
 * 1 unterhalb `inner`, 0 ab `outer`, dazwischen Smootherstep. Die zweite Ableitung ist an
 * beiden Enden null – eine lineare Flanke zeichnet bei additiver Ueberlagerung einen Ring an
 * ihren Ansatz.
 */
function falloff(value: number, inner: number, outer: number): number {
  if (value <= inner) return 1;
  if (value >= outer) return 0;
  const t = (value - inner) / (outer - inner);
  return 1 - t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gauss-Glocke, 1 bei `distance = 0`. Weich und ohne Nullpunkt – also ohne sichtbare Kontur. */
function bell(distance: number, sharpness: number): number {
  return Math.exp(-sharpness * distance * distance);
}

/**
 * Schreibt ein weisses Bild, dessen Alpha pro Pixel aus `alphaAt` kommt. `u`/`v` laufen ueber
 * die volle Kantenlaenge von -1 bis 1 (Pixelmitte).
 */
function paintAlphaField(
  ctx: CanvasRenderingContext2D,
  size: number,
  alphaAt: (u: number, v: number) => number,
): void {
  const image = ctx.createImageData(size, size);
  const data = image.data;
  for (let py = 0; py < size; py += 1) {
    const v = ((py + 0.5) / size) * 2 - 1;
    for (let px = 0; px < size; px += 1) {
      const u = ((px + 0.5) / size) * 2 - 1;
      const alpha = alphaAt(u, v);
      const offset = (py * size + px) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha <= 0 ? 0 : Math.min(255, Math.round(alpha * 255));
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Erzeugt alle GroundFire-Motive. Idempotent; `ensureCanvasTexture` prueft den Schluessel. */
export function ensureGroundFireTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  for (let variant = 0; variant < GROUND_FIRE_SURFACE_TEXTURES.length; variant += 1) {
    ensureGroundFireSurface(textures, GROUND_FIRE_SURFACE_TEXTURES[variant], variant);
  }
  for (let variant = 0; variant < GROUND_FIRE_BED_TEXTURES.length; variant += 1) {
    ensureGroundFireBed(textures, GROUND_FIRE_BED_TEXTURES[variant], variant);
  }
}

/**
 * Organisches Flaechenmotiv. Ein asymmetrischer, gewellter Grundkoerper haelt die Deckung hoch;
 * seed-deterministische Lappen und Einbuchtungen brechen Kreis und Wiederholungsmuster auf.
 * Alle Varianten bleiben weich und konturlos, damit sie additiv miteinander verschmelzen.
 */
export function sampleGroundFireSurfaceAlpha(variantIndex: number, u: number, v: number): number {
  const variant = normalizeVariant(variantIndex, GROUND_FIRE_SURFACE_VARIANT_COUNT);
  const seed = 4271 + variant * 3253;
  const window = frameEdgeWindow(u, v);
  if (window <= 0) return 0;

  const rotation = hashUnit(variant, 1, seed) * Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const aspectX = 0.78 + hashUnit(variant, 2, seed) * 0.28;
  const aspectY = 0.68 + hashUnit(variant, 3, seed) * 0.24;
  const offsetX = (hashUnit(variant, 4, seed) - 0.5) * 0.16;
  const offsetY = (hashUnit(variant, 5, seed) - 0.5) * 0.16;
  const dx = u - offsetX;
  const dy = v - offsetY;
  const localX = (dx * cos - dy * sin) / aspectX;
  const localY = (dx * sin + dy * cos) / aspectY;
  const radius = Math.hypot(localX, localY);
  const angle = Math.atan2(localY, localX);
  const rimNoise = fbm(
    Math.cos(angle) * 1.9 + variant * 2.7,
    Math.sin(angle) * 1.9 - variant * 1.8,
    seed + 211,
    3,
  );
  const rim = 0.90
    + (rimNoise - 0.5) * 0.34
    + Math.sin(angle * 3 + variant * 1.7) * 0.075
    + Math.sin(angle * 5 - variant * 0.9) * 0.045;
  let value = 0.43 * falloff(radius / rim, 0.42, 1) ** 0.72;

  for (let lobe = 0; lobe < 7; lobe += 1) {
    const lobeAngle = hashUnit(lobe, variant, seed + 307) * Math.PI * 2;
    const lobeRadius = 0.20 + hashUnit(lobe, variant, seed + 401) * 0.52;
    const cx = Math.cos(lobeAngle) * lobeRadius + offsetX * 0.35;
    const cy = Math.sin(lobeAngle) * lobeRadius + offsetY * 0.35;
    const lobeRotation = lobeAngle + (hashUnit(lobe, variant, seed + 503) - 0.5) * 1.5;
    const lobeCos = Math.cos(-lobeRotation);
    const lobeSin = Math.sin(-lobeRotation);
    const lobeDx = u - cx;
    const lobeDy = v - cy;
    const rx = 0.18 + hashUnit(lobe, variant, seed + 601) * 0.18;
    const ry = 0.09 + hashUnit(lobe, variant, seed + 701) * 0.13;
    const lobeX = (lobeDx * lobeCos - lobeDy * lobeSin) / rx;
    const lobeY = (lobeDx * lobeSin + lobeDy * lobeCos) / ry;
    const alpha = 0.12 + hashUnit(lobe, variant, seed + 809) * 0.14;
    value += alpha * bell(Math.hypot(lobeX, lobeY), 1.7);
  }

  // Zwei weiche Kerben erzeugen konkave Zwischenraeume, ohne eine harte Flammensilhouette.
  for (let notch = 0; notch < 2; notch += 1) {
    const notchAngle = hashUnit(notch, variant, seed + 907) * Math.PI * 2;
    const notchRadius = 0.48 + hashUnit(notch, variant, seed + 1009) * 0.18;
    const notchX = u - Math.cos(notchAngle) * notchRadius;
    const notchY = v - Math.sin(notchAngle) * notchRadius;
    value -= (0.08 + hashUnit(notch, variant, seed + 1103) * 0.07)
      * bell(Math.hypot(notchX / 0.22, notchY / 0.14), 1.8);
  }

  const grain = 0.86 + 0.18 * fbm(u * 3.3 + variant * 4.1, v * 3.3 - variant * 2.9, seed + 1201, 3);
  return Math.max(0, value) * grain * window;
}

/**
 * Flaechenfeld: ein breiter organischer Grundkoerper mit seed-festen Ausbuchtungen, weichen
 * Einschnitten und feiner Binnenstruktur. Die drei Varianten halten eine vergleichbare Deckung,
 * besitzen aber keine gemeinsame Kreis- oder Lappensilhouette.
 *
 * Der Grundkoerper traegt den Grossteil der Deckung; ohne ihn bliebe nur ein sparsames
 * Rauschmuster uebrig und die Flaeche waere trotz hoher Partikelzahl blass. Das Randfenster
 * sichert lediglich transparente Framekanten und darf selbst keine radiale Form vorgeben.
 */
function ensureGroundFireSurface(
  textures: Phaser.Textures.TextureManager,
  textureKey: string,
  variant: number,
): void {
  const size = GROUND_FIRE_SURFACE_SIZE;
  ensureCanvasTexture(textures, textureKey, size, size, (ctx) => {
    paintAlphaField(ctx, size, (u, v) => sampleGroundFireSurfaceAlpha(variant, u, v));
  });
}

/**
 * Glutbett: eine breite asymmetrische Form mit unregelmaessigem Rand.
 *
 * Sie traegt keine harte Silhouette – sie deckt eine Flaeche. Aspekt, versetzter Mittelpunkt,
 * Lappen und Kerben verhindern den wiederkehrenden Kreis; die breite Flanke haelt die Deckung.
 */
export function sampleGroundFireBedAlpha(variantIndex: number, u: number, v: number): number {
  const variant = normalizeVariant(variantIndex, GROUND_FIRE_BED_VARIANT_COUNT);
  const seed = 5501 + variant * 4211;
  const window = frameEdgeWindow(u, v);
  if (window <= 0) return 0;

  const rotation = hashUnit(variant, 11, seed) * Math.PI * 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const offsetX = (hashUnit(variant, 13, seed) - 0.5) * 0.18;
  const offsetY = (hashUnit(variant, 17, seed) - 0.5) * 0.18;
  const dx = u - offsetX;
  const dy = v - offsetY;
  const localX = (dx * cos - dy * sin) / (0.82 + hashUnit(variant, 19, seed) * 0.24);
  const localY = (dx * sin + dy * cos) / (0.70 + hashUnit(variant, 23, seed) * 0.22);
  const radius = Math.hypot(localX, localY);
  const angle = Math.atan2(localY, localX);
  const rimNoise = fbm(
    Math.cos(angle) * 1.6 + variant * 3.1,
    Math.sin(angle) * 1.6 - variant * 2.3,
    seed + 127,
    3,
  );
  const rim = 0.92
    + (rimNoise - 0.5) * 0.38
    + Math.sin(angle * 2 + variant * 0.8) * 0.08
    + Math.sin(angle * 3 + variant * 1.6) * 0.09
    + Math.sin(angle * 4 - variant * 1.3) * 0.05;
  let value = 0.54 * falloff(radius / rim, 0.40, 1) ** 0.76;

  for (let lobe = 0; lobe < 3; lobe += 1) {
    const lobeAngle = hashUnit(lobe, variant, seed + 233) * Math.PI * 2;
    const lobeRadius = 0.28 + hashUnit(lobe, variant, seed + 337) * 0.38;
    const lobeX = (u - Math.cos(lobeAngle) * lobeRadius) / (0.24 + hashUnit(lobe, variant, seed + 431) * 0.14);
    const lobeY = (v - Math.sin(lobeAngle) * lobeRadius) / (0.16 + hashUnit(lobe, variant, seed + 541) * 0.12);
    value += (0.08 + hashUnit(lobe, variant, seed + 647) * 0.08)
      * bell(Math.hypot(lobeX, lobeY), 1.55);
  }

  const notchAngle = hashUnit(variant, 29, seed + 751) * Math.PI * 2;
  const notchX = (u - Math.cos(notchAngle) * 0.62) / 0.25;
  const notchY = (v - Math.sin(notchAngle) * 0.62) / 0.18;
  value -= 0.11 * bell(Math.hypot(notchX, notchY), 1.7);

  const grain = 0.84 + 0.18 * fbm(u * 3.1 - variant * 4.7, v * 3.1 + variant * 3.5, seed + 857, 3);
  return Math.max(0, value) * grain * window;
}

function ensureGroundFireBed(
  textures: Phaser.Textures.TextureManager,
  textureKey: string,
  variant: number,
): void {
  const size = GROUND_FIRE_BED_SIZE;
  ensureCanvasTexture(textures, textureKey, size, size, (ctx) => {
    paintAlphaField(ctx, size, (u, v) => sampleGroundFireBedAlpha(variant, u, v));
  });
}

function normalizeVariant(index: number, count: number): number {
  return ((index | 0) % count + count) % count;
}

/**
 * Reine Sicherheitsblende an den vier Frame-Kanten. Anders als ein radialer Kreis bestimmt sie
 * nicht die sichtbare Silhouette; die kommt ausschliesslich aus dem organischen Motiv selbst.
 */
function frameEdgeWindow(u: number, v: number): number {
  return falloff(Math.max(Math.abs(u), Math.abs(v)), 0.86, 0.995);
}
