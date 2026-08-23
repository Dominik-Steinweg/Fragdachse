import type Phaser from 'phaser';
import { ensureCanvasTexture } from './EffectUtils';

/**
 * Die zwei Motive des Bodenfeuers. Beide sind **weiss**: die Farbe kommt erst aus dem
 * Multiply-Tint, damit dasselbe Frame den normalen wie den Void-Stil traegt.
 *
 * - `surface` – das organische Wolkenfeld, das *alle* Flammenschichten benutzen.
 * - `bed` – eine weiche Kuppel mit unregelmaessigem Rand fuer die flaechige Grundglut.
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
export const TEX_GROUND_FIRE_BED     = '__ground_fire_bed';

/**
 * Native Kantenlaengen. Der Atlas und der Renderer lesen sie hier, damit Frame-Groesse und
 * Motivgroesse nicht an zwei Stellen gepflegt werden muessen.
 *
 * 64 px statt der frueheren 32: die Motive werden auf 2.5 bis 2.7 Rasterzellen (40 bis 43 px)
 * gezogen, eine 32-px-Quelle wurde dabei hochskaliert und zeigte ihre Verlaufsstufen.
 */
export const GROUND_FIRE_SURFACE_SIZE = 64;
export const GROUND_FIRE_BED_SIZE     = 64;

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

/** Erzeugt beide GroundFire-Motive. Idempotent; `ensureCanvasTexture` prueft den Schluessel. */
export function ensureGroundFireTextures(scene: Phaser.Scene): void {
  const textures = scene.textures;

  ensureGroundFireSurface(textures);
  ensureGroundFireBed(textures);
}

/**
 * Die Wolkenlappen des Flaechenfelds, in normierten Koordinaten (-1 bis 1): Mittelpunkt,
 * Halbachsen, Alpha, Drehung. Uebernommen aus dem urspruenglichen 32-px-Motiv – die Verteilung
 * hat sich bewaehrt, nur ihr Rand war abgeschnitten.
 */
const SURFACE_LOBES: readonly (readonly [number, number, number, number, number, number])[] = [
  [-0.56, -0.31, 0.34, 0.16, 0.20, -0.35],
  [0.06, -0.56, 0.31, 0.16, 0.22, 0.18],
  [0.63, -0.25, 0.25, 0.19, 0.18, 0.55],
  [-0.50, 0.25, 0.34, 0.19, 0.19, 0.20],
  [0.25, 0.19, 0.38, 0.19, 0.22, -0.30],
  [0.69, 0.50, 0.22, 0.16, 0.16, 0.42],
  [-0.06, 0.69, 0.28, 0.13, 0.14, -0.12],
];

/**
 * Flaechenfeld: der breite Grundverlauf des alten Motivs plus seine sieben Wolkenlappen, aber
 * mit einer Flanke, die *innerhalb* des Frames auf null laeuft.
 *
 * Der Grundverlauf traegt den Grossteil der Deckung; ohne ihn bliebe nur ein sparsames
 * Lappenmuster uebrig und die Flaeche waere trotz hoher Partikelzahl blass. Genau das war der
 * Fehler eines Zwischenstands, der ihn durch reines Rauschen ersetzt hatte.
 */
function ensureGroundFireSurface(textures: Phaser.Textures.TextureManager): void {
  const size = GROUND_FIRE_SURFACE_SIZE;
  ensureCanvasTexture(textures, TEX_GROUND_FIRE_SURFACE, size, size, (ctx) => {
    paintAlphaField(ctx, size, (u, v) => {
      const radius = Math.hypot(u, v);
      const window = falloff(radius, 0.86, 1);
      if (window <= 0) return 0;
      // Breites Plateau, dann eine kurze Flanke. Das alte Motiv war bis an seine Bildkante hell
      // und wurde dort abgeschnitten; ein weicher Verlauf ueber den ganzen Radius haette
      // dieselbe Partikelzahl deutlich blasser gemacht.
      let value = 0.50 * falloff(radius, 0.58, 0.99) ** 0.7;
      for (const [cx, cy, rx, ry, alpha, rotation] of SURFACE_LOBES) {
        const dx = u - cx;
        const dy = v - cy;
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const localX = (dx * cos - dy * sin) / rx;
        const localY = (dx * sin + dy * cos) / ry;
        value += alpha * bell(Math.hypot(localX, localY), 2.2);
      }
      const grain = 0.88 + 0.16 * fbm(u * 3.1 + 5.5, v * 3.1 - 2.7, 4271, 3);
      return value * grain * window;
    });
  });
}

/**
 * Glutbett: eine weiche Kuppel mit unregelmaessigem Rand.
 *
 * Sie traegt keine eigene Silhouette – sie deckt eine Flaeche. Der verrauschte Rand verhindert,
 * dass sich der Kreis des Motivs bei wenigen gleichzeitigen Partikeln abzeichnet, und die breite
 * Flanke haelt die Deckung hoch, ohne einen Ring an ihrem Ansatz zu ziehen.
 */
function ensureGroundFireBed(textures: Phaser.Textures.TextureManager): void {
  const size = GROUND_FIRE_BED_SIZE;
  ensureCanvasTexture(textures, TEX_GROUND_FIRE_BED, size, size, (ctx) => {
    paintAlphaField(ctx, size, (u, v) => {
      const radius = Math.hypot(u, v);
      if (radius >= 1) return 0;
      const angle = Math.atan2(v, u);
      // Rein winkelabhaengiges Rauschen: der Rand wellt sich, ohne dass Loecher entstehen.
      const rim = 1 + (fbm(Math.cos(angle) * 1.7 + 3.3, Math.sin(angle) * 1.7 - 2.1, 5501, 3) - 0.5) * 0.26;
      const dome = falloff(radius / rim, 0.52, 0.96) ** 0.7 * falloff(radius, 0.90, 0.995);
      if (dome <= 0) return 0;
      const grain = 0.84 + 0.16 * fbm(u * 3.4 - 9.1, v * 3.4 + 6.3, 8117, 3);
      return dome * grain * 0.58;
    });
  });
}
