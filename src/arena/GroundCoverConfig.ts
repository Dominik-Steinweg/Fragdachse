import type * as Phaser from 'phaser';

/**
 * Authored-Daten der Ground-Cover-Schicht: grosse Moosflaechen, die die Dirt/Gras-Grenze und das
 * 32-px-Raster aufbrechen. Aufbau bewusst wie {@link ./DecalConfig}: Pfadkonstante, Variantentabelle
 * mit Haeufigkeitsgewichten, Preload-Helfer.
 *
 * Die Texturen entstehen offline in `scripts/generate-ground-cover-textures.mjs`. Ihre Alpha ist
 * dort bereits auf volle Bandbreite gebaut; jede Abschwaechung passiert zur Laufzeit ueber die
 * Alpha-Bereiche hier, damit ein Balancing-Schritt keine acht PNGs neu erzeugen muss.
 */

const GROUND_COVER_ASSET_PATH = './assets/sprites/groundcover';

/**
 * Ankerklasse einer Platzierung.
 *
 * - `seam`   – beidseitig des Dirt/Gras-Uebergangs; der Schwerpunkt der Schicht.
 * - `dirt`   – Dirt-Innenflaeche.
 * - `grass`  – Gras-Innenflaeche, weit genug vom Dirt entfernt.
 */
export type GroundCoverAnchor = 'seam' | 'dirt' | 'grass';

export interface GroundCoverVariantConfig {
  fileName: string;
  /** Relatives Gewicht innerhalb der fuer eine Ankerklasse zugelassenen Varianten. */
  frequencyPercent: number;
  /** Erlaubte Ankerklassen. Ohne Angabe: alle. */
  anchors?: readonly GroundCoverAnchor[];
}

export interface GroundCoverAnchorConfig {
  /** Erwartete Stempelzahl je Ankerblock; der Nachkommaanteil ist Wahrscheinlichkeit. */
  perBlock: number;
  minSizeCells: number;
  maxSizeCells: number;
  /** Exponent auf dem Groessen-Hash. Werte > 1 ziehen die Verteilung zur Untergrenze. */
  sizeBias: number;
  minAlpha: number;
  maxAlpha: number;
}

export interface GroundCoverLayerConfig {
  /** Kantenlaenge eines Ankerblocks in Zellen. */
  blockCells: number;
  /** Maximale Zahl lokaler Anker-Slots je Block; der Gesamtumfang folgt aus dem Map-Raster. */
  maxPerBlock: number;
  /** Streuung des Ankers innerhalb seines Blocks, in Zellen. */
  jitterCells: number;
  seam: GroundCoverAnchorConfig;
  dirt: GroundCoverAnchorConfig;
  grass: GroundCoverAnchorConfig;
  variants: readonly GroundCoverVariantConfig[];
}

/**
 * Warum ein Blockraster statt einer Wahrscheinlichkeit je Zelle wie bei Decals oder
 * {@link ./BlobSurfaceMottle}: Ein Mottle-Stempel ist rund eine Zelle breit, dort *ist* die
 * Zellwahrscheinlichkeit die Deckung. Ein Moosfleck ueberdeckt dagegen 5-11 Zellen je Achse; schon
 * wenige Prozent je Zelle ergaeben ueber einem Saum von einigen hundert Zellen einen geschlossenen
 * gruenen Teppich. Der Block ist mit 5 Zellen kleiner als der kleinste Fleck, benachbarte Bloecke
 * ueberlappen also weiterhin – die geforderte Ueberlagerung entsteht, die Dichte bleibt begrenzt.
 */
export const GROUND_COVER_CONFIG: GroundCoverLayerConfig = {
  blockCells: 5,
  maxPerBlock: 2,
  /** Volle Blockbreite: der Anker landet an jeder Stelle, nie auf einem Zellmittelpunkt. */
  jitterCells: 2.5,

  seam: { perBlock: 0.95, minSizeCells: 5, maxSizeCells: 11, sizeBias: 1.6, minAlpha: 0.70, maxAlpha: 0.90 },
  dirt: { perBlock: 0.80, minSizeCells: 4, maxSizeCells: 8, sizeBias: 1.8, minAlpha: 0.62, maxAlpha: 0.86 },
  grass: { perBlock: 0.74, minSizeCells: 3, maxSizeCells: 7, sizeBias: 2.0, minAlpha: 0.44, maxAlpha: 0.86 },

  /**
   * Die Gewichte sind bewusst flach: Bei 16 Vorlagen faellt eine Wiederholung nur dann auf, wenn
   * eine einzelne Form haeufig genug ist, um als Muster gelesen zu werden. Ausnahmen sind unten
   * einzeln begruendet. Die Summe ist 100; innerhalb einer Ankerklasse normiert der Generator die
   * dort zugelassenen Gewichte selbst nach.
   */
  variants: [
    { fileName: 'ground_cover_01.png', frequencyPercent: 8 },
    { fileName: 'ground_cover_02.png', frequencyPercent: 8 },
    { fileName: 'ground_cover_03.png', frequencyPercent: 7 },
    { fileName: 'ground_cover_04.png', frequencyPercent: 7 },
    // Groesster geschlossener Klumpen – bewusst selten, sonst dominiert eine einzelne Form.
    { fileName: 'ground_cover_05.png', frequencyPercent: 5 },
    { fileName: 'ground_cover_06.png', frequencyPercent: 6 },
    // Die beiden braunsten Vorlagen (gemessen 31 % bzw. 50 % Pixel mit R >= G, gegen 6-22 % bei
    // allen anderen). Auf Gras laegen sie als Fremdkoerper; am Saum und auf Dirt sind sie genau
    // das Bindeglied zwischen den Materialien.
    { fileName: 'ground_cover_07.png', frequencyPercent: 4, anchors: ['seam', 'dirt'] },
    { fileName: 'ground_cover_08.png', frequencyPercent: 4, anchors: ['seam', 'dirt'] },
    { fileName: 'ground_cover_09.png', frequencyPercent: 7 },
    { fileName: 'ground_cover_10.png', frequencyPercent: 6 },
    { fileName: 'ground_cover_11.png', frequencyPercent: 7 },
    { fileName: 'ground_cover_12.png', frequencyPercent: 6 },
    { fileName: 'ground_cover_13.png', frequencyPercent: 7 },
    { fileName: 'ground_cover_14.png', frequencyPercent: 6 },
    { fileName: 'ground_cover_15.png', frequencyPercent: 6 },
    { fileName: 'ground_cover_16.png', frequencyPercent: 6 },
  ],
};

/**
 * Obergrenze des Blockrasters fuer eine konkrete Map. Sie skaliert mit der Mapflaeche und ist
 * deshalb keine globale, auf kleine Arenen zugeschnittene Placement-Grenze.
 */
export function getGroundCoverPlacementBudget(
  gridCols: number,
  gridRows: number,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): number {
  if (gridCols <= 0 || gridRows <= 0) return 0;
  return Math.ceil(gridCols / config.blockCells)
    * Math.ceil(gridRows / config.blockCells)
    * Math.ceil(config.maxPerBlock);
}

export function getGroundCoverTextureKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Alle fuer eine Ankerklasse zugelassenen Varianten, in Tabellenreihenfolge. */
export function getGroundCoverVariantsForAnchor(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): readonly GroundCoverVariantConfig[] {
  return config.variants.filter((variant) => !variant.anchors || variant.anchors.includes(anchor));
}

export function getGroundCoverAnchorConfig(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): GroundCoverAnchorConfig {
  return config[anchor];
}

export function preloadGroundCoverAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const variant of GROUND_COVER_CONFIG.variants) {
    loader.image(getGroundCoverTextureKey(variant.fileName), `${GROUND_COVER_ASSET_PATH}/${variant.fileName}`);
  }
}
