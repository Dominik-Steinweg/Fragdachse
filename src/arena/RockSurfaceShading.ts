/**
 * Grossflaechige Farb- und Helligkeitsmodellierung der Felsflaeche.
 *
 * Alle 47 Blob-Kacheln teilen dieselbe 32-px-Materialflaeche (siehe
 * `docs/ai/visual-guidelines.md`), ein Felsverbund ist also dasselbe Motiv pro Zelle
 * gestempelt. Diese Datei liefert die beiden Anteile, die sich als reiner Multiplikator
 * ausdruecken lassen und deshalb **ohne** zusaetzlichen Renderlayer direkt in den
 * 4-Ecken-Tint des Fels-Sprites wandern:
 *
 * 1. ein grossflaechiges, deterministisches Farb-/Helligkeitsfeld ("Wash"),
 * 2. Richtungslicht aus der Silhouette, passend zu `WORLD_SHADOW_CONFIG.lightDirection`.
 *
 * Warum Tint und nicht Overlay: der Tint folgt der Kachel-Alpha exakt. Die Silhouette
 * bleibt damit pixelgenau erhalten, es kann nichts ueber die Kante lecken und nichts
 * abgeschnitten wirken – genau das, was das 47-Blob-Verfahren fuer die Lesbarkeit der
 * Hitboxen leistet. Ausserdem multipliziert sich der HP-Schadenstint korrekt darueber,
 * anstatt von einem deckenden Overlay verwaessert zu werden.
 *
 * Ohne Phaser-Abhaengigkeit, wie `AutoTiler`: das Feld ist reine Gitter-Mathematik und
 * bleibt damit direkt testbar.
 */

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Ein Tint-Wert je Zellecke, Reihenfolge wie `setTint(topLeft, topRight, bottomLeft, bottomRight)`. */
export type RockCornerTints = readonly [number, number, number, number];

export const ROCK_SURFACE_SHADING = {
  /**
   * Grundniveau der Felsflaeche. Der Tint kann nur abdunkeln, deshalb liegt das Niveau
   * unter 1: erst dadurch hat das Kantenlicht Luft nach oben.
   */
  baseLevel: 0.98,
  /**
   * Aufhellung an der dem Licht zugewandten Silhouette (NW). Zusammen mit `baseLevel` knapp
   * unter 1 gehalten: darueber klemmt der Verlauf an der Obergrenze und die beleuchteten
   * Kanten laufen alle in denselben Wert, statt eine Rundung zu zeigen.
   */
  edgeLift: 0.03,
  /** Abdunkelung an der lichtabgewandten Silhouette (SE). */
  edgeShade: 0.2,
  /** Amplitude des grossflaechigen Helligkeitsfeldes (± um das Grundniveau). */
  washValueAmount: 0.07,
  /** Maximale Farbverschiebung des grossflaechigen Feldes. */
  washHueAmount: 0.26,
  /** Perioden des Helligkeitsfeldes in Zellen: eine grosse Form, eine mittlere Stoerung. */
  washValuePeriods: [11, 4.5] as const,
  /** Periode des Farbfeldes in Zellen – deutlich groesser, damit Farbe als Region liest. */
  washHuePeriod: 15,
  /**
   * Farbregionen des Washs. Bewusst nur leicht gesaettigt: der Fels soll Regionen
   * bekommen, nicht bunt werden.
   */
  washHues: [0xd8b088, 0x9cc0d4, 0xa8c489] as const,
} as const;

const LIGHT_DIR_X = Math.SQRT1_2;
const LIGHT_DIR_Y = Math.SQRT1_2;

/**
 * Deterministischer Hash einer Gitterecke. Bewusst kein `Phaser.Math.RND`: das Feld muss
 * bei jedem Neuaufbau (Fels zerstoert, Fels gesetzt) dasselbe Ergebnis liefern, sonst
 * wuerde die gesamte Felsflaeche bei jeder Zerstoerung neu einfaerben.
 */
function hashCorner(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix + 0x1f83d9ab, 0x27d4eb2d)
    ^ Math.imul(iy + 0x5be0cd19, 0x165667b1)
    ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function smoothStep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear interpoliertes Wertrauschen in Gitterkoordinaten, Periode in Zellen. */
function valueNoise(x: number, y: number, period: number, salt: number): number {
  const fx = x / period;
  const fy = y / period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smoothStep(fx - x0);
  const ty = smoothStep(fy - y0);
  const top = lerp(hashCorner(x0, y0, salt), hashCorner(x0 + 1, y0, salt), tx);
  const bottom = lerp(hashCorner(x0, y0 + 1, salt), hashCorner(x0 + 1, y0 + 1, salt), tx);
  return lerp(top, bottom, ty);
}

/**
 * Lambert-Anteil einer Gitterecke aus der Belegung ihrer vier Nachbarzellen.
 *
 * Die Ecke `(cornerX, cornerY)` ist der Punkt links oben an Zelle `(cornerX, cornerY)`;
 * die vier umliegenden Zellen ergeben den Belegungsgradienten und daraus die
 * Flaechennormale. Weil die Funktion ausschliesslich von der Eckposition abhaengt und
 * nicht von der gerade gezeichneten Zelle, ist das Ergebnis an gemeinsamen Ecken
 * zwangslaeufig identisch – der Verlauf laeuft ohne Sprung ueber Zellgrenzen.
 *
 * @returns > 0 zum Licht zeigend, < 0 abgewandt, 0 im Inneren des Verbunds.
 */
function resolveCornerLambert(
  cornerX: number,
  cornerY: number,
  isOccupied: (gridX: number, gridY: number) => boolean,
): number {
  const nw = isOccupied(cornerX - 1, cornerY - 1) ? 1 : 0;
  const ne = isOccupied(cornerX, cornerY - 1) ? 1 : 0;
  const sw = isOccupied(cornerX - 1, cornerY) ? 1 : 0;
  const se = isOccupied(cornerX, cornerY) ? 1 : 0;

  // Normale zeigt vom Fels weg: (belegter Westen - belegter Osten, belegter Norden - belegter Sueden)
  const normalX = (nw + sw - ne - se) * 0.5;
  const normalY = (nw + ne - sw - se) * 0.5;

  return -(normalX * LIGHT_DIR_X + normalY * LIGHT_DIR_Y);
}

function mixChannel(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/** Multiplikativer Tint einer einzelnen Zellecke. */
function resolveCornerTint(
  cornerX: number,
  cornerY: number,
  isOccupied: (gridX: number, gridY: number) => boolean,
): number {
  const cfg = ROCK_SURFACE_SHADING;

  const lambert = resolveCornerLambert(cornerX, cornerY, isOccupied);
  const directional = lambert >= 0 ? lambert * cfg.edgeLift : lambert * cfg.edgeShade;

  const [longPeriod, shortPeriod] = cfg.washValuePeriods;
  const valueField = valueNoise(cornerX, cornerY, longPeriod, 1) * 0.72
    + valueNoise(cornerX, cornerY, shortPeriod, 2) * 0.28;
  const value = (valueField - 0.5) * 2;

  const level = clamp(
    cfg.baseLevel + directional + value * cfg.washValueAmount,
    0.55,
    1,
  );

  const hueField = valueNoise(cornerX, cornerY, cfg.washHuePeriod, 3);
  const hueIndex = Math.min(cfg.washHues.length - 1, Math.floor(hueField * cfg.washHues.length));
  const hue = cfg.washHues[hueIndex];
  // Mitten zwischen zwei Regionen bleibt neutral, das Zentrum einer Region faerbt am staerksten.
  const hueAmount = Math.abs(hueField * cfg.washHues.length % 1 - 0.5) * 2 * cfg.washHueAmount;

  const red = mixChannel(255, (hue >> 16) & 0xff, hueAmount) * level;
  const green = mixChannel(255, (hue >> 8) & 0xff, hueAmount) * level;
  const blue = mixChannel(255, hue & 0xff, hueAmount) * level;

  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}

/**
 * 4-Ecken-Tint einer Felszelle. `isOccupied` muss dieselbe Belegungsabfrage sein, die auch
 * das Autotiling nutzt (`RockGridIndex.isOccupiedWithBorder`), damit Kantenlicht und
 * Kachelform dieselbe Silhouette beschreiben.
 */
export function resolveRockSurfaceCornerTints(
  gridX: number,
  gridY: number,
  isOccupied: (gx: number, gy: number) => boolean,
): RockCornerTints {
  return [
    resolveCornerTint(gridX, gridY, isOccupied),
    resolveCornerTint(gridX + 1, gridY, isOccupied),
    resolveCornerTint(gridX, gridY + 1, isOccupied),
    resolveCornerTint(gridX + 1, gridY + 1, isOccupied),
  ];
}

/** Multipliziert einen Basistint (Schaden, Besitzerfarbe) mit dem Flaechentint einer Ecke. */
export function multiplyTint(base: number, surface: number): number {
  const red = (((base >> 16) & 0xff) * ((surface >> 16) & 0xff)) / 255;
  const green = (((base >> 8) & 0xff) * ((surface >> 8) & 0xff)) / 255;
  const blue = ((base & 0xff) * (surface & 0xff)) / 255;
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}
