import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';

/**
 * Authored-Daten der Fels-Vegetationsschicht: Moos-, Flechten- und Efeumatten auf den freien
 * Aussenkanten des Felsbestands. Aufbau wie {@link ./RockMossConfig} und
 * {@link ./GroundCoverConfig}, damit alle drei Bewuchsschichten dieselbe Form haben.
 *
 * Die Texturen und die Reichweitenmaske entstehen offline in
 * `scripts/generate-rock-vegetation-textures.mjs`.
 */

const ROCK_VEGETATION_ASSET_PATH = './assets/sprites/rockvegetation';

/**
 * Reichweitenmaske des Felsbestands – ein zweites 47-Blob-Sheet mit demselben Frame-Raster wie
 * `rocks`, aber mit **doppelt so grossen**, zentrierten Frames. Ihre Alpha ist ueber dem Fels voll
 * deckend und laeuft ausserhalb seiner Silhouette ueber wenige Pixel aus. Sie traegt damit beides:
 * den Schnitt auf den noch stehenden Bestand und den weichen Ueberhang ueber die Felskante.
 *
 * Gegenstueck zur Moosmaske ({@link ./RockMossConfig}), die in die andere Richtung arbeitet und
 * das Moos innerhalb der Kachel auslaufen laesst.
 */
export const ROCK_VEGETATION_MASK_TEXTURE_KEY = 'rock_vegetation_mask';
const ROCK_VEGETATION_MASK_ASSET = './assets/sprites/rocks47blob_vegmask.png';

/**
 * Kantenlaenge eines Maskenframes. Der Frame liegt zentriert ueber seiner Zelle; die Haelfte der
 * Differenz ist damit die maximale Reichweite der Maske nach aussen und zugleich der Rand, den ein
 * Chunk-Neubau bei der Maskensammlung mitnehmen muss.
 */
export const ROCK_VEGETATION_MASK_FRAME_SIZE = CELL_SIZE * 2;
export const ROCK_VEGETATION_MASK_MARGIN_PX = (ROCK_VEGETATION_MASK_FRAME_SIZE - CELL_SIZE) / 2;
/**
 * Abstand, ab dem die Maske ausserhalb des Felsens vollstaendig offen ist – Spiegelbild von
 * `MASK_REACH_PX` im Generatorskript. Was weiter hinausragt, schneidet die Stanzform wieder weg;
 * der Ueberhang der Matten muss deshalb darunter bleiben.
 */
export const ROCK_VEGETATION_MASK_REACH_PX = 15;

/** Groessenklassen der Quellmatten. Namen und native Laengen stehen im Generatorskript. */
export type RockVegetationSizeClass = 'small' | 'mid' | 'large';

export interface RockVegetationClassConfig {
  name: RockVegetationSizeClass;
  /** Kantenlaengen in Zellen, die diese Klasse bedient. Bereiche stossen luecken- und ueberlappungsfrei aneinander. */
  minCells: number;
  maxCells: number;
}

export interface RockVegetationVariantConfig {
  /** Nummer der Quellvorlage, wie im Dateinamen. */
  index: number;
  frequencyPercent: number;
}

export interface RockVegetationLayerConfig {
  /**
   * Hoehe der Matte quer zur Felskante, in Weltpixeln. Bewusst ein Bereich und kein fester Wert:
   * Bei gleicher Hoehe an jeder Kante legt sich um jede Felsformation ein gleich breiter Rahmen,
   * und die Schicht liest sich als Kontur statt als Bewuchs. Die Mitte des Bereichs muss zu
   * `BAND_PX` im Generatorskript passen, sonst steht jede Matte gestaucht oder gezogen.
   */
  minBandPx: number;
  maxBandPx: number;
  /**
   * Ueberstand nach aussen ueber die Felskante hinaus. Er wird direkt gefuehrt und nicht aus der
   * Bandhoehe abgeleitet, damit die streuende Hoehe ausschliesslich nach innen wirkt: Nach aussen
   * begrenzt {@link ROCK_VEGETATION_MASK_REACH_PX} den Ueberhang hart, nach innen ist die Streuung
   * erwuenscht.
   */
  overhangPx: number;
  overhangJitterPx: number;
  /** Streuung der Matte entlang ihrer Kante, in Weltpixeln. Bricht das 32-px-Raster der Enden. */
  alongJitterPx: number;
  /**
   * Groesste Abweichung von der rechtwinkligen Ausrichtung, im Bogenmass. Lockert die strenge
   * Achsparallelitaet der Baender, ohne die rechteckige Grundform des Felsens aufzuloesen.
   */
  rotationJitter: number;
  /** Ueberstand ueber die eigenen Zellgrenzen hinaus. Laesst benachbarte Matten ineinandergreifen. */
  overlapPx: number;
  classes: readonly RockVegetationClassConfig[];
  /** Deckungswahrscheinlichkeit einer Kante der Laenge 1. */
  minCoverage: number;
  /** Zuwachs je zusaetzlicher Zelle Kantenlaenge – lange gerade Kanten werden bevorzugt bewachsen. */
  coverageSlopePerCell: number;
  maxCoverage: number;
  /** Groesste Luecke zwischen zwei Matten derselben Kante, in Zellen. */
  maxGapCells: number;
  /**
   * Wieviele der vier Kanten einer Zelle hoechstens eine Matte tragen. Ohne diese Grenze
   * verschwaende ein einzeln stehender Fels vollstaendig unter Bewuchs und seine rechteckige
   * Grundform waere nicht mehr lesbar.
   */
  maxEdgesPerCell: number;
  minAlpha: number;
  maxAlpha: number;
  variants: readonly RockVegetationVariantConfig[];
}

export const ROCK_VEGETATION_CONFIG: RockVegetationLayerConfig = {
  /**
   * Rund eine Zelle, gestreut. Mehr traegt nicht: Bei zwei Zellen Bandhoehe treffen sich auf einer
   * zwei Zellen dicken Wand die Matten beider Seiten in der Mitte, der Fels verschwindet
   * vollstaendig und nur seine Umrisslinie bleibt lesbar.
   *
   * Die nominelle Hoehe ist dabei nicht die sichtbare: Die Innenseite der Vorlagen ist rauschartig
   * aufgeloest, der Bewuchs endet also irgendwo im inneren Drittel des Bandes statt an seiner
   * Kante.
   */
  minBandPx: 32,
  maxBandPx: 50,
  /** 9 bis 13 px nach aussen – klar sichtbar und innerhalb der Maskenreichweite von 15 px. */
  overhangPx: 11,
  overhangJitterPx: 2,
  /**
   * Versatz entlang der Kante. Ohne ihn beginnt und endet jede Matte auf einer Zellgrenze, und die
   * Enden reihen sich ueber die Karte im 32-px-Takt auf.
   */
  alongJitterPx: 7,
  /** Rund zwei Grad. Genug, damit die Baender nicht als Gitterlinien lesen. */
  rotationJitter: 0.035,
  overlapPx: 6,

  /**
   * Die Bereiche sind so geschnitten, dass der Streckfaktor gegenueber der nativen Laenge der
   * Klasse (1,5 / 3,5 / 8 Zellen) zwischen rund 0,67 und 1,4 bleibt. Darueber hinaus wuerde die
   * Blattstruktur sichtbar gestaucht oder gezogen.
   */
  classes: [
    { name: 'small', minCells: 1, maxCells: 2 },
    { name: 'mid', minCells: 3, maxCells: 5 },
    { name: 'large', minCells: 6, maxCells: 11 },
  ],

  /**
   * Bewusst niedrig: Einzelne freie Zellen sind auf den zellularen Felsformationen mit Abstand der
   * haeufigste Fall (rund 60 % aller Kantenlaeufe). Waechst dort regelmaessig etwas, entsteht ueber
   * die Karte ein Tupfenmuster, und die grossen Matten auf den langen Kanten gehen darin unter.
   */
  minCoverage: 0.14,
  /**
   * Steiler als die Untergrenze vermuten laesst: Ab drei Zellen soll eine Kante zuverlaessig
   * bewachsen sein, damit die Schicht trotz der seltenen Einzelzellen kraeftig deckt.
   */
  coverageSlopePerCell: 0.18,
  maxCoverage: 0.95,
  maxGapCells: 2,
  maxEdgesPerCell: 2,
  minAlpha: 0.82,
  maxAlpha: 1,

  /** Flache Gewichte: Bei acht Vorlagen faellt jede Haeufung als Muster auf. */
  variants: [
    { index: 1, frequencyPercent: 13 },
    { index: 2, frequencyPercent: 13 },
    { index: 3, frequencyPercent: 13 },
    { index: 4, frequencyPercent: 13 },
    { index: 5, frequencyPercent: 12 },
    { index: 6, frequencyPercent: 12 },
    { index: 7, frequencyPercent: 12 },
    { index: 8, frequencyPercent: 12 },
  ],
};

export function getRockVegetationFileName(index: number, sizeClass: RockVegetationSizeClass): string {
  return `rock_veg_${String(index).padStart(2, '0')}_${sizeClass}.png`;
}

export function getRockVegetationTextureKey(index: number, sizeClass: RockVegetationSizeClass): string {
  return getRockVegetationFileName(index, sizeClass).replace(/\.[^.]+$/, '');
}

/**
 * Groesste Ausdehnung einer Matte ab ihrem Mittelpunkt, in Weltpixeln. Konservativer Radius fuer
 * Chunk-Ueberschneidungstests, bevor eine konkrete Platzierung vorliegt.
 */
export function getRockVegetationReachPx(config: RockVegetationLayerConfig = ROCK_VEGETATION_CONFIG): number {
  const longestCells = config.classes.reduce((max, entry) => Math.max(max, entry.maxCells), 0);
  const lengthPx = longestCells * CELL_SIZE + config.overlapPx * 2;
  return Math.hypot(lengthPx, config.maxBandPx) / 2;
}

export function preloadRockVegetationAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const variant of ROCK_VEGETATION_CONFIG.variants) {
    for (const sizeClass of ROCK_VEGETATION_CONFIG.classes) {
      const fileName = getRockVegetationFileName(variant.index, sizeClass.name);
      loader.image(getRockVegetationTextureKey(variant.index, sizeClass.name), `${ROCK_VEGETATION_ASSET_PATH}/${fileName}`);
    }
  }
  loader.spritesheet(ROCK_VEGETATION_MASK_TEXTURE_KEY, ROCK_VEGETATION_MASK_ASSET, {
    frameWidth: ROCK_VEGETATION_MASK_FRAME_SIZE,
    frameHeight: ROCK_VEGETATION_MASK_FRAME_SIZE,
  });
}
