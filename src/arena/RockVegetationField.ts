export interface RockVegetationPlacement {
  textureKey: string;
  frame?: string;
  worldX: number;
  worldY: number;
  /** Laenge entlang der Felskante, in Weltpixeln. */
  lengthPx: number;
  /** Hoehe quer zur Felskante, in Weltpixeln. Streut je Matte. */
  bandPx: number;
  /** Nahe einem Vielfachen von 90 Grad; dreht die gewachsene Franse der Vorlage nach aussen. */
  rotation: number;
  alpha: number;
  /** Spiegelung entlang der Kante. Quer wird nie gespiegelt, sonst zeigte die Franse nach innen. */
  mirrorX: boolean;
}

/** Halbe Diagonale einer Matte – konservativer Radius fuer Chunk-Ueberschneidungstests. */
export function getRockVegetationPlacementRadiusPx(placement: RockVegetationPlacement): number {
  return Math.hypot(placement.lengthPx, placement.bandPx) / 2;
}
