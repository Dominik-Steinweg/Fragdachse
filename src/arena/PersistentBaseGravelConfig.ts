import type * as Phaser from 'phaser';

/** Produktionspfad fuer die grossflaechigen, transparenten Kies-Details der Persistent Base. */
export const PERSISTENT_BASE_GRAVEL_ASSET_PATH = './assets/sprites/persistent-base';

export interface PersistentBaseGravelDecorationVariant {
  readonly fileName: string;
  /** Relatives Gewicht innerhalb der vier authored Kiesformen. */
  readonly frequencyPercent: number;
}

export interface PersistentBaseGravelDecorationConfig {
  /** Wahrscheinlichkeit je Kieszelle; die Platzierungen bleiben zellunabhaengig voneinander. */
  readonly coveragePercent: number;
  /** Maximale zufaellige Verschiebung des Ankers, in Zellen. */
  readonly maxOffsetCells: number;
  /**
   * Zulaessiger Ueberstand des gedrehten Stamps ueber den aktiven Zonenrand, in Zellen. Negativ
   * haelt ihn so weit im Inneren; den Rand zum Gras formt allein das Kiesfeld.
   */
  readonly maxOverhangCells: number;
  readonly minSizeCells: number;
  readonly maxSizeCells: number;
  /** Werte groesser als eins bevorzugen die kleinere authored Form. */
  readonly sizeBias: number;
  readonly minAlpha: number;
  readonly maxAlpha: number;
  readonly variants: readonly PersistentBaseGravelDecorationVariant[];
}

/**
 * Dezente, grosse Kies-/Bodenformen ueber dem durchgehenden Kiesmaterial.
 *
 * Die vier Formen sind keine eigene Terrain-Technik: Sie werden wie Ground Cover als
 * deterministische Texture-Stamps in dieselbe Chunk-Surface gebacken. Sie bleiben im Inneren der
 * Zone und brechen dort nur die Materialflaeche auf; ueber den Zonenrand ragende Stamps legten
 * sonst einen hellen, gezackten Saum auf das Gras.
 */
export const PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG: PersistentBaseGravelDecorationConfig = {
  coveragePercent: 100,
  maxOffsetCells: 0.26,
  maxOverhangCells: -0.75,
  minSizeCells: 1.10,
  maxSizeCells: 3.2,
  sizeBias: 1.2,
  minAlpha: 0.15,
  maxAlpha: 0.4,
  variants: [
    { fileName: 'gravel_patch_01.png', frequencyPercent: 25 },
    { fileName: 'gravel_patch_02.png', frequencyPercent: 25 },
    { fileName: 'gravel_patch_03.png', frequencyPercent: 25 },
    { fileName: 'gravel_patch_04.png', frequencyPercent: 25 },
  ],
};

export function getPersistentBaseGravelTextureKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function preloadPersistentBaseGravelAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const variant of PERSISTENT_BASE_GRAVEL_DECORATION_CONFIG.variants) {
    loader.image(
      getPersistentBaseGravelTextureKey(variant.fileName),
      `${PERSISTENT_BASE_GRAVEL_ASSET_PATH}/${variant.fileName}`,
    );
  }
}
