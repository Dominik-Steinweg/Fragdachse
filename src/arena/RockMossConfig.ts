import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';

/**
 * Authored-Daten der Fels-Moos-Schicht: grossflaechiger Bewuchs auf dem Felsbestand. Aufbau
 * bewusst wie {@link ./GroundCoverConfig}, damit beide Bewuchsschichten dieselbe Form haben.
 *
 * Die Texturen und die Randverlaufsmaske entstehen offline in
 * `scripts/generate-rock-moss-textures.mjs`.
 */

const ROCK_MOSS_ASSET_PATH = './assets/sprites/rockmoss';

/**
 * Verlaufsmaske der Felssilhouette – ein zweites 47-Blob-Sheet mit demselben Frame-Raster wie
 * `rocks`. Ihre Alpha steigt von der jeweils offenen Kachelkante nach innen an und traegt damit
 * das weiche Auslaufen des Mooses am Rand des Felsbestands.
 */
export const ROCK_MOSS_MASK_TEXTURE_KEY = 'rock_moss_mask';
const ROCK_MOSS_MASK_ASSET = './assets/sprites/rocks47blob_mossmask.png';

export interface RockMossVariantConfig {
  fileName: string;
  frequencyPercent: number;
}

export interface RockMossLayerConfig {
  /** Kantenlaenge eines Ankerblocks in Zellen. */
  blockCells: number;
  maxPerBlock: number;
  maxPlacements: number;
  /** Streuung des Ankers innerhalb seines Blocks, in Zellen. */
  jitterCells: number;
  /** Erwartete Stempelzahl je Ankerblock; der Nachkommaanteil ist Wahrscheinlichkeit. */
  perBlock: number;
  minSizeCells: number;
  maxSizeCells: number;
  /** Exponent auf dem Groessen-Hash. Werte > 1 ziehen die Verteilung zur Untergrenze. */
  sizeBias: number;
  minAlpha: number;
  maxAlpha: number;
  variants: readonly RockMossVariantConfig[];
}

export const ROCK_MOSS_CONFIG: RockMossLayerConfig = {
  /**
   * Feineres Blockraster als beim Ground Cover (5). Felsen stehen in kleineren, verstreuten
   * Formationen; ein grobes Raster liesse ganze Felsgruppen leer, weil ihr Ankerblock zufaellig
   * neben ihnen liegt.
   */
  blockCells: 3,
  maxPerBlock: 2,
  /**
   * Schutzgrenze. Sie muss ueber `Bloecke * maxPerBlock` liegen, sonst bricht der Generator
   * mitten in seinem zeilenweisen Lauf ab und die Karte bliebe unten rechts unbemoost. Groesste
   * Karte ist `13-brutbomben` mit 135x40 Zellen, also 45x14 = 630 Bloecke; da `perBlock` unter 1
   * liegt, kann hoechstens ein Stempel je Block entstehen.
   */
  maxPlacements: 768,
  jitterCells: 1.5,

  perBlock: 0.75,
  /**
   * Deutlich kleiner als am Boden (3-11 Zellen). Ein Moosfleck soll ueber mehrere Felskacheln
   * laufen und den Verbund zusammenbinden, aber nicht eine ganze Formation unter sich begraben.
   */
  minSizeCells: 2,
  maxSizeCells: 8,
  sizeBias: 1.5,
  minAlpha: 0.45,
  maxAlpha: 0.95,

  /** Flache Gewichte: Bei acht Vorlagen faellt jede Haeufung als Muster auf. */
  variants: [
    { fileName: 'rock_moss_01.png', frequencyPercent: 13 },
    { fileName: 'rock_moss_02.png', frequencyPercent: 13 },
    { fileName: 'rock_moss_03.png', frequencyPercent: 13 },
    { fileName: 'rock_moss_04.png', frequencyPercent: 12 },
    { fileName: 'rock_moss_05.png', frequencyPercent: 12 },
    { fileName: 'rock_moss_06.png', frequencyPercent: 12 },
    { fileName: 'rock_moss_07.png', frequencyPercent: 12 },
    { fileName: 'rock_moss_08.png', frequencyPercent: 13 },
  ],
};

export function getRockMossTextureKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Groesster Ueberstand eines Moosflecks ueber seine Ankerzelle hinaus, in Weltpixeln. */
export function getRockMossReachPx(config: RockMossLayerConfig = ROCK_MOSS_CONFIG): number {
  return (config.maxSizeCells * CELL_SIZE) / 2 + config.jitterCells * CELL_SIZE;
}

export function preloadRockMossAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const variant of ROCK_MOSS_CONFIG.variants) {
    loader.image(getRockMossTextureKey(variant.fileName), `${ROCK_MOSS_ASSET_PATH}/${variant.fileName}`);
  }
  loader.spritesheet(ROCK_MOSS_MASK_TEXTURE_KEY, ROCK_MOSS_MASK_ASSET, {
    frameWidth: CELL_SIZE,
    frameHeight: CELL_SIZE,
  });
}
